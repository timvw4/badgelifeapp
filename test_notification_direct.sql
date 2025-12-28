-- Test direct : Créer une notification manuellement pour vérifier que tout fonctionne
-- Remplace les IDs par de vrais IDs de ton application

-- 1. Vérifier que la table existe et est accessible
SELECT COUNT(*) as total_notifications FROM notifications;

-- 2. Tester une insertion directe (remplace les UUIDs par de vrais IDs)
-- Décommente et modifie les lignes suivantes :

/*
INSERT INTO notifications (
  user_id, 
  type, 
  follower_id, 
  show_badge, 
  is_read
) VALUES (
  '13afe477-ecd9-4c4e-8962-d6621c973d4a'::uuid,  -- Remplace par un vrai user_id
  'subscription',
  '05987e83-b147-4f73-8c82-ec8007e168e4'::uuid,  -- Remplace par un vrai follower_id
  true,
  false
)
RETURNING *;
*/

-- 3. Vérifier les notifications créées
SELECT * FROM notifications ORDER BY created_at DESC LIMIT 10;

-- 4. Vérifier les policies RLS
SELECT 
  policyname,
  cmd,
  qual,
  with_check
FROM pg_policies 
WHERE tablename = 'notifications';

