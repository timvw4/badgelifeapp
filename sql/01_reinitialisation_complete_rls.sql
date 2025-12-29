-- ============================================
-- RÉINITIALISATION COMPLÈTE DES POLITIQUES RLS
-- ============================================
-- Ce script supprime TOUTES les politiques RLS existantes
-- et recrée uniquement les politiques nécessaires pour votre application
--
-- ⚠️ ATTENTION : Ce script va supprimer toutes les politiques existantes
-- ✅ Les données dans les tables ne seront PAS supprimées
-- ✅ Les utilisateurs ne seront pas affectés
--
-- Tables concernées :
-- - notifications
-- - profiles
-- - user_badges
-- - subscriptions
-- - badge_suspicions
-- - badges
-- ============================================

-- ============================================
-- ÉTAPE 1 : SUPPRIMER TOUTES LES POLITIQUES EXISTANTES
-- ============================================
-- On supprime toutes les politiques pour repartir de zéro

DO $$
DECLARE
  policy_record RECORD;
  tables_list TEXT[] := ARRAY['notifications', 'profiles', 'user_badges', 'subscriptions', 'badge_suspicions', 'badges'];
  table_name TEXT;
BEGIN
  -- Pour chaque table
  FOREACH table_name IN ARRAY tables_list
  LOOP
    -- Supprimer toutes les politiques de cette table
    FOR policy_record IN 
      SELECT policyname 
      FROM pg_policies 
      WHERE schemaname = 'public' AND tablename = table_name
    LOOP
      BEGIN
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I', 
          policy_record.policyname, 
          table_name);
        RAISE NOTICE '✅ Politique supprimée: % sur %', 
          policy_record.policyname, 
          table_name;
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '⚠️ Erreur lors de la suppression de % sur %: %', 
          policy_record.policyname, 
          table_name, 
          SQLERRM;
      END;
    END LOOP;
  END LOOP;
  
  RAISE NOTICE '✅ Toutes les politiques ont été supprimées';
END $$;

