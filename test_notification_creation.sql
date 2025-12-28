-- Test : Vérifier que la table notifications existe et que les permissions sont correctes

-- 1. Vérifier que la table existe
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name = 'notifications';

-- 2. Vérifier les policies RLS
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
WHERE tablename = 'notifications';

-- 3. Tester une insertion manuelle (remplace USER_ID par ton ID utilisateur)
-- INSERT INTO notifications (user_id, type, follower_id, show_badge, is_read)
-- VALUES ('TON_USER_ID_ICI', 'subscription', 'AUTRE_USER_ID_ICI', true, false)
-- RETURNING *;

-- 4. Vérifier les notifications existantes
SELECT * FROM notifications ORDER BY created_at DESC LIMIT 10;

