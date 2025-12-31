-- Fix RLS pour permettre la création de notifications d'abonnement
-- Le problème : un utilisateur A ne peut pas créer une notification pour un utilisateur B à cause de RLS
-- Solution : créer une fonction SQL avec SECURITY DEFINER qui peut créer la notification

-- 1. S'assurer que la colonne follower_id existe
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'notifications' 
        AND column_name = 'follower_id'
    ) THEN
        ALTER TABLE notifications 
        ADD COLUMN follower_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
        
        CREATE INDEX IF NOT EXISTS idx_notifications_follower_id ON notifications(follower_id);
    END IF;
END $$;

-- 2. Créer une fonction pour créer une notification d'abonnement (contourne RLS de manière sécurisée)
CREATE OR REPLACE FUNCTION create_subscription_notification(
    p_following_id UUID,  -- L'utilisateur qui reçoit la notification (celui qui est suivi)
    p_follower_id UUID    -- L'utilisateur qui s'abonne (celui qui suit)
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_notification_id UUID;
    v_exists BOOLEAN;
BEGIN
    -- Vérifier que les deux utilisateurs existent et sont différents
    IF p_following_id = p_follower_id THEN
        RAISE EXCEPTION 'Un utilisateur ne peut pas s''abonner à lui-même';
    END IF;
    
    -- Vérifier qu'il n'existe pas déjà une notification non lue du même type
    SELECT EXISTS(
        SELECT 1 
        FROM notifications 
        WHERE user_id = p_following_id 
        AND type = 'subscription' 
        AND follower_id = p_follower_id 
        AND is_read = false
    ) INTO v_exists;
    
    IF v_exists THEN
        RAISE EXCEPTION 'Notification déjà existante';
    END IF;
    
    -- Créer la notification
    INSERT INTO notifications (
        user_id,
        type,
        follower_id,
        show_badge,
        is_read
    ) VALUES (
        p_following_id,
        'subscription',
        p_follower_id,
        true,
        false
    )
    RETURNING id INTO v_notification_id;
    
    RETURN v_notification_id;
END;
$$;

-- 3. Donner les permissions nécessaires
GRANT EXECUTE ON FUNCTION create_subscription_notification(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION create_subscription_notification(UUID, UUID) TO anon;

-- 4. Optionnel : créer un trigger sur la table subscriptions pour créer automatiquement la notification
-- (Alternative : on peut aussi appeler la fonction depuis le code JavaScript)
CREATE OR REPLACE FUNCTION handle_new_subscription()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Créer une notification pour l'utilisateur qui est suivi
    PERFORM create_subscription_notification(NEW.following_id, NEW.follower_id);
    RETURN NEW;
EXCEPTION
    WHEN OTHERS THEN
        -- Ignorer les erreurs (doublons, etc.) pour ne pas bloquer l'insertion
        RETURN NEW;
END;
$$;

-- Créer le trigger
DROP TRIGGER IF EXISTS on_subscription_created ON subscriptions;
CREATE TRIGGER on_subscription_created
    AFTER INSERT ON subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION handle_new_subscription();

