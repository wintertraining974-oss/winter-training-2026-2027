// ════════════════════════════════════════════════════════════════
// Supabase Edge Function : admin-create-user
//
// Permet à un admin (déjà connecté) de créer un compte pour une
// personne à partir de son email : un mot de passe provisoire est
// généré, le compte est créé et validé (approved=true), le rôle
// (référent / lecture seule) est appliqué, et un email est envoyé
// à la personne avec ses identifiants.
//
// Déploiement (une seule fois) :
//   1. supabase functions new admin-create-user
//      → remplace le contenu de index.ts généré par celui-ci
//   2. Dans les "Secrets" du projet (Project Settings → Edge Functions
//      → Secrets, ou `supabase secrets set`), vérifie/ajoute :
//        SUPABASE_URL              (déjà présent par défaut)
//        SUPABASE_SERVICE_ROLE_KEY (déjà présent par défaut, jamais
//                                    exposé au front, uniquement ici)
//        SUPABASE_ANON_KEY         (déjà présent par défaut)
//   3. supabase functions deploy admin-create-user
// ════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function randomPassword(len = 10) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let out = "";
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < len; i++) out += chars[bytes[i] % chars.length];
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const callerJwt = authHeader.replace("Bearer ", "");
    if (!callerJwt) {
      return json({ error: "Authentification manquante." }, 401);
    }

    // Client "anon + JWT appelant" -> pour identifier qui appelle
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: callerData, error: callerErr } = await callerClient.auth.getUser(callerJwt);
    if (callerErr || !callerData?.user) {
      return json({ error: "Session invalide." }, 401);
    }

    // Client "service role" -> pour vérifier les droits et créer le compte (bypass RLS)
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: callerProfile } = await admin
      .from("profiles")
      .select("is_admin")
      .eq("id", callerData.user.id)
      .maybeSingle();

    if (!callerProfile?.is_admin) {
      return json({ error: "Réservé aux administrateurs." }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const email = (body.email || "").trim().toLowerCase();
    const firstName = (body.first_name || "").trim();
    const lastName = (body.last_name || "").trim();
    const role = body.role === "readonly" ? "readonly" : "referent";

    if (!email || !email.includes("@")) {
      return json({ error: "Email invalide." }, 400);
    }

    const tempPassword = randomPassword(10);
    const fullName = [firstName, lastName].filter(Boolean).join(" ") || email;

    // 1) Créer le compte auth avec le mot de passe provisoire, email pré-confirmé
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { first_name: firstName, last_name: lastName, full_name: fullName },
    });
    if (createErr) {
      return json({ error: createErr.message || "Impossible de créer le compte (email déjà utilisé ?)." }, 400);
    }
    const newUserId = created.user.id;

    // 2) Créer/compléter la ligne profiles : accès validé, rôle appliqué
    const { error: profileErr } = await admin.from("profiles").upsert({
      id: newUserId,
      email,
      full_name: fullName,
      role,
      approved: true,
      blocked: false,
      is_admin: false,
    });
    if (profileErr) {
      return json({ error: "Compte créé mais erreur sur le profil : " + profileErr.message }, 500);
    }

    // 3) Envoyer l'email avec les identifiants provisoires, en réutilisant
    // la fonction d'envoi d'emails déjà en place (notify-registration).
    // ⚠️ Ajoute un cas "ACCOUNT_CREATED" dans notify-registration qui
    // envoie un email à record.email avec record.tempPassword.
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/notify-registration`, {
        method: "POST",
        headers: { Authorization: `Bearer ${ANON_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "ACCOUNT_CREATED",
          record: { email, nom: fullName, tempPassword, role },
        }),
      });
    } catch (_e) {
      // On n'échoue pas la création du compte si l'envoi d'email échoue :
      // l'admin voit quand même le message de succès et peut transmettre
      // le mot de passe manuellement si besoin.
    }

    return json({ ok: true, user_id: newUserId, email, tempPassword });
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
