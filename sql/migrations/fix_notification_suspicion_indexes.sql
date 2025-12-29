-- Correction : Ajouter des index uniques pour éviter les doublons de notifications de soupçons
-- À exécuter dans Supabase SQL Editor

-- ============================================
-- 1. INDEX UNIQUE POUR suspicion_individual
-- ============================================
-- Empêche qu'un même utilisateur reçoive plusieurs notifications pour le même soupçon
-- (même badge, même soupçonneur)
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_suspicion_individual_unique 
ON notifications(user_id, type, badge_id, suspicious_user_id) 
WHERE type = 'suspicion_individual';

-- ============================================
-- 2. INDEX UNIQUE POUR suspicion_blocked
-- ============================================
-- Empêche qu'un utilisateur ait plusieurs notifications NON LUES pour le même badge bloqué
-- Note : Si toutes les notifications sont lues, une nouvelle peut être créée (re-blocage)
-- Cela permet d'informer l'utilisateur si un badge est re-bloqué après déblocage
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_suspicion_blocked_unique 
ON notifications(user_id, type, badge_id) 
WHERE type = 'suspicion_blocked' AND is_read = false;

-- ============================================
-- 3. VÉRIFICATION
-- ============================================
-- Vérifier que les index sont créés correctement
SELECT 
  indexname,
  indexdef
FROM pg_indexes 
WHERE tablename = 'notifications' 
  AND indexname IN (
    'idx_notifications_suspicion_individual_unique',
    'idx_notifications_suspicion_blocked_unique'
  )
ORDER BY indexname;

-- ============================================
-- 4. VÉRIFICATION DES INDEX EXISTANTS
-- ============================================
-- Voir tous les index uniques sur la table notifications
SELECT 
  indexname,
  indexdef,
  CASE 
    WHEN indexdef LIKE '%UNIQUE%' THEN '✅ Index unique'
    ELSE 'Index normal'
  END as type_index
FROM pg_indexes 
WHERE tablename = 'notifications'
ORDER BY indexname;

-- ============================================
-- NOTES
-- ============================================
-- Ces index garantissent qu'il ne peut pas y avoir de doublons au niveau base de données
-- même si la vérification JavaScript échoue (erreur réseau, bug, etc.)
--
-- Pour suspicion_individual :
-- - Un utilisateur ne peut recevoir qu'une seule notification par soupçon
-- - Si un utilisateur soupçonne plusieurs fois le même badge, seule la première notification est créée
--
-- Pour suspicion_blocked :
-- - Un utilisateur ne peut avoir qu'une seule notification NON LUE par badge bloqué
-- - Si toutes les notifications sont lues et que le badge est re-bloqué, une nouvelle notification peut être créée
-- - Cela permet d'informer l'utilisateur d'un re-blocage

