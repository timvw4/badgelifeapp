-- Ajouter la colonne was_ever_unlocked à la table user_badges
-- Exécuter ce script dans Supabase > SQL Editor

ALTER TABLE public.user_badges 
ADD COLUMN IF NOT EXISTS was_ever_unlocked boolean NOT NULL DEFAULT false;

-- Mettre à jour les badges existants : si success = true, alors was_ever_unlocked = true
UPDATE public.user_badges 
SET was_ever_unlocked = true 
WHERE success = true;

-- Mettre à jour les badges bloqués qui ont un niveau non-nul (signe qu'ils ont été débloqués avant)
UPDATE public.user_badges 
SET was_ever_unlocked = true 
WHERE success = false 
  AND level IS NOT NULL 
  AND level != 'niv 0' 
  AND level != 'skill 0' 
  AND level != 'niveau 0';

