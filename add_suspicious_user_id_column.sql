-- Ajouter la colonne suspicious_user_id à la table suspicion_notifications
-- Cette colonne stocke l'ID de l'utilisateur qui a soupçonné le badge
-- pour les notifications individuelles de soupçon

ALTER TABLE suspicion_notifications
ADD COLUMN IF NOT EXISTS suspicious_user_id UUID REFERENCES profiles(id) ON DELETE CASCADE;

-- Index pour améliorer les performances des requêtes
CREATE INDEX IF NOT EXISTS idx_suspicion_notifications_suspicious_user ON suspicion_notifications(suspicious_user_id);

