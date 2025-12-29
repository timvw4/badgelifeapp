-- Script pour vérifier spécifiquement la politique d'insertion
-- À exécuter dans Supabase SQL Editor

-- ============================================
-- 1. VÉRIFIER LA POLITIQUE D'INSERTION
-- ============================================
SELECT 
  'Politique INSERT' as type_verification,
  policyname as nom_politique,
  cmd as commande,
  roles as roles_autorises,
  with_check as condition_with_check,
  CASE 
    WHEN 'public' = ANY(roles) THEN '✅ Accessible avec clé anon (public)'
    WHEN 'anon' = ANY(roles) THEN '✅ Accessible avec clé anon (anon)'
    WHEN 'authenticated' = ANY(roles) THEN '⚠️ Nécessite authentification Supabase Auth'
    ELSE '❌ Rôle non reconnu'
  END as accessibilite_anon,
  CASE 
    WHEN with_check = 'true' OR with_check IS NULL THEN '✅ Condition permissive (true ou NULL)'
    ELSE '⚠️ Condition restrictive: ' || with_check
  END as condition_status
FROM pg_policies 
WHERE tablename = 'notifications' AND cmd = 'INSERT';

-- ============================================
-- 2. VÉRIFIER SI RLS EST ACTIVÉ
-- ============================================
SELECT 
  'RLS Status' as type_verification,
  tablename,
  rowsecurity as rls_actif,
  CASE 
    WHEN rowsecurity = true THEN '✅ RLS activé'
    ELSE '❌ RLS désactivé'
  END as statut
FROM pg_tables 
WHERE tablename = 'notifications';

-- ============================================
-- 3. TESTER LA POLITIQUE
-- ============================================
-- Vérifier si une politique permissive existe pour public/anon
SELECT 
  'Test politique' as type_verification,
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM pg_policies 
      WHERE tablename = 'notifications' 
      AND cmd = 'INSERT' 
      AND ('public' = ANY(roles) OR 'anon' = ANY(roles))
    ) THEN '✅ Politique INSERT pour public/anon trouvée'
    ELSE '❌ Aucune politique INSERT pour public/anon'
  END as resultat,
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM pg_policies 
      WHERE tablename = 'notifications' 
      AND cmd = 'INSERT' 
      AND ('public' = ANY(roles) OR 'anon' = ANY(roles))
      AND (with_check = 'true' OR with_check IS NULL)
    ) THEN '✅ Politique permissive (WITH CHECK true ou NULL)'
    WHEN EXISTS (
      SELECT 1 FROM pg_policies 
      WHERE tablename = 'notifications' 
      AND cmd = 'INSERT' 
      AND ('public' = ANY(roles) OR 'anon' = ANY(roles))
    ) THEN '⚠️ Politique existe mais avec condition restrictive'
    ELSE '❌ Aucune politique permissive'
  END as detail;

-- ============================================
-- 4. RÉSUMÉ
-- ============================================
-- Pour que l'insertion fonctionne avec la clé anon, vous devez avoir :
-- ✅ RLS activé
-- ✅ Une politique INSERT avec roles = {public} ou {anon}
-- ✅ WITH CHECK = true (ou NULL)

-- Si vous voyez "⚠️ Nécessite authentification Supabase Auth" dans la section 1,
-- alors le problème est que la politique nécessite une authentification,
-- mais votre code utilise la clé anon sans session authentifiée.

