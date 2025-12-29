-- Ajouter une politique d'insertion pour les utilisateurs authentifiés
-- À exécuter dans Supabase SQL Editor
--
-- PROBLÈME : Les utilisateurs authentifiés utilisent le rôle 'authenticated'
-- mais la politique actuelle est seulement pour 'public'
-- SOLUTION : Ajouter une politique pour 'authenticated'

-- ============================================
-- 1. VÉRIFIER LES POLITIQUES ACTUELLES
-- ============================================
SELECT 
  policyname,
  cmd,
  roles,
  CASE 
    WHEN 'public' = ANY(roles) THEN '✅ Pour public (non authentifiés)'
    WHEN 'authenticated' = ANY(roles) THEN '✅ Pour authenticated (authentifiés)'
    ELSE '❓ Autre rôle'
  END as description
FROM pg_policies 
WHERE tablename = 'notifications' AND cmd = 'INSERT'
ORDER BY policyname;

-- ============================================
-- 2. AJOUTER LA POLITIQUE POUR AUTHENTICATED
-- ============================================
-- Créer une politique d'insertion pour les utilisateurs authentifiés
-- (si elle n'existe pas déjà)

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'notifications' 
    AND cmd = 'INSERT'
    AND 'authenticated' = ANY(roles)
  ) THEN
    CREATE POLICY "notifications_insert_authenticated"
    ON notifications
    FOR INSERT
    TO authenticated
    WITH CHECK (true);
    RAISE NOTICE '✅ Politique notifications_insert_authenticated créée';
  ELSE
    RAISE NOTICE 'ℹ️  Politique pour authenticated existe déjà';
  END IF;
END $$;

-- ============================================
-- 3. VÉRIFICATION FINALE
-- ============================================
-- Vérifier que les deux politiques existent maintenant
SELECT 
  'Politiques INSERT' as type,
  policyname,
  roles,
  CASE 
    WHEN 'public' = ANY(roles) AND 'authenticated' = ANY(roles) THEN '✅ Pour public ET authenticated'
    WHEN 'public' = ANY(roles) THEN '✅ Pour public (non authentifiés)'
    WHEN 'authenticated' = ANY(roles) THEN '✅ Pour authenticated (authentifiés)'
    ELSE '❓ Autre'
  END as couverture
FROM pg_policies 
WHERE tablename = 'notifications' AND cmd = 'INSERT'
ORDER BY policyname;

-- ============================================
-- RÉSULTAT ATTENDU
-- ============================================
-- Après l'exécution, vous devriez avoir :
-- 1. notifications_insert_all (ou notifications_insert_public) - TO public
-- 2. notifications_insert_authenticated - TO authenticated
--
-- Cela couvre TOUS les cas :
-- - Utilisateurs non authentifiés (clé anon) → utilise la politique 'public'
-- - Utilisateurs authentifiés (Supabase Auth) → utilise la politique 'authenticated'

