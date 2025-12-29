-- Vérification complète de toutes les politiques RLS pour notifications
-- À exécuter dans Supabase SQL Editor

-- ============================================
-- 1. TOUTES LES POLITIQUES D'INSERTION
-- ============================================
SELECT 
  'INSERT Policies' as type,
  policyname,
  roles,
  with_check,
  permissive,
  CASE 
    WHEN 'public' = ANY(roles) THEN '✅ public'
    WHEN 'authenticated' = ANY(roles) THEN '✅ authenticated'
    WHEN 'anon' = ANY(roles) THEN '✅ anon'
    ELSE '❓ ' || array_to_string(roles, ', ')
  END as roles_display,
  CASE 
    WHEN with_check = 'true' OR with_check IS NULL THEN '✅ Permissive'
    ELSE '⚠️ Restrictive: ' || with_check
  END as check_status
FROM pg_policies 
WHERE tablename = 'notifications' AND cmd = 'INSERT'
ORDER BY policyname;

-- ============================================
-- 2. VÉRIFIER SI LES POLITIQUES SONT PERMISSIVES
-- ============================================
SELECT 
  'Policy Check' as type,
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM pg_policies 
      WHERE tablename = 'notifications' 
      AND cmd = 'INSERT'
      AND 'authenticated' = ANY(roles)
      AND (with_check = 'true' OR with_check IS NULL)
    ) THEN '✅ Politique authenticated permissive existe'
    ELSE '❌ Pas de politique authenticated permissive'
  END as authenticated_check,
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM pg_policies 
      WHERE tablename = 'notifications' 
      AND cmd = 'INSERT'
      AND ('public' = ANY(roles) OR 'anon' = ANY(roles))
      AND (with_check = 'true' OR with_check IS NULL)
    ) THEN '✅ Politique public/anon permissive existe'
    ELSE '❌ Pas de politique public/anon permissive'
  END as public_check;

-- ============================================
-- 3. VÉRIFIER L'ORDRE DES POLITIQUES
-- ============================================
-- Parfois l'ordre peut causer des problèmes
SELECT 
  'Policy Order' as type,
  policyname,
  cmd,
  roles,
  ROW_NUMBER() OVER (ORDER BY policyname) as ordre
FROM pg_policies 
WHERE tablename = 'notifications' AND cmd = 'INSERT'
ORDER BY policyname;

-- ============================================
-- 4. TEST : VÉRIFIER LES PERMISSIONS ACTUELLES
-- ============================================
-- Cette requête simule ce que Supabase vérifie
SELECT 
  'Permission Test' as type,
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM pg_policies 
      WHERE tablename = 'notifications' 
      AND cmd = 'INSERT'
      AND (
        ('authenticated' = ANY(roles) AND current_setting('request.jwt.claims', true)::json->>'role' = 'authenticated')
        OR
        ('public' = ANY(roles))
      )
      AND (
        with_check = 'true' 
        OR with_check IS NULL
        OR with_check = ''
      )
    ) THEN '✅ Insertion devrait être autorisée'
    ELSE '❌ Insertion bloquée par les politiques'
  END as resultat;

-- ============================================
-- 5. VÉRIFIER RLS
-- ============================================
SELECT 
  'RLS Status' as type,
  tablename,
  rowsecurity,
  CASE 
    WHEN rowsecurity = true THEN '✅ RLS activé'
    ELSE '❌ RLS désactivé'
  END as status
FROM pg_tables 
WHERE tablename = 'notifications';

-- ============================================
-- DIAGNOSTIC
-- ============================================
-- Si vous voyez :
-- - ✅ Politique authenticated permissive existe → La politique est là
-- - ❌ Insertion bloquée par les politiques → Il y a un problème avec l'évaluation
--
-- Solutions possibles :
-- 1. Supprimer toutes les politiques et les recréer
-- 2. Vérifier qu'il n'y a pas de politiques conflictuelles
-- 3. Essayer de désactiver temporairement RLS pour tester

