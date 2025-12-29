-- ============================================
-- RÉINITIALISATION COMPLÈTE DE RLS POUR notifications
-- ============================================
-- Ce script supprime TOUTES les politiques existantes et en crée de nouvelles
-- À exécuter dans Supabase SQL Editor
--
-- ⚠️ ATTENTION : Ce script va supprimer toutes les politiques existantes
-- Assurez-vous d'avoir sauvegardé votre base de données si nécessaire

-- ============================================
-- ÉTAPE 1 : VOIR L'ÉTAT ACTUEL
-- ============================================
SELECT 
  'État actuel des politiques' as etape,
  policyname,
  cmd,
  roles
FROM pg_policies 
WHERE tablename = 'notifications'
ORDER BY cmd, policyname;

-- ============================================
-- ÉTAPE 2 : SUPPRIMER TOUTES LES POLITIQUES EXISTANTES
-- ============================================
-- On supprime toutes les politiques pour repartir de zéro

DO $$
DECLARE
  policy_record RECORD;
BEGIN
  -- Supprimer toutes les politiques d'insertion
  FOR policy_record IN 
    SELECT policyname 
    FROM pg_policies 
    WHERE tablename = 'notifications' AND cmd = 'INSERT'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON notifications', policy_record.policyname);
    RAISE NOTICE '✅ Politique supprimée: %', policy_record.policyname;
  END LOOP;
  
  -- Supprimer toutes les politiques de lecture
  FOR policy_record IN 
    SELECT policyname 
    FROM pg_policies 
    WHERE tablename = 'notifications' AND cmd = 'SELECT'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON notifications', policy_record.policyname);
    RAISE NOTICE '✅ Politique supprimée: %', policy_record.policyname;
  END LOOP;
  
  -- Supprimer toutes les politiques de mise à jour
  FOR policy_record IN 
    SELECT policyname 
    FROM pg_policies 
    WHERE tablename = 'notifications' AND cmd = 'UPDATE'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON notifications', policy_record.policyname);
    RAISE NOTICE '✅ Politique supprimée: %', policy_record.policyname;
  END LOOP;
  
  -- Supprimer toutes les politiques de suppression
  FOR policy_record IN 
    SELECT policyname 
    FROM pg_policies 
    WHERE tablename = 'notifications' AND cmd = 'DELETE'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON notifications', policy_record.policyname);
    RAISE NOTICE '✅ Politique supprimée: %', policy_record.policyname;
  END LOOP;
END $$;

-- ============================================
-- ÉTAPE 3 : DÉSACTIVER PUIS RÉACTIVER RLS
-- ============================================
-- On désactive RLS pour s'assurer qu'il n'y a pas de résidus
ALTER TABLE notifications DISABLE ROW LEVEL SECURITY;

-- Puis on le réactive proprement
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- ============================================
-- ÉTAPE 4 : CRÉER LES NOUVELLES POLITIQUES PROPREMENT
-- ============================================

-- --------------------------------------------
-- 4.1 POLITIQUE D'INSERTION
-- --------------------------------------------
-- Permet à TOUS les utilisateurs (authentifiés ou non) d'insérer des notifications
-- C'est nécessaire car votre système peut créer des notifications pour d'autres utilisateurs
-- 
-- IMPORTANT : On crée DEUX politiques pour couvrir tous les cas :
-- - Une pour 'public' (utilisateurs non authentifiés avec clé anon)
-- - Une pour 'authenticated' (utilisateurs authentifiés via Supabase Auth)

-- Politique pour les utilisateurs non authentifiés (clé anon)
CREATE POLICY "notifications_insert_public"
ON notifications
FOR INSERT
TO public
WITH CHECK (true);

-- Politique pour les utilisateurs authentifiés (Supabase Auth)
CREATE POLICY "notifications_insert_authenticated"
ON notifications
FOR INSERT
TO authenticated
WITH CHECK (true);

-- --------------------------------------------
-- 4.2 POLITIQUE DE LECTURE
-- --------------------------------------------
-- Permet à un utilisateur de lire uniquement SES PROPRES notifications
-- Utilise auth.uid() pour vérifier que l'utilisateur est authentifié via Supabase Auth
CREATE POLICY "notifications_select_own"
ON notifications
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Si vous avez aussi besoin que les utilisateurs non authentifiés puissent lire
-- (peu probable, mais au cas où), décommentez cette politique :
-- CREATE POLICY "notifications_select_own_public"
-- ON notifications
-- FOR SELECT
-- TO public
-- USING (user_id = auth.uid());

