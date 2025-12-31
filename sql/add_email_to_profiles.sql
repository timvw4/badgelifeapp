-- ============================================
-- AJOUT DE LA COLONNE EMAIL À LA TABLE PROFILES
-- ============================================
-- Ce script ajoute une colonne email optionnelle à la table profiles
-- pour permettre la connexion par email en plus du pseudo

-- Ajouter la colonne email si elle n'existe pas déjà
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS email TEXT;

-- Créer un index pour améliorer les performances de recherche par email
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);

-- Commentaire pour documenter la colonne
COMMENT ON COLUMN profiles.email IS 'Email de l''utilisateur (optionnel, pour les comptes email/mot de passe)';

