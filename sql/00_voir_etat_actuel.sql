-- ============================================
-- SCRIPT DE VISUALISATION - ÉTAT ACTUEL
-- ============================================
-- Ce script montre TOUTES les politiques RLS actuelles
-- Exécutez-le AVANT de faire le nettoyage pour voir ce qui existe
-- 
-- ⚠️ Ce script ne modifie RIEN, il affiche seulement l'état actuel
-- ============================================

-- ============================================
-- 1. TOUTES LES POLITIQUES PAR TABLE
-- ============================================
SELECT 
  'Toutes les politiques' as type_verification,
  schemaname as schema,
  tablename as table_concernee,
  policyname as nom_politique,
  cmd as commande,
  roles as roles_autorises,
  CASE 
    WHEN 'public' = ANY(roles) THEN '✅ public (tous)'
    WHEN 'authenticated' = ANY(roles) THEN '✅ authenticated (connectés)'
    WHEN 'anon' = ANY(roles) THEN '✅ anon (non connectés)'
    ELSE '❓ ' || array_to_string(roles, ', ')
  END as roles_display
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('notifications', 'profiles', 'user_badges', 'subscriptions', 'badge_suspicions', 'badges')
ORDER BY tablename, cmd, policyname;

-- ============================================
-- 2. STATUT RLS PAR TABLE
-- ============================================
SELECT 
  'Statut RLS' as type_verification,
  tablename as table_concernee,
  rowsecurity as rls_actif,
  CASE 
    WHEN rowsecurity = true THEN '✅ RLS activé'
    ELSE '❌ RLS désactivé'
  END as statut
FROM pg_tables 
WHERE schemaname = 'public'
  AND tablename IN ('notifications', 'profiles', 'user_badges', 'subscriptions', 'badge_suspicions', 'badges')
ORDER BY tablename;

-- ============================================
-- 3. COMPTE DES POLITIQUES PAR TABLE
-- ============================================
SELECT 
  'Compte des politiques' as type_verification,
  tablename as table_concernee,
  cmd as commande,
  COUNT(*) as nombre_politiques
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('notifications', 'profiles', 'user_badges', 'subscriptions', 'badge_suspicions', 'badges')
GROUP BY tablename, cmd
ORDER BY tablename, 
  CASE cmd
    WHEN 'SELECT' THEN 1
    WHEN 'INSERT' THEN 2
    WHEN 'UPDATE' THEN 3
    WHEN 'DELETE' THEN 4
    ELSE 5
  END;

-- ============================================
-- 4. RÉSUMÉ GLOBAL
-- ============================================
SELECT 
  'Résumé global' as type_verification,
  COUNT(DISTINCT tablename) as nombre_tables_avec_politiques,
  COUNT(*) as nombre_total_politiques
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('notifications', 'profiles', 'user_badges', 'subscriptions', 'badge_suspicions', 'badges');

-- ============================================
-- NOTES
-- ============================================
-- Après avoir exécuté ce script, vous verrez :
-- - Toutes les politiques existantes
-- - Le statut RLS de chaque table
-- - Le nombre de politiques par table
--
-- Vous pouvez maintenant exécuter le script de réinitialisation
-- si vous voulez tout nettoyer et recommencer proprement.