-- --------------------------------------------
-- 4.3 POLITIQUE DE MISE À JOUR
-- --------------------------------------------
-- Permet à un utilisateur de modifier uniquement SES PROPRES notifications
-- (par exemple, marquer comme lu)
CREATE POLICY "notifications_update_own"
ON notifications
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- --------------------------------------------
-- 4.4 POLITIQUE DE SUPPRESSION (optionnel)
-- --------------------------------------------
-- Par défaut, on ne permet pas la suppression
-- Si vous avez besoin de permettre la suppression, décommentez :
-- CREATE POLICY "notifications_delete_own"
-- ON notifications
-- FOR DELETE
-- TO authenticated
-- USING (user_id = auth.uid());

-- ============================================
-- ÉTAPE 5 : VÉRIFICATION FINALE
-- ============================================
SELECT 
  '✅ Politiques créées' as etape,
  policyname,
  cmd as commande,
  roles,
  CASE 
    WHEN cmd = 'INSERT' AND roles = '{public}' THEN '✅ Insertion autorisée pour tous'
    WHEN cmd = 'SELECT' AND roles = '{authenticated}' THEN '✅ Lecture autorisée (ses propres notifications)'
    WHEN cmd = 'UPDATE' AND roles = '{authenticated}' THEN '✅ Mise à jour autorisée (ses propres notifications)'
    ELSE 'ℹ️ Autre'
  END as description
FROM pg_policies 
WHERE tablename = 'notifications'
ORDER BY 
  CASE cmd
    WHEN 'INSERT' THEN 1
    WHEN 'SELECT' THEN 2
    WHEN 'UPDATE' THEN 3
    WHEN 'DELETE' THEN 4
    ELSE 5
  END,
  policyname;

-- Vérifier que RLS est bien activé
SELECT 
  'État RLS' as etape,
  tablename,
  rowsecurity as rls_actif,
  CASE 
    WHEN rowsecurity = true THEN '✅ RLS activé'
    ELSE '❌ RLS désactivé'
  END as statut
FROM pg_tables 
WHERE tablename = 'notifications';

-- ============================================
-- NOTES IMPORTANTES
-- ============================================
-- 
-- 1. POLITIQUE D'INSERTION (notifications_insert_all)
--    - Utilise 'TO public' : permet à tous (authentifiés ou non) d'insérer
--    - Utilise 'WITH CHECK (true)' : aucune condition, tout est autorisé
--    - C'est nécessaire car votre code crée des notifications pour d'autres utilisateurs
--
-- 2. POLITIQUE DE LECTURE (notifications_select_own)
--    - Utilise 'TO authenticated' : seulement les utilisateurs authentifiés via Supabase Auth
--    - Utilise 'USING (user_id = auth.uid())' : seulement ses propres notifications
--    - Si vos utilisateurs normaux ne sont pas authentifiés via Supabase Auth,
--      cette politique ne fonctionnera pas pour eux
--
-- 3. POLITIQUE DE MISE À JOUR (notifications_update_own)
--    - Même principe que la lecture : seulement ses propres notifications
--
-- 4. SÉCURITÉ
--    - L'insertion est ouverte, mais votre code JavaScript contrôle qui peut créer quoi
--    - La lecture et la mise à jour sont restreintes aux propres notifications
--
-- 5. SI LA LECTURE NE FONCTIONNE PAS
--    - Si vos utilisateurs normaux ne sont pas authentifiés via Supabase Auth,
--      vous devrez modifier la politique de lecture pour utiliser 'TO public'
--      et une autre méthode de vérification (par exemple, passer l'user_id en paramètre)

-- ============================================
-- TEST MANUEL (optionnel)
-- ============================================
-- Pour tester si l'insertion fonctionne, vous pouvez essayer :
-- (Remplacez les valeurs par des IDs réels)
--
-- INSERT INTO notifications (user_id, type, show_badge, is_read, badge_id, suspicious_user_id)
-- VALUES (
--   '05987e83-b147-4f73-8c82-ec8007e168e4'::UUID,
--   'suspicion_individual',
--   true,
--   false,
--   'd092b299-6628-4161-af13-3929a40aadfc'::UUID,
--   '13afe477-ecd9-4c4e-8962-d6621c973d4a'::UUID
-- )
-- RETURNING *;
--
-- Si cette insertion fonctionne, alors RLS est correctement configuré.

