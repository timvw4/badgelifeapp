-- Script pour configurer les politiques RLS (Row Level Security) pour la table badges
-- Exécutez ce script dans l'éditeur SQL de Supabase
-- Ce script permet aux utilisateurs admin de modifier les badges tout en gardant la lecture publique

-- IMPORTANT: Remplacez '13afe477-ecd9-4c4e-8962-d6621c973d4a' par les UUID de vos utilisateurs admin
-- Vous pouvez ajouter plusieurs UUID séparés par des virgules dans la liste

-- 1. Activer RLS sur la table badges (si ce n'est pas déjà fait)
ALTER TABLE badges ENABLE ROW LEVEL SECURITY;

-- 2. Supprimer les anciennes politiques si elles existent (pour éviter les conflits)
DROP POLICY IF EXISTS "Badges are viewable by everyone" ON badges;
DROP POLICY IF EXISTS "Admins can insert badges" ON badges;
DROP POLICY IF EXISTS "Admins can update badges" ON badges;
DROP POLICY IF EXISTS "Admins can delete badges" ON badges;

-- 3. Politique de lecture : tout le monde peut lire les badges
CREATE POLICY "Badges are viewable by everyone"
ON badges
FOR SELECT
USING (true);

-- 4. Politique d'insertion : uniquement les admins peuvent insérer
CREATE POLICY "Admins can insert badges"
ON badges
FOR INSERT
WITH CHECK (
  auth.uid() IN (
    '13afe477-ecd9-4c4e-8962-d6621c973d4a'::uuid
    -- Ajoutez d'autres UUID d'admin ici, séparés par des virgules
    -- Exemple: 'autre-uuid-1'::uuid, 'autre-uuid-2'::uuid
  )
);

-- 5. Politique de modification : uniquement les admins peuvent modifier
CREATE POLICY "Admins can update badges"
ON badges
FOR UPDATE
USING (
  auth.uid() IN (
    '13afe477-ecd9-4c4e-8962-d6621c973d4a'::uuid
    -- Ajoutez d'autres UUID d'admin ici, séparés par des virgules
  )
)
WITH CHECK (
  auth.uid() IN (
    '13afe477-ecd9-4c4e-8962-d6621c973d4a'::uuid
    -- Ajoutez d'autres UUID d'admin ici, séparés par des virgules
  )
);

-- 6. Politique de suppression : uniquement les admins peuvent supprimer
CREATE POLICY "Admins can delete badges"
ON badges
FOR DELETE
USING (
  auth.uid() IN (
    '13afe477-ecd9-4c4e-8962-d6621c973d4a'::uuid
    -- Ajoutez d'autres UUID d'admin ici, séparés par des virgules
  )
);

-- 7. Vérifier que les politiques sont bien créées
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual
FROM pg_policies
WHERE tablename = 'badges'
ORDER BY policyname;

