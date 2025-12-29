-- Script simple pour supprimer la politique restrictive et garder seulement la permissive
-- À exécuter dans Supabase SQL Editor

-- ============================================
-- 1. SUPPRIMER LA POLITIQUE RESTRICTIVE
-- ============================================
-- La politique "System can create notifications" est probablement restrictive.
-- On la supprime pour garder seulement "Allow all insertions" qui est permissive.

DROP POLICY IF EXISTS "System can create notifications" ON notifications;

-- ============================================
-- 2. VÉRIFICATION
-- ============================================
-- Vérifier qu'il ne reste que la politique permissive
SELECT 
  policyname,
  cmd as commande,
  roles,
  CASE 
    WHEN policyname = 'Allow all insertions' AND roles = '{public}' THEN '✅ Politique permissive active'
    ELSE '⚠️ Autre politique'
  END as statut
FROM pg_policies 
WHERE tablename = 'notifications' AND cmd = 'INSERT';

-- ============================================
-- RÉSULTAT ATTENDU
-- ============================================
-- Après l'exécution, vous devriez voir seulement :
-- - "Allow all insertions" avec roles = {public}
-- 
-- Si vous voyez encore "System can create notifications", 
-- cela signifie qu'elle n'a pas pu être supprimée (peut-être qu'elle n'existe pas avec ce nom exact).
-- Dans ce cas, exécutez d'abord le script fix_system_policy.sql pour voir les détails.

