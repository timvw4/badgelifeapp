-- Ajouter la colonne follower_id à la table notifications pour les notifications d'abonnement
-- Cette colonne stocke l'ID de l'utilisateur qui s'abonne (celui qui suit)

-- Vérifier si la colonne existe déjà avant de l'ajouter
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
        
        -- Ajouter un index pour améliorer les performances des requêtes
        CREATE INDEX IF NOT EXISTS idx_notifications_follower_id ON notifications(follower_id);
        
        RAISE NOTICE 'Colonne follower_id ajoutée à la table notifications';
    ELSE
        RAISE NOTICE 'La colonne follower_id existe déjà dans la table notifications';
    END IF;
END $$;

