-- ============================================
-- CORRECTION DES POLITIQUES RLS POUR subscriptions
-- ============================================
-- Ce script modifie la politique SELECT pour permettre de compter
-- les abonnés et abonnements de n'importe quel utilisateur
--
-- Problème : La politique actuelle ne permet de voir que les abonnements
-- où l'utilisateur est impliqué, ce qui empêche de compter correctement
-- les abonnés/abonnements d'autres utilisateurs
--
-- Solution : Permettre à tous les utilisateurs authentifiés de voir
-- tous les abonnements (information publique de toute façon)
-- ============================================

-- Supprimer l'ancienne politique
DROP POLICY IF EXISTS "subscriptions_select_own" ON subscriptions;

-- Créer la nouvelle politique qui permet de voir tous les abonnements
CREATE POLICY "subscriptions_select_all"
ON subscriptions
FOR SELECT
TO public
USING (true);

-- Vérification
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual
FROM pg_policies
WHERE tablename = 'subscriptions'
ORDER BY policyname;

