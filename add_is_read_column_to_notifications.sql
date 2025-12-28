-- Migration : Ajouter la colonne is_read aux tables de notifications
-- Permet de garder les notifications affichées même après lecture

-- Ajouter is_read à subscription_notifications
ALTER TABLE subscription_notifications 
ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT false;

-- Ajouter is_read à suspicion_notifications
ALTER TABLE suspicion_notifications 
ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT false;

-- Index pour améliorer les performances lors du comptage des notifications non lues
CREATE INDEX IF NOT EXISTS idx_subscription_notifications_is_read 
ON subscription_notifications(user_id, is_read) 
WHERE is_read = false;

CREATE INDEX IF NOT EXISTS idx_suspicion_notifications_is_read 
ON suspicion_notifications(user_id, is_read) 
WHERE is_read = false;

