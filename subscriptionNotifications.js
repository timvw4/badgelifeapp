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
    // Récupérer les notifications d'abonnement
    const { data: subscriptionData, error: subscriptionError } = await supabase
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
    
    if (subscriptionError) {
      console.error('Erreur lors de la récupération des notifications d\'abonnement:', subscriptionError);
    }
    
    // Récupérer les notifications de soupçon
    const { data: suspicionData, error: suspicionError } = await supabase
      .from('suspicion_notifications')
      .select(`
        id,
        badge_id,
        suspicion_count,
        badge_owner_id,
        suspicious_user_id,
        created_at,
        badges:badge_id (
          name
        ),
        profiles:badge_owner_id (
          username
        ),
        suspicious_profiles:suspicious_user_id (
          username
        )
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);
    
    if (suspicionError) {
      console.error('Erreur lors de la récupération des notifications de soupçon:', suspicionError);
    }
    
    // Transformer les notifications d'abonnement
    const subscriptionNotifications = (subscriptionData || []).map(notif => ({
      id: notif.id,
      type: 'subscription',
      user_id: userId,
      follower_id: notif.follower_id,
      follower_username: notif.profiles?.username || 'Utilisateur',
      follower_avatar_url: notif.profiles?.avatar_url || null,
      created_at: notif.created_at
    }));
    
    // Transformer les notifications de soupçon
    const suspicionNotifications = (suspicionData || []).map(notif => ({
      id: notif.id,
      type: 'suspicion',
      user_id: userId,
      badge_id: notif.badge_id,
      badge_name: notif.badges?.name || 'ce badge',
      suspicion_count: notif.suspicion_count,
      badge_owner_id: notif.badge_owner_id || null,
      suspicious_user_id: notif.suspicious_user_id || null,
      suspicious_username: notif.suspicious_profiles?.username || null,
      profiles: notif.profiles || null,
      created_at: notif.created_at
    }));
    
    // Fusionner et trier par date
    const allNotifications = [...subscriptionNotifications, ...suspicionNotifications]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 50);
    
    // Grouper les notifications d'abonnement récentes
    const subscriptionOnly = allNotifications.filter(n => n.type === 'subscription');
    const groupedSubscriptions = groupRecentNotifications(subscriptionOnly, 2);
    
    // Ajouter les notifications de soupçon (non groupées)
    const suspicionOnly = allNotifications.filter(n => n.type === 'suspicion');
    
    return [...groupedSubscriptions, ...suspicionOnly]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
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
    // Essayer de supprimer depuis subscription_notifications
    const { error: subError } = await supabase
      .from('subscription_notifications')
      .delete()
      .eq('id', notificationId);
    
    if (!subError) {
      return { success: true };
    }
    
    // Si pas trouvé, essayer depuis suspicion_notifications
    const { error: susError } = await supabase
      .from('suspicion_notifications')
      .delete()
      .eq('id', notificationId);
    
    if (susError) {
      return { success: false, error: susError.message };
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
    // Supprimer les notifications d'abonnement
    const { error: subError } = await supabase
      .from('subscription_notifications')
      .delete()
      .eq('user_id', userId);
    
    if (subError) {
      console.error('Erreur lors de la suppression des notifications d\'abonnement:', subError);
    }
    
    // Supprimer les notifications de soupçon
    const { error: susError } = await supabase
      .from('suspicion_notifications')
      .delete()
      .eq('user_id', userId);
    
    if (susError) {
      return { success: false, error: susError.message };
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
    // Compter les notifications d'abonnement
    const { count: subCount, error: subError } = await supabase
      .from('subscription_notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);
    
    if (subError) {
      console.error('Erreur lors du comptage des notifications d\'abonnement:', subError);
    }
    
    // Compter les notifications de soupçon
    const { count: susCount, error: susError } = await supabase
      .from('suspicion_notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);
    
    if (susError) {
      console.error('Erreur lors du comptage des notifications de soupçon:', susError);
    }
    
    return (subCount || 0) + (susCount || 0);
  } catch (err) {
    console.error('Erreur lors du comptage des notifications:', err);
    return 0;
  }
}

/**
 * Configurer l'écoute Realtime pour les notifications
 * Écoute à la fois les notifications d'abonnement et de soupçon
 * Filtre côté client pour éviter les problèmes avec RLS
 * @param {Object} supabase - Client Supabase
 * @param {string} userId - ID de l'utilisateur
 * @param {Function} callback - Fonction appelée quand une nouvelle notification arrive
 * @returns {Function} - Fonction pour arrêter l'écoute
 */
export function setupRealtimeNotifications(supabase, userId, callback) {
  console.log('🔔 Configuration Realtime pour les notifications, userId:', userId);
  
  const channel = supabase
    .channel(`notifications:${userId}`)
    // Écouter tous les événements sur subscription_notifications et filtrer côté client
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'subscription_notifications'
        // Pas de filter ici, on filtre côté client pour éviter les problèmes RLS
      },
      (payload) => {
        console.log('🔔 Événement détecté sur subscription_notifications:', payload);
        // Filtrer côté client : seulement si c'est pour cet utilisateur
        if (payload.new && payload.new.user_id === userId) {
          console.log('🔔 Nouvelle notification d\'abonnement reçue pour cet utilisateur:', payload.new);
          if (callback) {
            callback(payload.new);
          }
        } else {
          console.log('🔔 Notification ignorée (pas pour cet utilisateur)');
        }
      }
    )
    // Écouter tous les événements sur suspicion_notifications et filtrer côté client
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'suspicion_notifications'
        // Pas de filter ici, on filtre côté client pour éviter les problèmes RLS
      },
      (payload) => {
        console.log('🔔 Événement détecté sur suspicion_notifications:', payload);
        // Filtrer côté client : seulement si c'est pour cet utilisateur
        if (payload.new && payload.new.user_id === userId) {
          console.log('🔔 Nouvelle notification de soupçon reçue pour cet utilisateur:', payload.new);
          if (callback) {
            callback(payload.new);
          }
        } else {
          console.log('🔔 Notification ignorée (pas pour cet utilisateur)');
        }
      }
    )
    .subscribe((status) => {
      console.log('🔔 Statut de la subscription Realtime:', status);
      if (status === 'SUBSCRIBED') {
        console.log('✅ Écoute Realtime activée pour les notifications');
      } else if (status === 'CHANNEL_ERROR') {
        console.error('❌ Erreur lors de la connexion Realtime pour les notifications');
      } else if (status === 'TIMED_OUT') {
        console.error('❌ Timeout lors de la connexion Realtime pour les notifications');
      } else if (status === 'CLOSED') {
        console.warn('⚠️ Canal Realtime fermé pour les notifications');
      }
    });
  
  // Retourner une fonction pour se désabonner
  return () => {
    console.log('🔕 Arrêt de l\'écoute Realtime pour les notifications');
    supabase.removeChannel(channel);
  };
}

/**
 * Créer une notification pour un soupçon individuel
 * @param {Object} supabase - Client Supabase
 * @param {string} userId - ID de l'utilisateur propriétaire du badge
 * @param {string} badgeId - ID du badge soupçonné
 * @param {string} suspiciousUserId - ID de l'utilisateur qui soupçonne
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function createIndividualSuspicionNotification(supabase, userId, badgeId, suspiciousUserId) {
  try {
    // Récupérer le nom du badge
    const { data: badgeData, error: badgeError } = await supabase
      .from('badges')
      .select('name')
      .eq('id', badgeId)
      .single();
    
    if (badgeError || !badgeData) {
      console.error('Erreur lors de la récupération du badge:', badgeError);
      return { success: false, error: 'Badge introuvable' };
    }
    
    // Compter les soupçons actuels
    const { count } = await supabase
      .from('badge_suspicions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('badge_id', badgeId);
    
    const suspicionCount = (count || 0);
    
    // Créer une notification pour le propriétaire du badge
    // Utiliser suspicion_count = 1 et ne pas mettre badge_owner_id pour indiquer que c'est un soupçon individuel
    const { error: notificationError } = await supabase
      .from('suspicion_notifications')
      .insert({
        user_id: userId,
        badge_id: badgeId,
        suspicion_count: suspicionCount,
        suspicious_user_id: suspiciousUserId // Stocker l'ID de l'utilisateur qui soupçonne
      });
    
    if (notificationError) {
      console.error('Erreur lors de la création de la notification de soupçon:', notificationError);
      return { success: false, error: notificationError.message };
    }
    
    return { success: true };
  } catch (err) {
    console.error('Erreur lors de la création de la notification de soupçon:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Créer des notifications pour un badge bloqué par soupçons
 * @param {Object} supabase - Client Supabase
 * @param {string} userId - ID de l'utilisateur propriétaire du badge
 * @param {string} badgeId - ID du badge bloqué
 * @param {number} suspicionCount - Nombre de soupçons
 * @param {Array<string>} suspiciousUserIds - Liste des IDs des utilisateurs qui ont soupçonné
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function createSuspicionNotifications(supabase, userId, badgeId, suspicionCount, suspiciousUserIds) {
  try {
    // Récupérer le nom du badge
    const { data: badgeData, error: badgeError } = await supabase
      .from('badges')
      .select('name')
      .eq('id', badgeId)
      .single();
    
    if (badgeError || !badgeData) {
      console.error('Erreur lors de la récupération du badge:', badgeError);
      return { success: false, error: 'Badge introuvable' };
    }
    
    const badgeName = badgeData.name || 'ce badge';
    
    // Récupérer le nom d'utilisateur du propriétaire
    const { data: userData, error: userError } = await supabase
      .from('profiles')
      .select('username')
      .eq('id', userId)
      .single();
    
    if (userError || !userData) {
      console.error('Erreur lors de la récupération du profil:', userError);
      return { success: false, error: 'Profil introuvable' };
    }
    
    const username = userData.username || 'Utilisateur';
    
    // Créer une notification pour le propriétaire du badge
    const { error: ownerError } = await supabase
      .from('suspicion_notifications')
      .insert({
        user_id: userId,
        badge_id: badgeId,
        suspicion_count: suspicionCount
      });
    
    if (ownerError) {
      console.error('Erreur lors de la création de la notification pour le propriétaire:', ownerError);
      return { success: false, error: ownerError.message };
    }
    
    // Créer une notification pour chaque soupçonneur
    // Note: On stocke le badge_id et suspicion_count, mais le message sera formaté dans notificationUI.js
    if (suspiciousUserIds && suspiciousUserIds.length > 0) {
      const notifications = suspiciousUserIds.map(suspiciousUserId => ({
        user_id: suspiciousUserId,
        badge_id: badgeId,
        suspicion_count: suspicionCount,
        // Stocker l'ID du propriétaire du badge pour le message
        badge_owner_id: userId
      }));
      
      const { error: suspiciousError } = await supabase
        .from('suspicion_notifications')
        .insert(notifications);
      
      if (suspiciousError) {
        console.error('Erreur lors de la création des notifications pour les soupçonneurs:', suspiciousError);
        // On continue quand même, la notification du propriétaire a été créée
      }
    }
    
    return { success: true };
  } catch (err) {
    console.error('Erreur lors de la création des notifications de soupçon:', err);
    return { success: false, error: err.message };
  }
}

// Export de toutes les fonctions sous un objet
export const SubscriptionNotifications = {
  createNotification,
  getNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  getUnreadNotificationsCount,
  setupRealtimeNotifications,
  createSuspicionNotifications,
  createIndividualSuspicionNotification
};