-- ============================================
-- ÉTAPE 2 : S'ASSURER QUE RLS EST ACTIVÉ
-- ============================================
-- On active RLS sur toutes les tables (si ce n'est pas déjà fait)

ALTER TABLE IF EXISTS notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS user_badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS badge_suspicions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS badges ENABLE ROW LEVEL SECURITY;

-- ============================================
-- ÉTAPE 3 : CRÉER LES POLITIQUES POUR notifications
-- ============================================

-- 3.1 INSERT : Permet à tous (authentifiés ou non) de créer des notifications
-- Nécessaire car votre code crée des notifications pour d'autres utilisateurs
CREATE POLICY "notifications_insert_public"
ON notifications
FOR INSERT
TO public
WITH CHECK (true);

CREATE POLICY "notifications_insert_authenticated"
ON notifications
FOR INSERT
TO authenticated
WITH CHECK (true);

-- 3.2 SELECT : Permet aux utilisateurs authentifiés de lire leurs propres notifications
CREATE POLICY "notifications_select_own"
ON notifications
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- 3.3 UPDATE : Permet aux utilisateurs authentifiés de modifier leurs propres notifications
CREATE POLICY "notifications_update_own"
ON notifications
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- ============================================
-- ÉTAPE 4 : CRÉER LES POLITIQUES POUR profiles
-- ============================================

-- 4.1 SELECT : Permet à tous de lire les profils (pour la communauté)
CREATE POLICY "profiles_select_all"
ON profiles
FOR SELECT
TO public
USING (true);

-- 4.2 INSERT : Permet aux utilisateurs authentifiés de créer leur profil
CREATE POLICY "profiles_insert_own"
ON profiles
FOR INSERT
TO authenticated
WITH CHECK (id = auth.uid());

-- 4.3 UPDATE : Permet aux utilisateurs authentifiés de modifier leur propre profil
CREATE POLICY "profiles_update_own"
ON profiles
FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

-- ============================================
-- ÉTAPE 5 : CRÉER LES POLITIQUES POUR user_badges
-- ============================================

-- 5.1 SELECT : Permet aux utilisateurs authentifiés de lire leurs propres badges
CREATE POLICY "user_badges_select_own"
ON user_badges
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- 5.2 INSERT : Permet aux utilisateurs authentifiés de créer leurs badges
CREATE POLICY "user_badges_insert_own"
ON user_badges
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- 5.3 UPDATE : Permet aux utilisateurs authentifiés de modifier leurs propres badges
CREATE POLICY "user_badges_update_own"
ON user_badges
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- ============================================
-- ÉTAPE 6 : CRÉER LES POLITIQUES POUR subscriptions
-- ============================================

-- 6.1 SELECT : Permet aux utilisateurs authentifiés de lire leurs abonnements
-- (peut voir les abonnements où il est follower OU following)
CREATE POLICY "subscriptions_select_own"
ON subscriptions
FOR SELECT
TO authenticated
USING (follower_id = auth.uid() OR following_id = auth.uid());

-- 6.2 INSERT : Permet aux utilisateurs authentifiés de créer des abonnements
-- (peut seulement créer des abonnements où il est le follower)
CREATE POLICY "subscriptions_insert_own"
ON subscriptions
FOR INSERT
TO authenticated
WITH CHECK (follower_id = auth.uid());

-- 6.3 DELETE : Permet aux utilisateurs authentifiés de supprimer leurs abonnements
-- (peut seulement supprimer les abonnements où il est le follower)
CREATE POLICY "subscriptions_delete_own"
ON subscriptions
FOR DELETE
TO authenticated
USING (follower_id = auth.uid());

-- ============================================
-- ÉTAPE 7 : CRÉER LES POLITIQUES POUR badge_suspicions
-- ============================================

-- 7.1 SELECT : Permet aux utilisateurs authentifiés de lire les soupçons
-- (nécessaire pour compter les soupçons, vérifier si on a déjà soupçonné, etc.)
CREATE POLICY "badge_suspicions_select_all"
ON badge_suspicions
FOR SELECT
TO authenticated
USING (true);

-- 7.2 INSERT : Permet aux utilisateurs authentifiés de créer des soupçons
-- IMPORTANT : Vérifie que l'utilisateur authentifié est bien celui qui soupçonne
-- (suspicious_user_id doit être égal à l'ID de l'utilisateur connecté)
CREATE POLICY "badge_suspicions_insert_own"
ON badge_suspicions
FOR INSERT
TO authenticated
WITH CHECK (suspicious_user_id = auth.uid());

-- 7.3 DELETE : Permet aux utilisateurs authentifiés de supprimer leurs propres soupçons
-- (seul celui qui a créé le soupçon peut le retirer)
CREATE POLICY "badge_suspicions_delete_own"
ON badge_suspicions
FOR DELETE
TO authenticated
USING (suspicious_user_id = auth.uid());

-- Note : Pas de politique UPDATE car le code ne modifie jamais les soupçons,
-- seulement les crée (INSERT) et les supprime (DELETE)

-- ============================================
-- ÉTAPE 8 : CRÉER LES POLITIQUES POUR badges
-- ============================================

-- 8.1 SELECT : Permet à tous de lire la liste des badges (catalogue)
CREATE POLICY "badges_select_all"
ON badges
FOR SELECT
TO public
USING (true);

-- Note : Pour INSERT/UPDATE/DELETE sur badges, vous pouvez ajouter des politiques
-- spécifiques pour les administrateurs si nécessaire. Pour l'instant, on laisse
-- seulement la lecture ouverte à tous.

-- ============================================
-- ÉTAPE 9 : VÉRIFICATION FINALE
-- ============================================
-- Affiche toutes les politiques créées pour vérifier

SELECT 
  '✅ Politiques créées' as etape,
  tablename as table_concernee,
  policyname as nom_politique,
  cmd as commande,
  roles as roles_autorises,
  CASE 
    WHEN cmd = 'INSERT' THEN '✅ Insertion autorisée'
    WHEN cmd = 'SELECT' THEN '✅ Lecture autorisée'
    WHEN cmd = 'UPDATE' THEN '✅ Mise à jour autorisée'
    WHEN cmd = 'DELETE' THEN '✅ Suppression autorisée'
    ELSE 'ℹ️ Autre'
  END as description
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

-- Vérifier que RLS est bien activé sur toutes les tables
SELECT 
  '✅ Statut RLS' as etape,
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
-- RÉSUMÉ
-- ============================================
-- ✅ Toutes les anciennes politiques ont été supprimées
-- ✅ RLS est activé sur toutes les tables
-- ✅ Les nouvelles politiques minimales ont été créées
--
-- Votre application devrait maintenant fonctionner avec ces politiques propres.
-- Testez votre application pour vérifier que tout fonctionne correctement.
--
-- Si vous avez besoin d'ajouter d'autres politiques (par exemple pour les admins),
-- vous pouvez les ajouter manuellement après avoir exécuté ce script.

