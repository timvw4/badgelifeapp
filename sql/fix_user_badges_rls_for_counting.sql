-- ============================================
-- CORRECTION DES POLITIQUES RLS POUR user_badges
-- ============================================
-- Ce script modifie la politique SELECT pour permettre de compter
-- les badges de n'importe quel utilisateur
--
-- Problème : La politique actuelle ne permet de voir que ses propres badges,
-- ce qui empêche de compter correctement les badges d'autres utilisateurs
-- dans l'onglet communauté
--
-- Solution : Permettre à tous les utilisateurs authentifiés de voir
-- tous les badges (information publique de toute façon)
-- ============================================

-- Supprimer l'ancienne politique
DROP POLICY IF EXISTS "user_badges_select_own" ON user_badges;

-- Créer la nouvelle politique qui permet de voir tous les badges
CREATE POLICY "user_badges_select_all"
ON user_badges
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
WHERE tablename = 'user_badges'
ORDER BY policyname;

