-- Script SQL pour ajouter le stockage permanent des badges de la section retenter
-- À exécuter dans l'éditeur SQL de Supabase

-- Ajouter la colonne badges_from_wheel (tableau d'IDs de badges provenant de la roue)
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS badges_from_wheel TEXT[] DEFAULT '{}';

-- Commentaire pour documentation
COMMENT ON COLUMN profiles.badges_from_wheel IS 'Tableau des IDs des badges provenant de la roue et actuellement dans la section "Badges à retenter"';

