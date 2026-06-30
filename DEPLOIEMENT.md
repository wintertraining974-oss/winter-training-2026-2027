# Mise en place — comptes, profils & notifications email

## Ce qui a changé
- Le site demande maintenant une **connexion (email + mot de passe)** avant d'afficher le planning.
- Chacun peut **créer son compte**, **s'inscrire seul ou inscrire un groupe** (plusieurs personnes en une fois, avec lui-même comme référent).
- Chacun voit la liste complète des inscrits, mais **ne peut modifier/annuler que ses propres inscriptions** (bouton ✕ visible seulement sur "ses" lignes).
- Un bouton **"Mon profil"** liste toutes ses inscriptions, avec annulation directe.
- **Toi (admin)** : une fois ton compte créé et marqué admin en base, tu vois le panneau ⚡ Admin automatiquement (plus de code secret), tu peux tout déplacer/supprimer.
- Tu reçois un **email à chaque inscription/annulation**.

L'ancien code admin "3103" en dur dans le JS a été supprimé (il n'était de toute façon pas sécurisé, visible par n'importe qui dans le code source).

---

## Étape 1 — Exécuter le script SQL (5 min)
1. Va sur [supabase.com](https://supabase.com) → ton projet → **SQL Editor** → **New query**.
2. Colle tout le contenu du fichier `01_migration.sql` fourni, puis **Run**.
   - Cela crée la table `profiles`, ajoute les colonnes nécessaires à `inscriptions`, et active les règles de sécurité (RLS) : chacun ne peut modifier que ses propres inscriptions, l'admin peut tout faire.

## Étape 2 — Remplacer le fichier du site
1. Remplace ton `index.html` actuel par celui fourni (`index.html`).
2. Redéploie sur Vercel (push sur ton repo Git, ou glisser-déposer si tu déploies manuellement).

## Étape 3 — Créer ton compte admin
1. Va sur le site une fois redéployé, clique **"Créer un compte"**, inscris-toi avec `nelly.tornare@cinor.re`.
2. Retourne dans Supabase → **SQL Editor**, exécute :
   ```sql
   update public.profiles set is_admin = true where email = 'nelly.tornare@cinor.re';
   ```
3. Recharge la page (déconnexion/reconnexion si besoin) : le panneau ⚡ Admin apparaît automatiquement.

## Étape 4 — Activer l'email de notification
1. Dans Supabase → **Edge Functions**, crée une nouvelle fonction nommée `notify-registration` et colle le contenu de `supabase/functions/notify-registration/index.ts` (ou déploie via la CLI Supabase, voir ci-dessous).
2. Dans **Project Settings → Edge Functions → Secrets**, ajoute :
   - `RESEND_API_KEY` = ta clé API Resend
   - `ADMIN_EMAIL` = `nelly.tornare@cinor.re`
   - `FROM_EMAIL` = une adresse expéditrice vérifiée sur Resend (sinon utilise temporairement `onboarding@resend.dev`, qui fonctionne sans vérification de domaine mais en mode test)
3. Dans Supabase → **Database → Webhooks**, crée un webhook :
   - Table : `inscriptions`
   - Évènements : `INSERT` et `DELETE`
   - Type : **Edge Function** → sélectionne `notify-registration`
4. Teste en t'inscrivant à une séance depuis le site : tu dois recevoir un email.

### Déploiement de l'Edge Function via la CLI (alternative à l'étape 4.1)
```bash
npm install -g supabase
supabase login
supabase link --project-ref ccwcpysuertjslqefbkl
supabase functions deploy notify-registration
supabase secrets set RESEND_API_KEY=ta_cle RESEND_API_KEY ADMIN_EMAIL=nelly.tornare@cinor.re FROM_EMAIL=onboarding@resend.dev
```

---

## Notes importantes
- **Confirmation d'email à l'inscription** : par défaut Supabase Auth peut exiger une confirmation par email avant la première connexion. Si tu préfères que les gens puissent se connecter immédiatement sans cliquer sur un lien de confirmation, va dans Supabase → **Authentication → Providers → Email** et désactive "Confirm email".
- **Mot de passe oublié** : non géré dans cette version (pas demandé). Je peux l'ajouter si besoin (lien "mot de passe oublié" avec email de réinitialisation Supabase).
- **Sécurité** : la clé "anon" Supabase visible dans le code est normale et publique par design — c'est désormais les règles RLS (étape 1) qui protègent réellement les données, pas la clé.
