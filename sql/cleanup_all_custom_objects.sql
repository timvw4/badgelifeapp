-- ============================================
-- NETTOYAGE COMPLET DES OBJETS PERSONNALISÉS
-- ============================================
-- Ce script supprime TOUS les objets personnalisés créés dans Supabase
-- (fonctions, politiques, vues, etc.) et ne garde que les tables de base
--
-- ⚠️ ATTENTION : Ce script est DESTRUCTIF
-- Il supprime :
-- - Toutes les fonctions personnalisées
-- - Toutes les politiques RLS personnalisées
-- - Toutes les vues personnalisées
-- - Toutes les extensions non-essentielles
--
-- ✅ Il NE supprime PAS :
-- - Les tables et leurs données
-- - Les utilisateurs
-- - Les données existantes
--
-- ⚠️ IMPACT SUR LES UTILISATEURS :
-- - Les données existantes sont PRÉSERVÉES
-- - Les utilisateurs peuvent toujours se connecter
-- - Mais certaines fonctionnalités peuvent cesser de fonctionner
--   jusqu'à ce que les politiques nécessaires soient recréées
--
-- ============================================
-- ÉTAPE 1 : LISTER TOUS LES OBJETS À SUPPRIMER
-- ============================================
-- Cette étape montre ce qui sera supprimé AVANT de le supprimer

-- 1.1 Fonctions personnalisées
SELECT 
  'Fonctions à supprimer' as type_objet,
  routine_name as nom,
  routine_type as type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name NOT LIKE 'pg_%'
  AND routine_name NOT IN (
    -- Fonctions système à garder
    'current_database',
    'current_schema',
    'current_user',
    'session_user',
    'version'
  )
ORDER BY routine_name;

