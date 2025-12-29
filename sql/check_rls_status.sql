-- Script de vérification de l'état actuel de RLS pour notifications
-- À exécuter dans Supabase SQL Editor

-- ============================================
-- 1. VÉRIFIER L'ÉTAT DE RLS
-- ============================================
SELECT 
  tablename,
  rowsecurity as rls_actif,
  CASE 
    WHEN rowsecurity = true THEN '✅ RLS activé'
    ELSE '❌ RLS désactivé'
  END as statut
FROM pg_tables 
WHERE tablename = 'notifications';

-- ============================================
-- 2. VOIR TOUTES LES POLITIQUES EXISTANTES
-- ============================================
SELECT 
  policyname as nom_politique,
  cmd as commande,
  roles as roles_autorises,
  qual as condition_using,
  with_check as condition_with_check,
  CASE 
    WHEN cmd = 'INSERT' THEN '🔵 Insertion'
    WHEN cmd = 'SELECT' THEN '🟢 Lecture'
    WHEN cmd = 'UPDATE' THEN '🟡 Mise à jour'
    WHEN cmd = 'DELETE' THEN '🔴 Suppression'
    ELSE cmd
  END as type_operation
FROM pg_policies 
WHERE tablename = 'notifications'
ORDER BY 
  CASE cmd
    WHEN 'INSERT' THEN 1
    WHEN 'SELECT' THEN 2
    WHEN 'UPDATE' THEN 3
    WHEN 'DELETE' THEN 4
    ELSE 5
  END,
  policyname;

-- ============================================
-- 3. RÉSUMÉ ATTENDU
-- ============================================
-- Après avoir exécuté reset_rls_notifications.sql, vous devriez voir :
-- 
-- ✅ RLS activé
-- 
-- Politiques :
-- 1. notifications_insert_all (INSERT, TO public, WITH CHECK true)
-- 2. notifications_select_own (SELECT, TO authenticated, USING user_id = auth.uid())
-- 3. notifications_update_own (UPDATE, TO authenticated, USING/WITH CHECK user_id = auth.uid())
--
-- Si vous voyez d'autres politiques ou si certaines manquent, 
-- le script n'a peut-être pas été exécuté complètement.

