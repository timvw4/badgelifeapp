-- Activer Realtime sur la table notifications
-- Cette commande permet à Supabase d'écouter les changements en temps réel

-- Activer la publication Realtime pour la table notifications
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;

-- Vérifier que Realtime est activé (exécute cette requête pour confirmer)
SELECT 
  schemaname,
  tablename,
  pubname
FROM pg_publication_tables 
WHERE pubname = 'supabase_realtime' 
  AND tablename = 'notifications';

-- Si tu vois une ligne avec 'notifications', c'est que Realtime est activé ✅
-- Si tu ne vois rien, exécute d'abord la commande ALTER PUBLICATION ci-dessus

