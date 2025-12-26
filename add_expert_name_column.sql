-- Script pour ajouter la colonne expert_name à la table badges
-- Exécutez ce script dans l'éditeur SQL de Supabase
-- Cette colonne permet de définir un nom alternatif pour les badges au niveau expert

-- ÉTAPE 1: Vérifier si la table badges existe
-- Exécutez d'abord cette requête pour voir toutes vos tables
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;

-- Si la table "badges" n'apparaît pas dans les résultats ci-dessus,
-- vous devez d'abord créer la table badges avant de continuer.

-- ÉTAPE 2: Ajouter la colonne expert_name
-- Essayez d'abord cette version (sans préfixe public)
ALTER TABLE badges 
ADD COLUMN IF NOT EXISTS expert_name text;

-- Si cela ne fonctionne pas, essayez cette version (avec préfixe public)
-- ALTER TABLE public.badges 
-- ADD COLUMN IF NOT EXISTS expert_name text;

-- ✅ Si l'étape 2 fonctionne, la colonne est créée et fonctionnelle !
-- Les étapes 3 et 4 sont optionnelles mais recommandées :

-- ÉTAPE 3 (optionnel): Ajouter un commentaire pour documenter la colonne
-- Utile pour la documentation dans Supabase
COMMENT ON COLUMN badges.expert_name IS 'Nom alternatif affiché quand le badge atteint le niveau expert. Si défini, remplace le nom normal (name) pour les badges au niveau expert. L''emoji reste inchangé.';

-- ÉTAPE 4 (recommandé): Vérifier que la colonne a bien été créée
-- Confirme que tout s'est bien passé
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'badges' 
  AND column_name = 'expert_name';
