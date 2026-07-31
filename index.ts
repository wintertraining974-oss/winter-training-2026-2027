// supabase/functions/delete-user-account/index.ts
//
// Supprime complètement un compte : ses inscriptions, sa liste d'attente,
// son profil, ET son identifiant de connexion (email/mot de passe) dans
// Supabase Auth — pour qu'il puisse s'inscrire à nouveau s'il le souhaite.
//
// Seul un administrateur (profiles.is_admin = true) authentifié peut
// appeler cette fonction.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { userId } = await req.json()
    if (!userId) {
      return new Response(JSON.stringify({ error: 'userId manquant' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Non authentifié' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

    // Client "appelant" : sert uniquement à vérifier qui fait la demande
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser()
    if (callerErr || !caller) {
      return new Response(JSON.stringify({ error: 'Session invalide' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Client "admin" (clé service_role) : seul lui peut vérifier le rôle
    // et effectuer les suppressions, y compris le compte de connexion.
    const adminClient = createClient(supabaseUrl, serviceKey)

    const { data: callerProfile } = await adminClient
      .from('profiles').select('is_admin').eq('id', caller.id).maybeSingle()
    if (!callerProfile?.is_admin) {
      return new Response(JSON.stringify({ error: 'Réservé aux administrateurs' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 1) Nettoyage des données (au cas où elles n'auraient pas déjà été
    //    supprimées côté application)
    await adminClient.from('inscriptions').delete().eq('user_id', userId)
    await adminClient.from('waitlist').delete().eq('user_id', userId)
    await adminClient.from('profiles').delete().eq('id', userId)

    // 2) Suppression du compte de connexion (email/mot de passe)
    const { error: delErr } = await adminClient.auth.admin.deleteUser(userId)
    if (delErr) {
      return new Response(JSON.stringify({ error: delErr.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
