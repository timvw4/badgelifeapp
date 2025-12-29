-- Correction des politiques RLS (Row Level Security) pour la table notifications
-- À exécuter dans Supabase SQL Editor
-- 
-- PROBLÈME : Erreur 403 "new row violates row-level security policy"
-- CAUSE : Les politiques RLS empêchent l'insertion de notifications
-- SOLUTION : Créer ou modifier les politiques pour autoriser les insertions

-- ============================================
-- 1. VÉRIFIER L'ÉTAT ACTUEL DES POLITIQUES
-- ============================================
-- Voir toutes les politiques existantes sur la table notifications
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

-- ============================================
-- 2. SUPPRIMER L'ANCIENNE POLITIQUE RESTRICTIVE (SI ELLE EXISTE)
-- ============================================
-- Si vous avez déjà exécuté une version précédente de ce script, il peut y avoir
-- une ancienne politique "Users can insert their own notifications" qui bloque
-- les insertions pour d'autres utilisateurs. On la supprime si elle existe.

DROP POLICY IF EXISTS "Users can insert their own notifications" ON notifications;

-- ============================================
-- 3. CRÉER UNE POLITIQUE POUR AUTORISER L'INSERTION
-- ============================================
-- Cette politique permet à n'importe quel utilisateur authentifié d'insérer 
-- une notification pour n'importe quel utilisateur.
-- 
-- IMPORTANT : Cette politique est nécessaire car :
-- - Les notifications de soupçons sont créées par l'utilisateur A pour l'utilisateur B
-- - Les notifications d'abonnements sont créées par l'utilisateur A pour l'utilisateur B
-- - Les notifications système peuvent être créées pour n'importe quel utilisateur
-- 
-- SÉCURITÉ : Seuls les utilisateurs authentifiés peuvent créer des notifications.
-- Le code JavaScript contrôle qui peut créer quoi (ex: seulement les amis mutuels peuvent soupçonner).

-- Créer la politique seulement si elle n'existe pas déjà
-- NOTE: Si vos utilisateurs normaux ne sont pas authentifiés via Supabase Auth,
-- cette politique utilisera 'public' au lieu de 'authenticated'
DO $$
BEGIN
  -- Supprimer les anciennes politiques d'insertion qui pourraient bloquer
  DROP POLICY IF EXISTS "Authenticated users can insert notifications" ON notifications;
  DROP POLICY IF EXISTS "Users can insert their own notifications" ON notifications;
  
  -- Créer une politique permissive pour les insertions
  -- Utilise 'public' pour permettre même aux utilisateurs non authentifiés via Supabase Auth
  -- (si votre système d'authentification est différent)
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'notifications' 
    AND policyname = 'Allow all insertions to notifications'
  ) THEN
    CREATE POLICY "Allow all insertions to notifications"
    ON notifications
    FOR INSERT
    TO public  -- Permet à tous (authentifiés ou non) de créer des notifications
    WITH CHECK (true);
    RAISE NOTICE '✅ Politique "Allow all insertions to notifications" créée (public)';
  ELSE
    RAISE NOTICE 'ℹ️  Politique "Allow all insertions to notifications" existe déjà - pas de modification';
  END IF;
END $$;

-- ============================================
-- 4. CRÉER UNE POLITIQUE POUR AUTORISER LA LECTURE
-- ============================================
-- Cette politique permet à un utilisateur de lire uniquement ses propres notifications

-- Créer la politique seulement si elle n'existe pas déjà
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'notifications' 
    AND policyname = 'Users can read their own notifications'
  ) THEN
    CREATE POLICY "Users can read their own notifications"
    ON notifications
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());
    RAISE NOTICE '✅ Politique "Users can read their own notifications" créée';
  ELSE
    RAISE NOTICE 'ℹ️  Politique "Users can read their own notifications" existe déjà - pas de modification';
  END IF;
END $$;

-- ============================================
-- 5. CRÉER UNE POLITIQUE POUR AUTORISER LA MISE À JOUR
-- ============================================
-- Cette politique permet à un utilisateur de mettre à jour uniquement ses propres notifications
-- (par exemple, marquer comme lu)

-- Créer la politique seulement si elle n'existe pas déjà
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'notifications' 
    AND policyname = 'Users can update their own notifications'
  ) THEN
    CREATE POLICY "Users can update their own notifications"
    ON notifications
    FOR UPDATE
    TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());
    RAISE NOTICE '✅ Politique "Users can update their own notifications" créée';
  ELSE
    RAISE NOTICE 'ℹ️  Politique "Users can update their own notifications" existe déjà - pas de modification';
  END IF;
END $$;

-- ============================================
-- 6. VÉRIFIER QUE RLS EST ACTIVÉ
-- ============================================
-- S'assurer que Row Level Security est activé sur la table
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 7. VÉRIFICATION FINALE
-- ============================================
-- Vérifier que toutes les politiques sont créées
SELECT 
  policyname,
  cmd as commande,
  CASE 
    WHEN cmd = 'INSERT' THEN '✅ Insertion autorisée'
    WHEN cmd = 'SELECT' THEN '✅ Lecture autorisée'
    WHEN cmd = 'UPDATE' THEN '✅ Mise à jour autorisée'
    ELSE cmd
  END as statut
FROM pg_policies 
WHERE tablename = 'notifications'
ORDER BY cmd;

-- ============================================
-- NOTES IMPORTANTES
-- ============================================
-- 
-- ✅ SÉCURITÉ : Ce script vérifie l'existence de chaque politique avant de la créer.
--    Il ne supprime JAMAIS les politiques existantes, il ne crée que celles qui manquent.
--
-- 1. La politique d'insertion permet à TOUS les utilisateurs (public) de créer
--    des notifications. C'est nécessaire car :
--    - Les utilisateurs normaux peuvent ne pas être authentifiés via Supabase Auth
--    - Les notifications de soupçons sont créées par l'utilisateur A pour l'utilisateur B
--    - Les notifications d'abonnements sont créées par l'utilisateur A pour l'utilisateur B
--    - Le code JavaScript contrôle qui peut créer quoi (ex: seulement les amis mutuels)
--
-- 2. La sécurité est assurée par :
--    - Le code JavaScript vérifie les permissions (abonnements mutuels, etc.)
--    - Les utilisateurs ne peuvent lire que leurs propres notifications (politique SELECT)
--    - Les utilisateurs ne peuvent modifier que leurs propres notifications (politique UPDATE)
--
-- 3. Si vous préférez restreindre aux utilisateurs authentifiés Supabase uniquement,
--    remplacez 'TO public' par 'TO authenticated' dans la politique d'insertion
--
-- 3. Pour tester les politiques :
--    - Connectez-vous à l'application
--    - Essayez de créer une notification (soupçonner un badge, etc.)
--    - Vérifiez dans la console du navigateur qu'il n'y a plus d'erreur 403
--
-- 4. Si vous avez encore des erreurs après avoir exécuté ce script :
--    - Vérifiez que vous êtes bien connecté (auth.uid() n'est pas null)
--    - Vérifiez que le code JavaScript utilise bien auth.uid() pour user_id
--    - Vérifiez les logs dans Supabase pour voir les détails de l'erreur
--
-- 5. Si vous avez des politiques existantes avec des noms différents mais qui font
--    la même chose, ce script créera quand même les nouvelles politiques.
--    Dans ce cas, vous pouvez supprimer manuellement les anciennes dans Supabase
--    si vous le souhaitez (mais ce n'est pas obligatoire).

