-- Script SQL pour ajouter le système de calendrier de connexion
-- À exécuter dans l'éditeur SQL de Supabase

-- Ajouter la colonne connection_days (tableau de dates de connexion)
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS connection_days TEXT[] DEFAULT '{}';

-- Ajouter la colonne week_start_date (date de début de la semaine en cours - lundi)
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS week_start_date DATE;

-- Ajouter la colonne week_bonus_available (si le bonus de 3 jetons est disponible - non réclamé)
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS week_bonus_available BOOLEAN DEFAULT false;

-- Commentaires pour documentation
COMMENT ON COLUMN profiles.connection_days IS 'Tableau des dates de connexion de la semaine actuelle (format YYYY-MM-DD)';
COMMENT ON COLUMN profiles.week_start_date IS 'Date de début de la semaine en cours (lundi)';
COMMENT ON COLUMN profiles.week_bonus_available IS 'Indique si l''utilisateur a un bonus de 3 jetons disponible (non encore réclamé)';
