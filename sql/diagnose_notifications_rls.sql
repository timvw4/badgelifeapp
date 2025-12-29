-- Script de diagnostic et correction complète pour les notifications RLS
-- À exécuter dans Supabase SQL Editor

-- ============================================
-- 1. DIAGNOSTIC : Voir TOUTES les politiques existantes
-- ============================================
SELECT 
  policyname,
  cmd as commande,
  roles,
  qual as condition_using,
  with_check as condition_with_check,
  CASE 
    WHEN cmd = 'INSERT' THEN '🔵 Insertion'
    WHEN cmd = 'SELECT' THEN '🟢 Lecture'
    WHEN cmd = 'UPDATE' THEN '🟡 Mise à jour'
    WHEN cmd = 'DELETE' THEN '🔴 Suppression'
    ELSE cmd
  END as type_operation
FROM pg_policies 
WHERE tablename = 'notifications'
ORDER BY cmd, policyname;

-- ============================================
-- 2. VÉRIFIER SI RLS EST ACTIVÉ
-- ============================================
SELECT 
  schemaname,
  tablename,
  rowsecurity as rls_actif
FROM pg_tables 
WHERE tablename = 'notifications';

-- ============================================
-- 3. SUPPRIMER TOUTES LES ANCIENNES POLITIQUES D'INSERTION
-- ============================================
-- Supprimer toutes les politiques d'insertion existantes pour repartir de zéro
DROP POLICY IF EXISTS "Users can insert their own notifications" ON notifications;
DROP POLICY IF EXISTS "Authenticated users can insert notifications" ON notifications;
DROP POLICY IF EXISTS "Allow all insertions to notifications" ON notifications;
DROP POLICY IF EXISTS "Enable insert for all users" ON notifications;
DROP POLICY IF EXISTS "Public insert policy" ON notifications;

-- ============================================
-- 4. CRÉER UNE POLITIQUE TRÈS PERMISSIVE POUR L'INSERTION
-- ============================================
-- Cette politique permet à TOUS les utilisateurs (même non authentifiés) 
-- de créer des notifications. C'est nécessaire car votre système d'auth 
-- peut ne pas utiliser Supabase Auth pour les utilisateurs normaux.

DO $$
BEGIN
  -- Supprimer d'abord si elle existe déjà
  DROP POLICY IF EXISTS "Allow all insertions" ON notifications;
  
  -- Créer la politique la plus permissive possible
  CREATE POLICY "Allow all insertions"
  ON notifications
  FOR INSERT
  TO public  -- public = tous les utilisateurs (authentifiés ou non)
  WITH CHECK (true);  -- Aucune condition, tout est autorisé
  
  RAISE NOTICE '✅ Politique "Allow all insertions" créée (TO public, WITH CHECK true)';
END $$;

-- ============================================
-- 5. ALTERNATIVE : DÉSACTIVER COMPLÈTEMENT RLS (si rien ne fonctionne)
-- ============================================
-- Si les politiques ne fonctionnent toujours pas, vous pouvez désactiver RLS
-- complètement pour les insertions. DÉCOMMENTEZ les lignes ci-dessous si nécessaire :
--
-- ALTER TABLE notifications DISABLE ROW LEVEL SECURITY;
--
-- ⚠️ ATTENTION : Cela désactive TOUTES les protections RLS sur cette table.
-- Les utilisateurs pourront lire/modifier toutes les notifications.
-- Utilisez seulement si vous êtes sûr que votre code JavaScript contrôle bien l'accès.

-- ============================================
-- 6. VÉRIFICATION FINALE
-- ============================================
-- Vérifier que la nouvelle politique est créée
SELECT 
  policyname,
  cmd as commande,
  roles,
  CASE 
    WHEN cmd = 'INSERT' AND roles = '{public}' THEN '✅ Politique d''insertion publique créée'
    WHEN cmd = 'INSERT' THEN '⚠️ Politique d''insertion existe mais n''est pas publique'
    ELSE 'ℹ️ Autre politique'
  END as statut
FROM pg_policies 
WHERE tablename = 'notifications' AND cmd = 'INSERT';

-- ============================================
-- 7. TEST MANUEL (optionnel)
-- ============================================
-- Pour tester manuellement si l'insertion fonctionne, vous pouvez essayer :
-- (Remplacez les valeurs par des IDs réels de votre base de données)
--
-- INSERT INTO notifications (user_id, type, show_badge, is_read, badge_id, suspicious_user_id)
-- VALUES (
--   'VOTRE_USER_ID_ICI',
--   'suspicion_individual',
--   true,
--   false,
--   'VOTRE_BADGE_ID_ICI',
--   'VOTRE_SUSPICIOUS_USER_ID_ICI'
-- )
-- RETURNING *;
--
-- Si cette requête fonctionne, alors RLS est correctement configuré.
-- Si elle échoue avec une erreur 42501, il y a encore un problème de politique.

-- ============================================
-- NOTES IMPORTANTES
-- ============================================
-- 
-- 1. La politique créée utilise 'TO public' ce qui signifie que TOUS les utilisateurs
--    (même non authentifiés via Supabase Auth) peuvent créer des notifications.
--
-- 2. La sécurité est assurée par :
--    - Votre code JavaScript qui contrôle qui peut créer quoi
--    - Les politiques SELECT et UPDATE qui limitent la lecture/modification
--
-- 3. Si cela ne fonctionne toujours pas :
--    - Vérifiez que vous avez bien exécuté TOUT le script (pas seulement une partie)
--    - Vérifiez les logs Supabase pour voir les détails de l'erreur
--    - Essayez de désactiver complètement RLS (ligne commentée section 5)
--
-- 4. Si vous désactivez RLS, assurez-vous que votre code JavaScript contrôle bien
--    l'accès aux notifications pour éviter les fuites de données.

