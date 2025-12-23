-- Script pour ajouter les colonnes nécessaires pour le système de jetons avec calendrier
-- Exécutez ce script dans l'éditeur SQL de Supabase

-- 1. Ajouter la colonne claimed_daily_tokens (tableau de dates)
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS claimed_daily_tokens text[] DEFAULT '{}';

-- 2. Ajouter la colonne week_bonus_claimed (boolean)
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS week_bonus_claimed boolean DEFAULT false;

-- 3. Vérifier que les colonnes existent
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'profiles' 
  AND column_name IN ('claimed_daily_tokens', 'week_bonus_claimed')
ORDER BY column_name;

-- 4. Mettre à jour les profils existants pour initialiser les valeurs par défaut
UPDATE public.profiles
SET 
  claimed_daily_tokens = COALESCE(claimed_daily_tokens, '{}'),
  week_bonus_claimed = COALESCE(week_bonus_claimed, false)
WHERE claimed_daily_tokens IS NULL OR week_bonus_claimed IS NULL;

