-- ════════════════════════════════════════════════════════════════
-- MIGRATION : comptes, profils, permissions
-- À COLLER ENTIÈREMENT dans Supabase → SQL Editor → New query → Run
-- ════════════════════════════════════════════════════════════════

-- 1) Table des profils (1 ligne par compte créé)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

-- 2) Création automatique du profil à chaque inscription (signup)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 3) Colonnes ajoutées à la table existante "inscriptions"
alter table public.inscriptions
  add column if not exists user_id uuid references auth.users(id) on delete set null,
  add column if not exists group_id uuid,
  add column if not exists referent_name text;

-- 4) Activer la sécurité au niveau des lignes (RLS)
alter table public.profiles enable row level security;
alter table public.inscriptions enable row level security;
alter table public.config enable row level security;

-- Fonction utilitaire : l'utilisateur connecté est-il admin ?
create or replace function public.is_admin()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- ── Policies "profiles" ──────────────────────────────────────────
drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin" on public.profiles
  for select using (auth.uid() = id or public.is_admin());

drop policy if exists "profiles_update_own_or_admin" on public.profiles;
create policy "profiles_update_own_or_admin" on public.profiles
  for update using (auth.uid() = id or public.is_admin());

-- ── Policies "inscriptions" ──────────────────────────────────────
-- Lecture : tout utilisateur connecté voit la liste complète des inscrits
drop policy if exists "inscriptions_select_all_logged_in" on public.inscriptions;
create policy "inscriptions_select_all_logged_in" on public.inscriptions
  for select using (auth.role() = 'authenticated');

-- Création : un utilisateur connecté ne peut créer que des inscriptions à son nom (user_id = lui-même)
drop policy if exists "inscriptions_insert_own" on public.inscriptions;
create policy "inscriptions_insert_own" on public.inscriptions
  for insert with check (auth.uid() = user_id or public.is_admin());

-- Modification : uniquement ses propres inscriptions, ou l'admin (toutes)
drop policy if exists "inscriptions_update_own_or_admin" on public.inscriptions;
create policy "inscriptions_update_own_or_admin" on public.inscriptions
  for update using (auth.uid() = user_id or public.is_admin());

-- Suppression : uniquement ses propres inscriptions, ou l'admin (toutes)
drop policy if exists "inscriptions_delete_own_or_admin" on public.inscriptions;
create policy "inscriptions_delete_own_or_admin" on public.inscriptions
  for delete using (auth.uid() = user_id or public.is_admin());

-- ── Policies "config" (réglages admin : capacité, ordre, jours fermés…) ──
drop policy if exists "config_select_logged_in" on public.config;
create policy "config_select_logged_in" on public.config
  for select using (auth.role() = 'authenticated');

drop policy if exists "config_write_admin_only" on public.config;
create policy "config_write_admin_only" on public.config
  for all using (public.is_admin()) with check (public.is_admin());

-- ════════════════════════════════════════════════════════════════
-- DERNIÈRE ÉTAPE (à faire APRÈS avoir créé ton compte sur le site) :
-- Remplace l'email ci-dessous par le tien puis exécute cette ligne
-- pour te donner les droits admin :
--
-- update public.profiles set is_admin = true where email = 'nelly.tornare@cinor.re';
-- ════════════════════════════════════════════════════════════════
