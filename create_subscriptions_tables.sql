-- Table des abonnements
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(follower_id, following_id),
  CHECK(follower_id != following_id)
);

-- Index pour performances
CREATE INDEX idx_subscriptions_follower ON subscriptions(follower_id);
CREATE INDEX idx_subscriptions_following ON subscriptions(following_id);

-- Table des notifications d'abonnement
CREATE TABLE subscription_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  follower_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index pour performances
CREATE INDEX idx_subscription_notifications_user ON subscription_notifications(user_id);
CREATE INDEX idx_subscription_notifications_follower ON subscription_notifications(follower_id);
CREATE INDEX idx_subscription_notifications_created ON subscription_notifications(created_at DESC);

-- RLS Policies
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_notifications ENABLE ROW LEVEL SECURITY;

-- Policies pour subscriptions (lecture publique, écriture authentifiée)
CREATE POLICY "Anyone can view subscriptions" ON subscriptions FOR SELECT USING (true);
CREATE POLICY "Users can subscribe" ON subscriptions FOR INSERT WITH CHECK (auth.uid() = follower_id);
CREATE POLICY "Users can unsubscribe" ON subscriptions FOR DELETE USING (auth.uid() = follower_id);

-- Policies pour notifications (lecture par propriétaire, écriture par système)
CREATE POLICY "Users can view their notifications" ON subscription_notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their notifications" ON subscription_notifications FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "System can create notifications" ON subscription_notifications FOR INSERT WITH CHECK (true);

