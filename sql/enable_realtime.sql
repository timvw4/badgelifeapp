-- ============================================
-- ACTIVATION DE REALTIME POUR LES TABLES
-- ============================================
-- Ce script active Realtime (WebSocket) pour les tables qui en ont besoin
--
-- Realtime permet de recevoir des mises à jour en temps réel quand les données changent
-- dans la base de données (nouvelles notifications, abonnements, etc.)
--
-- IMPORTANT : Realtime doit être activé dans Supabase Dashboard :
-- 1. Va dans Database > Replication
-- 2. Active la réplication pour les tables suivantes :
--    - notifications
--    - subscriptions
-- ============================================

-- Activer la publication pour les tables nécessaires
-- ATTENTION : Ces commandes nécessitent les privilèges superuser
-- Si elles échouent, utilisez plutôt le Dashboard Supabase (méthode recommandée)

-- Pour notifications
DO $$
BEGIN
  -- Vérifier si la table existe et n'est pas déjà dans la publication
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'notifications') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
      RAISE NOTICE '✅ Table notifications ajoutée à Realtime';
    EXCEPTION WHEN duplicate_object THEN
      RAISE NOTICE 'ℹ️ Table notifications déjà dans Realtime';
    END;
  ELSE
    RAISE NOTICE '⚠️ Table notifications n''existe pas';
  END IF;
END $$;

-- Pour subscriptions
DO $$
BEGIN
  -- Vérifier si la table existe et n'est pas déjà dans la publication
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'subscriptions') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE subscriptions;
      RAISE NOTICE '✅ Table subscriptions ajoutée à Realtime';
    EXCEPTION WHEN duplicate_object THEN
      RAISE NOTICE 'ℹ️ Table subscriptions déjà dans Realtime';
    END;
  ELSE
    RAISE NOTICE '⚠️ Table subscriptions n''existe pas';
  END IF;
END $$;

-- Vérification : Afficher les tables publiées
SELECT 
  schemaname,
  tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
ORDER BY tablename;

-- ============================================
-- NOTE IMPORTANTE
-- ============================================
-- Si les commandes ALTER PUBLICATION échouent avec une erreur de permissions,
-- activez Realtime manuellement dans le Dashboard Supabase :
--
-- 1. Va dans Database > Replication
-- 2. Clique sur "Add table" pour chaque table
-- 3. Sélectionne : notifications, subscriptions
-- 4. Clique sur "Save"
--
-- Après activation, les erreurs CHANNEL_ERROR devraient disparaître.

