-- Table des soupçons de badges
CREATE TABLE badge_suspicions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  badge_id UUID NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
  suspicious_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, badge_id, suspicious_user_id),
  CHECK(user_id != suspicious_user_id)
);

-- Index pour performances
CREATE INDEX idx_badge_suspicions_user_badge ON badge_suspicions(user_id, badge_id);
CREATE INDEX idx_badge_suspicions_suspicious_user ON badge_suspicions(suspicious_user_id);
CREATE INDEX idx_badge_suspicions_created ON badge_suspicions(created_at DESC);

-- Table des notifications de soupçons
CREATE TABLE suspicion_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  badge_id UUID NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
  suspicion_count INTEGER NOT NULL,
  badge_owner_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index pour performances
CREATE INDEX idx_suspicion_notifications_user ON suspicion_notifications(user_id);
CREATE INDEX idx_suspicion_notifications_badge ON suspicion_notifications(badge_id);
CREATE INDEX idx_suspicion_notifications_created ON suspicion_notifications(created_at DESC);

-- Ajouter la colonne is_blocked_by_suspicions à user_badges
ALTER TABLE user_badges 
ADD COLUMN IF NOT EXISTS is_blocked_by_suspicions BOOLEAN DEFAULT false;

-- Index pour la colonne is_blocked_by_suspicions
CREATE INDEX IF NOT EXISTS idx_user_badges_blocked_by_suspicions ON user_badges(is_blocked_by_suspicions) WHERE is_blocked_by_suspicions = true;

-- RLS Policies
ALTER TABLE badge_suspicions ENABLE ROW LEVEL SECURITY;
ALTER TABLE suspicion_notifications ENABLE ROW LEVEL SECURITY;

-- Policies pour badge_suspicions
-- Lecture : tout le monde peut voir les soupçons (pour compter)
CREATE POLICY "Anyone can view badge suspicions" ON badge_suspicions FOR SELECT USING (true);
-- Insertion : uniquement si l'utilisateur soupçonne (suspicious_user_id = auth.uid())
CREATE POLICY "Users can suspect badges" ON badge_suspicions FOR INSERT WITH CHECK (auth.uid() = suspicious_user_id);
-- Suppression : uniquement si l'utilisateur retire son propre soupçon
CREATE POLICY "Users can remove their own suspicion" ON badge_suspicions FOR DELETE USING (auth.uid() = suspicious_user_id);

-- Policies pour suspicion_notifications
-- Lecture : uniquement le propriétaire peut voir ses notifications
CREATE POLICY "Users can view their suspicion notifications" ON suspicion_notifications FOR SELECT USING (auth.uid() = user_id);
-- Suppression : uniquement le propriétaire peut supprimer ses notifications
CREATE POLICY "Users can delete their suspicion notifications" ON suspicion_notifications FOR DELETE USING (auth.uid() = user_id);
-- Insertion : système peut créer des notifications
CREATE POLICY "System can create suspicion notifications" ON suspicion_notifications FOR INSERT WITH CHECK (true);