-- 1.2 Politiques RLS personnalisées (sauf celles qu'on veut garder)
SELECT 
  'Politiques à supprimer' as type_objet,
  policyname as nom,
  tablename as table_concernee,
  cmd as commande
FROM pg_policies
WHERE schemaname = 'public'
  AND policyname NOT IN (
    -- Politiques à GARDER (ajoutez ici les noms des politiques essentielles)
    'notifications_insert_all',
    'notifications_select_own',
    'notifications_update_own'
  )
ORDER BY tablename, policyname;

-- 1.3 Vues personnalisées
SELECT 
  'Vues à supprimer' as type_objet,
  table_name as nom
FROM information_schema.views
WHERE table_schema = 'public'
  AND table_name NOT LIKE 'pg_%'
ORDER BY table_name;

-- ============================================
-- ÉTAPE 2 : SUPPRIMER LES FONCTIONS PERSONNALISÉES
-- ============================================
-- ⚠️ DÉCOMMENTEZ CETTE SECTION POUR EXÉCUTER LA SUPPRESSION

/*
DO $$
DECLARE
  func_record RECORD;
BEGIN
  FOR func_record IN 
    SELECT routine_name, routine_type
    FROM information_schema.routines
    WHERE routine_schema = 'public'
      AND routine_name NOT LIKE 'pg_%'
      AND routine_name NOT IN (
        'current_database', 'current_schema', 'current_user', 
        'session_user', 'version'
      )
  LOOP
    BEGIN
      EXECUTE format('DROP %s IF EXISTS %I() CASCADE', 
        CASE func_record.routine_type 
          WHEN 'FUNCTION' THEN 'FUNCTION'
          WHEN 'PROCEDURE' THEN 'PROCEDURE'
          ELSE 'FUNCTION'
        END,
        func_record.routine_name);
      RAISE NOTICE '✅ Fonction supprimée: %', func_record.routine_name;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE '⚠️ Erreur lors de la suppression de %: %', func_record.routine_name, SQLERRM;
    END;
  END LOOP;
END $$;
*/

-- ============================================
-- ÉTAPE 3 : SUPPRIMER LES POLITIQUES NON ESSENTIELLES
-- ============================================
-- ⚠️ DÉCOMMENTEZ CETTE SECTION POUR EXÉCUTER LA SUPPRESSION
-- Cette section garde seulement les 3 politiques notifications qu'on a créées

/*
DO $$
DECLARE
  policy_record RECORD;
BEGIN
  FOR policy_record IN 
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public'
      AND policyname NOT IN (
        'notifications_insert_all',
        'notifications_select_own',
        'notifications_update_own'
      )
  LOOP
    BEGIN
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', 
        policy_record.policyname, 
        policy_record.tablename);
      RAISE NOTICE '✅ Politique supprimée: % sur %', 
        policy_record.policyname, 
        policy_record.tablename;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE '⚠️ Erreur lors de la suppression de %: %', 
        policy_record.policyname, SQLERRM;
    END;
  END LOOP;
END $$;
*/

-- ============================================
-- ÉTAPE 4 : SUPPRIMER LES VUES PERSONNALISÉES
-- ============================================
-- ⚠️ DÉCOMMENTEZ CETTE SECTION POUR EXÉCUTER LA SUPPRESSION

/*
DO $$
DECLARE
  view_record RECORD;
BEGIN
  FOR view_record IN 
    SELECT table_name
    FROM information_schema.views
    WHERE table_schema = 'public'
      AND table_name NOT LIKE 'pg_%'
  LOOP
    BEGIN
      EXECUTE format('DROP VIEW IF EXISTS %I CASCADE', view_record.table_name);
      RAISE NOTICE '✅ Vue supprimée: %', view_record.table_name;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE '⚠️ Erreur lors de la suppression de %: %', 
        view_record.table_name, SQLERRM;
    END;
  END LOOP;
END $$;
*/

-- ============================================
-- ÉTAPE 5 : VÉRIFICATION FINALE
-- ============================================
-- Après avoir exécuté les suppressions, vérifiez ce qui reste

SELECT 
  'Fonctions restantes' as type,
  COUNT(*) as nombre
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name NOT LIKE 'pg_%';

SELECT 
  'Politiques restantes' as type,
  COUNT(*) as nombre
FROM pg_policies
WHERE schemaname = 'public';

SELECT 
  'Vues restantes' as type,
  COUNT(*) as nombre
FROM information_schema.views
WHERE table_schema = 'public'
  AND table_name NOT LIKE 'pg_%';

-- ============================================
-- INSTRUCTIONS D'UTILISATION
-- ============================================
-- 
-- 1. EXÉCUTEZ D'ABORD LE SCRIPT SANS DÉCOMMENTER
--    Cela vous montrera ce qui sera supprimé
--
-- 2. VÉRIFIEZ LA LISTE
--    Assurez-vous qu'aucun objet important ne sera supprimé
--
-- 3. SI TOUT EST OK, DÉCOMMENTEZ LES SECTIONS 2, 3 ET 4
--    (Enlevez les /* et */ autour des blocs DO $$)
--
-- 4. EXÉCUTEZ LE SCRIPT COMPLET
--    Les objets seront supprimés
--
-- 5. EXÉCUTEZ ENSUITE reset_rls_notifications.sql
--    Pour recréer les politiques nécessaires
--
-- ============================================
-- IMPACT SUR LES UTILISATEURS
-- ============================================
-- 
-- ✅ SÉCURISÉ :
-- - Les tables et données sont préservées
-- - Les utilisateurs peuvent toujours se connecter
-- - Les données existantes ne sont pas affectées
--
-- ⚠️ TEMPORAIRE :
-- - Certaines fonctionnalités peuvent cesser de fonctionner
--   jusqu'à ce que les politiques nécessaires soient recréées
-- - Les utilisateurs connectés ne seront pas déconnectés
-- - Mais certaines opérations peuvent échouer temporairement
--
-- ✅ APRÈS NETTOYAGE :
-- - Exécutez reset_rls_notifications.sql pour recréer les politiques
-- - Tout devrait fonctionner normalement après

