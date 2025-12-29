-- Script de diagnostic pour vérifier la clé anon et la configuration API
-- À exécuter dans Supabase SQL Editor

-- ============================================
-- 1. VÉRIFIER LES PERMISSIONS DE LA CLÉ ANON
-- ============================================
-- Note : Les permissions de la clé anon sont gérées via les politiques RLS
-- Si RLS est activé, la clé anon doit respecter les politiques

SELECT 
  'RLS Status' as check_type,
  tablename,
  rowsecurity as rls_enabled,
  CASE 
    WHEN rowsecurity = true THEN '✅ RLS activé - Les politiques contrôlent l''accès'
    ELSE '⚠️ RLS désactivé - Accès libre'
  END as status
FROM pg_tables 
WHERE tablename = 'notifications';

-- ============================================
-- 2. VÉRIFIER LES POLITIQUES POUR LA CLÉ ANON
-- ============================================
-- La clé anon utilise le rôle 'anon' ou 'public'
-- Vérifions que nos politiques permettent l'accès avec ces rôles

SELECT 
  'Politique INSERT' as check_type,
  policyname,
  cmd,
  roles,
  CASE 
    WHEN 'public' = ANY(roles) OR 'anon' = ANY(roles) THEN '✅ Accessible avec clé anon'
    WHEN 'authenticated' = ANY(roles) THEN '⚠️ Nécessite authentification Supabase Auth'
    ELSE '❌ Rôle non reconnu'
  END as anon_access
FROM pg_policies 
WHERE tablename = 'notifications' AND cmd = 'INSERT';

-- ============================================
-- 3. TESTER UNE INSERTION SIMULÉE
-- ============================================
-- Vérifier si on peut insérer avec les permissions actuelles
-- (Ceci ne crée pas vraiment de notification, juste un test de permissions)

SELECT 
  'Test INSERT' as check_type,
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM pg_policies 
      WHERE tablename = 'notifications' 
      AND cmd = 'INSERT' 
      AND ('public' = ANY(roles) OR 'anon' = ANY(roles))
      AND (with_check = 'true' OR with_check IS NULL)
    ) THEN '✅ Politique INSERT permissive trouvée'
    ELSE '❌ Aucune politique INSERT permissive pour anon/public'
  END as result;

-- ============================================
-- 4. VÉRIFIER LES CONTRAINTES DE LA TABLE
-- ============================================
-- Parfois des contraintes peuvent bloquer l'insertion

SELECT 
  'Contraintes' as check_type,
  conname as constraint_name,
  contype as constraint_type,
  CASE contype
    WHEN 'f' THEN '🔗 Clé étrangère'
    WHEN 'c' THEN '✅ Contrainte CHECK'
    WHEN 'u' THEN '🔑 Unique'
    WHEN 'p' THEN '🔑 Clé primaire'
    ELSE '❓ Autre'
  END as type_description
FROM pg_constraint
WHERE conrelid = 'notifications'::regclass
ORDER BY contype;

-- ============================================
-- 5. VÉRIFIER LES TRIGGERS
-- ============================================
-- Des triggers peuvent bloquer l'insertion

SELECT 
  'Triggers' as check_type,
  trigger_name,
  event_manipulation,
  action_timing,
  CASE 
    WHEN action_timing = 'BEFORE' AND event_manipulation = 'INSERT' THEN '⚠️ Trigger BEFORE INSERT - peut bloquer'
    ELSE 'ℹ️ Autre trigger'
  END as warning
FROM information_schema.triggers
WHERE event_object_table = 'notifications'
ORDER BY action_timing, event_manipulation;

-- ============================================
-- NOTES
-- ============================================
-- 
-- Si toutes les vérifications montrent que tout est correct mais que l'erreur 403 persiste,
-- le problème peut venir de :
-- 1. La clé anon dans config.js qui ne correspond pas à celle dans Supabase
-- 2. Les paramètres API dans Supabase (Settings → API)
-- 3. Un problème de session/authentification dans le code JavaScript
--
-- Vérifiez aussi dans Supabase :
-- - Settings → API → Comparez la clé "anon public" avec celle dans config.js
-- - Authentication → Settings → Vérifiez que l'authentification est activée

