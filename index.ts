// supabase/functions/notify-registration/index.ts
//
// Déclenchée par un Database Webhook Supabase sur la table "inscriptions"
// (événements INSERT et DELETE). Envoie un email à l'admin via Resend.
//
// Secrets requis (Supabase → Project Settings → Edge Functions → Secrets) :
//   RESEND_API_KEY   = ta clé API Resend
//   ADMIN_EMAIL      = nelly.tornare@cinor.re
//   FROM_EMAIL       = adresse d'envoi vérifiée sur Resend (ex: planning@tondomaine.com)
//
// SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont déjà fournis automatiquement
// par Supabase à toutes les Edge Functions, pas besoin de les ajouter.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL") ?? "nelly.tornare@cinor.re";
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ?? "onboarding@resend.dev";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    const { type, record, old_record } = payload;

    let subject = "";
    let bodyHtml = "";

    if (type === "INSERT") {
      const r = record;
      const who = await getUserLabel(r.user_id);
      subject = `✅ Nouvelle inscription — ${r.nom} (${r.date} ${r.creneau})`;
      bodyHtml = `
        <h2>Nouvelle inscription</h2>
        <p><b>Participant :</b> ${escapeHtml(r.nom)} (${escapeHtml(r.role ?? "")})</p>
        <p><b>Date :</b> ${escapeHtml(r.date)}</p>
        <p><b>Créneau :</b> ${escapeHtml(r.creneau)}</p>
        <p><b>Inscrit par :</b> ${escapeHtml(who)}</p>
      `;
    } else if (type === "DELETE") {
      const r = old_record;
      const who = await getUserLabel(r.user_id);
      subject = `❌ Annulation — ${r.nom} (${r.date} ${r.creneau})`;
      bodyHtml = `
        <h2>Inscription annulée</h2>
        <p><b>Participant :</b> ${escapeHtml(r.nom)} (${escapeHtml(r.role ?? "")})</p>
        <p><b>Date :</b> ${escapeHtml(r.date)}</p>
        <p><b>Créneau :</b> ${escapeHtml(r.creneau)}</p>
        <p><b>Annulé par :</b> ${escapeHtml(who)}</p>
      `;
    } else {
      return new Response(JSON.stringify({ skipped: true }), { status: 200 });
    }

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: ADMIN_EMAIL,
        subject,
        html: bodyHtml,
      }),
    });

    if (!resendRes.ok) {
      const errTxt = await resendRes.text();
      console.error("Resend error:", errTxt);
      return new Response(JSON.stringify({ error: errTxt }), { status: 500 });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});

async function getUserLabel(userId: string | null): Promise<string> {
  if (!userId) return "Admin / inconnu";
  const { data } = await supabase
    .from("profiles")
    .select("full_name, email")
    .eq("id", userId)
    .maybeSingle();
  if (!data) return userId;
  return data.full_name ? `${data.full_name} (${data.email})` : data.email ?? userId;
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)
  );
}
