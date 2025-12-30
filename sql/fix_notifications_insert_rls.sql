-- ============================================
-- CORRECTION DES POLITIQUES RLS POUR notifications
-- ============================================
-- Ce script vérifie et corrige toutes les politiques RLS pour les notifications
--
-- Problème : Erreur 403 lors de la création de notifications
-- "new row violates row-level security policy for table \"notifications\""
--
-- Solution : S'assurer que toutes les politiques nécessaires sont présentes :
-- - INSERT : pour créer des notifications pour d'autres utilisateurs
-- - SELECT : pour que les utilisateurs puissent lire leurs propres notifications
-- - UPDATE : pour que les utilisateurs puissent marquer leurs notifications comme lues
-- ============================================

-- Supprimer les anciennes politiques pour repartir de zéro
DROP POLICY IF EXISTS "notifications_insert_public" ON notifications;
DROP POLICY IF EXISTS "notifications_insert_authenticated" ON notifications;
DROP POLICY IF EXISTS "notifications_select_own" ON notifications;
DROP POLICY IF EXISTS "notifications_update_own" ON notifications;

-- 1. INSERT : Permet à tous de créer des notifications
-- Cette politique permet de créer des notifications pour n'importe quel utilisateur
-- (nécessaire pour les notifications d'abonnement, désabonnement, etc.)
CREATE POLICY "notifications_insert_public"
ON notifications
FOR INSERT
TO public
WITH CHECK (true);

-- 2. SELECT : Permet à tous de lire leurs propres notifications
-- Les utilisateurs peuvent seulement voir leurs propres notifications
CREATE POLICY "notifications_select_own"
ON notifications
FOR SELECT
TO public
USING (user_id = auth.uid());

-- 3. UPDATE : Permet à tous de modifier leurs propres notifications
-- Permet de marquer les notifications comme lues (is_read = true)
CREATE POLICY "notifications_update_own"
ON notifications
FOR UPDATE
TO public
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Vérification : Afficher toutes les politiques pour notifications
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'notifications'
ORDER BY policyname;

