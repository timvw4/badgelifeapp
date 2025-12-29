-- Forcer la création des politiques d'insertion (supprime et recrée)
-- À exécuter dans Supabase SQL Editor
--
-- Ce script supprime TOUTES les politiques d'insertion existantes
-- et en crée de nouvelles, propres et permissives

-- ============================================
-- 1. SUPPRIMER TOUTES LES POLITIQUES D'INSERTION
-- ============================================
DO $$
DECLARE
  policy_record RECORD;
BEGIN
  FOR policy_record IN 
    SELECT policyname 
    FROM pg_policies 
    WHERE tablename = 'notifications' AND cmd = 'INSERT'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON notifications', policy_record.policyname);
    RAISE NOTICE '✅ Politique supprimée: %', policy_record.policyname;
  END LOOP;
END $$;

-- ============================================
-- 2. CRÉER LES NOUVELLES POLITIQUES
-- ============================================

-- Politique pour les utilisateurs authentifiés (Supabase Auth)
CREATE POLICY "notifications_insert_authenticated"
ON notifications
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Politique pour les utilisateurs non authentifiés (clé anon)
CREATE POLICY "notifications_insert_public"
ON notifications
FOR INSERT
TO public
WITH CHECK (true);

-- ============================================
-- 3. VÉRIFICATION
-- ============================================
SELECT 
  'Politiques créées' as etape,
  policyname,
  cmd,
  roles,
  with_check,
  CASE 
    WHEN 'authenticated' = ANY(roles) THEN '✅ Pour utilisateurs authentifiés'
    WHEN 'public' = ANY(roles) THEN '✅ Pour utilisateurs non authentifiés'
    ELSE '❓ Autre'
  END as description
FROM pg_policies 
WHERE tablename = 'notifications' AND cmd = 'INSERT'
ORDER BY 
  CASE 
    WHEN 'authenticated' = ANY(roles) THEN 1
    WHEN 'public' = ANY(roles) THEN 2
    ELSE 3
  END;

-- ============================================
-- RÉSULTAT ATTENDU
-- ============================================
-- Vous devriez voir exactement 2 politiques :
-- 1. notifications_insert_authenticated (TO authenticated, WITH CHECK true)
-- 2. notifications_insert_public (TO public, WITH CHECK true)
--
-- Si vous voyez d'autres politiques ou si certaines manquent,
-- il y a un problème.

