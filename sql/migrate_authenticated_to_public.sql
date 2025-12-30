-- ============================================
-- MIGRATION : CHANGER TO authenticated EN TO public
-- ============================================
-- Ce script remplace toutes les politiques RLS qui utilisent
-- TO authenticated par TO public
--
-- Raison : Tous les utilisateurs sont authentifiés, donc on utilise
-- TO public pour être cohérent (authenticated est inclus dans public)
-- ============================================

-- ============================================
-- NOTIFICATIONS
-- ============================================

-- Supprimer les anciennes politiques
DROP POLICY IF EXISTS "notifications_insert_authenticated" ON notifications;
DROP POLICY IF EXISTS "notifications_insert_public" ON notifications;
DROP POLICY IF EXISTS "notifications_select_own" ON notifications;
DROP POLICY IF EXISTS "notifications_update_own" ON notifications;

-- Créer les nouvelles politiques avec TO public
CREATE POLICY "notifications_insert_public"
ON notifications
FOR INSERT
TO public
WITH CHECK (true);

CREATE POLICY "notifications_select_own"
ON notifications
FOR SELECT
TO public
USING (user_id = auth.uid());

CREATE POLICY "notifications_update_own"
ON notifications
FOR UPDATE
TO public
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- ============================================
-- PROFILES
-- ============================================

-- Supprimer les anciennes politiques (si elles existent)
DROP POLICY IF EXISTS "profiles_insert_own" ON profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON profiles;

-- Créer les nouvelles politiques avec TO public
CREATE POLICY "profiles_insert_public"
ON profiles
FOR INSERT
TO public
WITH CHECK (true);

CREATE POLICY "profiles_update_own"
ON profiles
FOR UPDATE
TO public
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

-- Note: profiles_select_all devrait déjà être TO public, on ne le touche pas

-- ============================================
-- USER_BADGES
-- ============================================

-- Supprimer les anciennes politiques
DROP POLICY IF EXISTS "user_badges_select_own" ON user_badges;
DROP POLICY IF EXISTS "user_badges_select_all" ON user_badges;
DROP POLICY IF EXISTS "user_badges_insert_own" ON user_badges;
DROP POLICY IF EXISTS "user_badges_update_own" ON user_badges;

-- Créer les nouvelles politiques avec TO public
CREATE POLICY "user_badges_select_all"
ON user_badges
FOR SELECT
TO public
USING (true);

CREATE POLICY "user_badges_insert_public"
ON user_badges
FOR INSERT
TO public
WITH CHECK (true);

CREATE POLICY "user_badges_update_own"
ON user_badges
FOR UPDATE
TO public
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- ============================================
-- SUBSCRIPTIONS
-- ============================================

-- Supprimer les anciennes politiques
DROP POLICY IF EXISTS "subscriptions_select_own" ON subscriptions;
DROP POLICY IF EXISTS "subscriptions_select_all" ON subscriptions;
DROP POLICY IF EXISTS "subscriptions_insert_own" ON subscriptions;
DROP POLICY IF EXISTS "subscriptions_delete_own" ON subscriptions;

-- Créer les nouvelles politiques avec TO public
CREATE POLICY "subscriptions_select_all"
ON subscriptions
FOR SELECT
TO public
USING (true);

CREATE POLICY "subscriptions_insert_public"
ON subscriptions
FOR INSERT
TO public
WITH CHECK (true);

CREATE POLICY "subscriptions_delete_own"
ON subscriptions
FOR DELETE
TO public
USING (follower_id = auth.uid());

-- ============================================
-- BADGE_SUSPICIONS
-- ============================================

-- Supprimer les anciennes politiques
DROP POLICY IF EXISTS "badge_suspicions_select_all" ON badge_suspicions;
DROP POLICY IF EXISTS "badge_suspicions_insert_own" ON badge_suspicions;
DROP POLICY IF EXISTS "badge_suspicions_delete_own" ON badge_suspicions;

-- Créer les nouvelles politiques avec TO public
CREATE POLICY "badge_suspicions_select_all"
ON badge_suspicions
FOR SELECT
TO public
USING (true);

CREATE POLICY "badge_suspicions_insert_public"
ON badge_suspicions
FOR INSERT
TO public
WITH CHECK (true);

CREATE POLICY "badge_suspicions_delete_own"
ON badge_suspicions
FOR DELETE
TO public
USING (suspicious_user_id = auth.uid());

-- ============================================
-- BADGES
-- ============================================

-- Note: badges_select_all devrait déjà être TO public, on ne le touche pas
-- Si elle n'existe pas, on la crée
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'badges' 
    AND policyname = 'badges_select_all'
  ) THEN
    CREATE POLICY "badges_select_all"
    ON badges
    FOR SELECT
    TO public
    USING (true);
  END IF;
END $$;

-- ============================================
-- VÉRIFICATION FINALE
-- ============================================

-- Afficher toutes les politiques pour vérifier
SELECT 
  tablename as table_concernee,
  policyname as nom_politique,
  cmd as commande,
  roles as roles_autorises,
  CASE 
    WHEN roles::text LIKE '%public%' THEN '✅ TO public'
    WHEN roles::text LIKE '%authenticated%' THEN '⚠️ TO authenticated (à changer)'
    ELSE '❓ Autre'
  END as statut
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('notifications', 'profiles', 'user_badges', 'subscriptions', 'badge_suspicions', 'badges')
ORDER BY 
  tablename,
  CASE cmd
    WHEN 'SELECT' THEN 1
    WHEN 'INSERT' THEN 2
    WHEN 'UPDATE' THEN 3
    WHEN 'DELETE' THEN 4
    ELSE 5
  END,
  policyname;

