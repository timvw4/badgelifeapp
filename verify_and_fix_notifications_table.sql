-- Vérifier et corriger la table notifications

-- 1. Vérifier que la table existe
SELECT EXISTS (
  SELECT FROM information_schema.tables 
  WHERE table_schema = 'public' 
  AND table_name = 'notifications'
) AS table_exists;

-- 2. Si la table n'existe pas, la créer (copie depuis create_unified_notifications_table.sql)
-- Sinon, vérifier la structure
SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'notifications'
ORDER BY ordinal_position;

-- 3. Vérifier les policies RLS
SELECT 
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies 
WHERE schemaname = 'public' 
  AND tablename = 'notifications';

-- 4. Si les policies n'existent pas, les créer :
-- (Décommente les lignes suivantes si nécessaire)

-- DROP POLICY IF EXISTS "Users can view their notifications" ON notifications;
-- DROP POLICY IF EXISTS "Users can update their notifications" ON notifications;
-- DROP POLICY IF EXISTS "System can create notifications" ON notifications;
-- DROP POLICY IF EXISTS "Users can delete their notifications" ON notifications;

-- CREATE POLICY "Users can view their notifications" ON notifications 
-- FOR SELECT USING (auth.uid() = user_id);

-- CREATE POLICY "Users can update their notifications" ON notifications 
-- FOR UPDATE USING (auth.uid() = user_id);

-- CREATE POLICY "System can create notifications" ON notifications 
-- FOR INSERT WITH CHECK (true);

-- CREATE POLICY "Users can delete their notifications" ON notifications 
-- FOR DELETE USING (auth.uid() = user_id);

-- 5. Tester une insertion manuelle (remplace les IDs par de vrais IDs)
-- INSERT INTO notifications (user_id, type, follower_id, show_badge, is_read)
-- VALUES (
--   '13afe477-ecd9-4c4e-8962-d6621c973d4a'::uuid,
--   'subscription',
--   '05987e83-b147-4f73-8c82-ec8007e168e4'::uuid,
--   true,
--   false
-- )
-- RETURNING *;

