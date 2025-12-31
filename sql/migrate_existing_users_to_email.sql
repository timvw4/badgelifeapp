-- ============================================
-- MIGRATION DES UTILISATEURS EXISTANTS
-- ============================================
-- Ce script migre les emails des utilisateurs existants depuis auth.users
-- vers la table profiles pour permettre la connexion par email

-- Mettre à jour les profils avec les emails depuis auth.users
-- Seulement pour les utilisateurs qui ont un email et qui n'en ont pas encore dans profiles
UPDATE profiles p
SET email = au.email
FROM auth.users au
WHERE p.id = au.id
  AND au.email IS NOT NULL
  AND (p.email IS NULL OR p.email = '');

-- Note: Les utilisateurs créés avec pseudo@badgelife.dev n'auront pas d'email réel
-- Ils continueront d'utiliser le système pseudo/mot de passe existant

