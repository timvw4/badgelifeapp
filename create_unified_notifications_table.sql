-- Table unifiée pour toutes les notifications
-- Remplace subscription_notifications et suspicion_notifications

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL, -- subscription, unsubscription, suspicion_individual, suspicion_blocked, daily_tokens, sunday_bonus
  is_read BOOLEAN DEFAULT false,
  show_badge BOOLEAN DEFAULT true, -- false pour désabonnements (pas de pastille)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_date DATE GENERATED ALWAYS AS (date_trunc('day', created_at AT TIME ZONE 'UTC')::date) STORED,
  
  -- Champs spécifiques selon le type (optionnels)
  follower_id UUID REFERENCES profiles(id) ON DELETE CASCADE, -- Pour subscription/unsubscription
  badge_id UUID REFERENCES badges(id) ON DELETE CASCADE, -- Pour suspicion_individual/suspicion_blocked
  suspicious_user_id UUID REFERENCES profiles(id) ON DELETE CASCADE, -- Pour suspicion_individual
  badge_owner_id UUID REFERENCES profiles(id) ON DELETE CASCADE, -- Pour suspicion_blocked (pour les soupçonneurs)
  suspicion_count INTEGER, -- Pour suspicion_blocked
  day_str VARCHAR(10), -- Pour daily_tokens (format YYYY-MM-DD)
  token_amount INTEGER, -- Pour daily_tokens et sunday_bonus
  
  -- Métadonnées JSON pour stocker des infos supplémentaires si nécessaire
  metadata JSONB
);

-- Index pour performances
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, is_read) WHERE is_read = false;
CREATE INDEX IF NOT EXISTS idx_notifications_user_badge ON notifications(user_id, show_badge) WHERE show_badge = true AND is_read = false;
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_follower ON notifications(follower_id);
CREATE INDEX IF NOT EXISTS idx_notifications_badge ON notifications(badge_id);

-- Index unique pour éviter les doublons de notifications de connexion (même jour, même type)
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_daily_tokens_unique 
ON notifications(user_id, type, day_str) 
WHERE type IN ('daily_tokens', 'sunday_bonus');

-- Index unique pour éviter les doublons de notifications d'abonnement/désabonnement (même utilisateur, même type, même follower, même jour)
-- Utilise la colonne générée created_date qui est immutable
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_subscription_unique 
ON notifications(user_id, type, follower_id, created_date) 
WHERE type IN ('subscription', 'unsubscription');

-- RLS Policies
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Policy : Les utilisateurs peuvent voir leurs propres notifications
CREATE POLICY "Users can view their notifications" ON notifications 
FOR SELECT USING (auth.uid() = user_id);

-- Policy : Les utilisateurs peuvent mettre à jour leurs propres notifications (marquer comme lues)
CREATE POLICY "Users can update their notifications" ON notifications 
FOR UPDATE USING (auth.uid() = user_id);

-- Policy : Le système peut créer des notifications (INSERT)
CREATE POLICY "System can create notifications" ON notifications 
FOR INSERT WITH CHECK (true);

-- Policy : Les utilisateurs peuvent supprimer leurs propres notifications (optionnel, pour nettoyage)
CREATE POLICY "Users can delete their notifications" ON notifications 
FOR DELETE USING (auth.uid() = user_id);

