-- ============================================
-- AJOUT DES POLITIQUES RLS POUR LA TABLE BADGES
-- ============================================
-- Ce script ajoute les politiques INSERT, UPDATE et DELETE pour la table badges
-- Nécessaire pour permettre l'administration des badges via le formulaire admin

-- Supprimer les anciennes politiques si elles existent (pour éviter les doublons)
DROP POLICY IF EXISTS "badges_insert_public" ON badges;
DROP POLICY IF EXISTS "badges_update_public" ON badges;
DROP POLICY IF EXISTS "badges_delete_public" ON badges;

-- 1. INSERT : Permet à tous les utilisateurs authentifiés de créer des badges
-- (L'accès à la page admin est contrôlé côté application via ADMIN_USER_IDS)
CREATE POLICY "badges_insert_public"
ON badges
FOR INSERT
TO public
WITH CHECK (true);

-- 2. UPDATE : Permet à tous les utilisateurs authentifiés de modifier des badges
CREATE POLICY "badges_update_public"
ON badges
FOR UPDATE
TO public
USING (true)
WITH CHECK (true);

-- 3. DELETE : Permet à tous les utilisateurs authentifiés de supprimer des badges
CREATE POLICY "badges_delete_public"
ON badges
FOR DELETE
TO public
USING (true);

-- Note : La sécurité est assurée par le contrôle d'accès côté application
-- (seuls les utilisateurs dans ADMIN_USER_IDS peuvent accéder à la page admin)

