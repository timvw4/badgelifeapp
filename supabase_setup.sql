-- Script d'initialisation Supabase pour BadgeLife
-- 1) Ouvre Supabase > SQL > colle tout ce fichier > Exécuter.
-- 2) Les politiques RLS rendent les données publiques en lecture,
--    et chaque utilisateur ne peut écrire que ses propres lignes.

-- Extensions utiles
create extension if not exists "pgcrypto";

-- Profils utilisateurs (lien direct avec auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  badge_count integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "profiles_select_public" on public.profiles
  for select using (true);
create policy "profiles_insert_self" on public.profiles
  for insert with check (auth.uid() = id);
create policy "profiles_update_self" on public.profiles
  for update using (auth.uid() = id);

-- Catalogue des badges
create table if not exists public.badges (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  question text not null,
  answer text not null,
  created_at timestamptz not null default now()
);
alter table public.badges enable row level security;
create policy "badges_select_public" on public.badges
  for select using (true);

create table if not exists public.user_badges (
  user_id uuid not null references public.profiles(id) on delete cascade,
  badge_id uuid not null references public.badges(id) on delete cascade,
  success boolean not null default true,
  level text,
  created_at timestamptz not null default now(),
  primary key (user_id, badge_id)
);
alter table public.user_badges enable row level security;
create policy "user_badges_select_self" on public.user_badges
  for select using (auth.uid() = user_id);
create policy "user_badges_insert_self" on public.user_badges
  for insert with check (auth.uid() = user_id);

-- 3 badges de départ (réinsértion inoffensive grâce au on conflict)
-- answer stocke un petit JSON pour gérer les niveaux côté front.
insert into public.badges (id, name, description, question, answer) values
(
  '11111111-1111-1111-1111-111111111111',
  '🌍 Globe Trotteur',
  'Déclare tes pays visités et débloque un niveau.',
  'Combien de pays as-tu visités ?',
  '{
    "type":"range",
    "levels":[
      {"label":"Niv 1","min":3,"max":5},
      {"label":"Niv 2","min":6,"max":8},
      {"label":"Niv 3","min":9,"max":15},
      {"label":"Niv 4","min":16,"max":25},
      {"label":"Niv 5","min":26,"max":50},
      {"label":"Niv mystère","min":51,"max":99999,"mystery":true}
    ]
  }'
),
(
  '22222222-2222-2222-2222-222222222222',
  '📚 Lecteur',
  'Partage ton nombre de livres lus pour décrocher un niveau.',
  'Combien de livres as-tu lus ?',
  '{
    "type":"range",
    "levels":[
      {"label":"Niv 1","min":5,"max":10},
      {"label":"Niv 2","min":11,"max":30},
      {"label":"Niv 3","min":31,"max":50},
      {"label":"Niv 4","min":51,"max":100},
      {"label":"Niv 5","min":101,"max":200},
      {"label":"Niv mystère","min":201,"max":99999,"mystery":true}
    ]
  }'
),
(
  '33333333-3333-3333-3333-333333333333',
  '🪖 Militaire',
  'As-tu fait le service militaire ?',
  'As-tu fait le service militaire ? (oui/non)',
  '{"type":"boolean","expected":true,"singleAttempt":true,"trueLabels":["oui","yes","y"],"falseLabels":["non","no","n"]}'
)
on conflict (id) do nothing;

