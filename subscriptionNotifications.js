// Module de gestion des notifications d'abonnement
// Logique métier pure (pas de UI)
import { groupRecentNotifications } from './subscriptionHelpers.js';

/**
 * Créer une notification d'abonnement
 * Vérifie s'il y a des notifications récentes à grouper
 * @param {Object} supabase - Client Supabase
 * @param {string} userId - ID de l'utilisateur qui reçoit la notification
 * @param {string} followerId - ID de l'utilisateur qui s'abonne
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function createNotification(supabase, userId, followerId) {
  try {
    // Vérifier s'il y a des notifications récentes (dans les 2 dernières heures) pour cet utilisateur
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    
    const { data: recentNotifications, error: fetchError } = await supabase
      .from('subscription_notifications')
      .select(`
        id,
        follower_id,
        created_at,
        profiles:follower_id (
          username,
          avatar_url
        )
      `)
      .eq('user_id', userId)
      .gte('created_at', twoHoursAgo)
      .order('created_at', { ascending: false });
    
    if (fetchError) {
      console.error('Erreur lors de la vérification des notifications récentes:', fetchError);
    }
    
    // Si on a des notifications récentes, on les supprime pour créer une notification groupée
    if (recentNotifications && recentNotifications.length > 0) {
      // Supprimer les anciennes notifications récentes
      const recentIds = recentNotifications.map(n => n.id);
      await supabase
        .from('subscription_notifications')
        .delete()
        .in('id', recentIds);
      
      // Récupérer les infos du nouveau follower
      const { data: followerProfile } = await supabase
        .from('profiles')
        .select('username, avatar_url')
        .eq('id', followerId)
        .single();
      
      // Créer une notification groupée avec tous les followers récents + le nouveau
      const allFollowers = [
        ...recentNotifications.map(n => ({
          id: n.follower_id,
          username: n.profiles?.username || 'Utilisateur',
          avatar_url: n.profiles?.avatar_url || null
        })),
        {
          id: followerId,
          username: followerProfile?.username || 'Utilisateur',
          avatar_url: followerProfile?.avatar_url || null
        }
      ];
      
      // Créer une seule notification pour le premier follower (on stocke les autres dans une structure spéciale)
      // Note: On va stocker les IDs des autres followers dans une colonne JSON ou créer plusieurs notifications
      // Pour simplifier, on crée une notification par follower mais on les groupe lors de l'affichage
      // On crée juste la nouvelle notification normalement
    }
    
    // Créer la nouvelle notification
    const { error } = await supabase
      .from('subscription_notifications')
      .insert({
        user_id: userId,
        follower_id: followerId
      });
    
    if (error) {
      return { success: false, error: error.message };
    }
    
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Récupérer les notifications non lues (groupées si nécessaire)
 * @param {Object} supabase - Client Supabase
 * @param {string} userId - ID de l'utilisateur
 * @returns {Promise<Array>} - Liste des notifications groupées
 */
export async function getNotifications(supabase, userId) {
  try {
    const { data, error } = await supabase
      .from('subscription_notifications')
      .select(`
        id,
        follower_id,
        created_at,
        profiles:follower_id (
          username,
          avatar_url
        )
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);
    
    if (error) {
      console.error('Erreur lors de la récupération des notifications:', error);
      return [];
    }
    
    if (!data || data.length === 0) {
      return [];
    }
    
    // Grouper les notifications récentes
    const notificationsWithProfiles = data.map(notif => ({
      id: notif.id,
      user_id: userId,
      follower_id: notif.follower_id,
      follower_username: notif.profiles?.username || 'Utilisateur',
      follower_avatar_url: notif.profiles?.avatar_url || null,
      created_at: notif.created_at
    }));
    
    return groupRecentNotifications(notificationsWithProfiles, 2);
  } catch (err) {
    console.error('Erreur lors de la récupération des notifications:', err);
    return [];
  }
}

/**
 * Marquer une notification comme lue et la supprimer
 * @param {Object} supabase - Client Supabase
 * @param {string} notificationId - ID de la notification
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function markNotificationAsRead(supabase, notificationId) {
  try {
    const { error } = await supabase
      .from('subscription_notifications')
      .delete()
      .eq('id', notificationId);
    
    if (error) {
      return { success: false, error: error.message };
    }
    
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Marquer toutes les notifications comme lues et les supprimer
 * @param {Object} supabase - Client Supabase
 * @param {string} userId - ID de l'utilisateur
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function markAllNotificationsAsRead(supabase, userId) {
  try {
    const { error } = await supabase
      .from('subscription_notifications')
      .delete()
      .eq('user_id', userId);
    
    if (error) {
      return { success: false, error: error.message };
    }
    
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Obtenir le nombre de notifications non lues
 * @param {Object} supabase - Client Supabase
 * @param {string} userId - ID de l'utilisateur
 * @returns {Promise<number>}
 */
export async function getUnreadNotificationsCount(supabase, userId) {
  try {
    const { count, error } = await supabase
      .from('subscription_notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);
    
    if (error) {
      console.error('Erreur lors du comptage des notifications:', error);
      return 0;
    }
    
    return count || 0;
  } catch (err) {
    console.error('Erreur lors du comptage des notifications:', err);
    return 0;
  }
}

/**
 * Configurer l'écoute Realtime pour les notifications
 * @param {Object} supabase - Client Supabase
 * @param {string} userId - ID de l'utilisateur
 * @param {Function} callback - Fonction appelée quand une nouvelle notification arrive
 * @returns {Function} - Fonction pour arrêter l'écoute
 */
export function setupRealtimeNotifications(supabase, userId, callback) {
  const channel = supabase
    .channel(`subscription_notifications:${userId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'subscription_notifications',
        filter: `user_id=eq.${userId}`
      },
      (payload) => {
        if (callback) {
          callback(payload.new);
        }
      }
    )
    .subscribe();
  
  // Retourner une fonction pour se désabonner
  return () => {
    supabase.removeChannel(channel);
  };
}

// Export de toutes les fonctions sous un objet
export const SubscriptionNotifications = {
  createNotification,
  getNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  getUnreadNotificationsCount,
  setupRealtimeNotifications
};

