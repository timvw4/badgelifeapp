// Module de gestion des notifications unifiées
// Gère tous les types de notifications dans une table unique

/**
 * Fonction générique pour créer une notification
 * @param {Object} supabase - Client Supabase
 * @param {string} userId - ID de l'utilisateur qui reçoit la notification
 * @param {string} type - Type de notification
 * @param {Object} data - Données spécifiques selon le type
 * @param {boolean} showBadge - Si true, affiche la pastille (défaut: true)
 * @returns {Promise<{success: boolean, error?: string, notificationId?: string}>}
 */
async function createNotification(supabase, userId, type, data = {}, showBadge = true) {
  try {
    // Vérifier les doublons selon le type
    const duplicateCheck = await checkDuplicateNotification(supabase, userId, type, data);
    if (duplicateCheck.exists) {
      return { success: false, error: 'Notification déjà existante' };
    }
    
    const notificationData = {
      user_id: userId,
      type: type,
      show_badge: showBadge,
      is_read: false,
      ...data
    };
    
    const { data: notification, error } = await supabase
      .from('notifications')
      .insert(notificationData)
      .select('id')
      .single();
    
    if (error) {
      console.error(`Erreur lors de la création de la notification ${type}:`, error);
      return { success: false, error: error.message };
    }
    
    return { success: true, notificationId: notification.id };
  } catch (err) {
    console.error(`Erreur lors de la création de la notification ${type}:`, err);
    return { success: false, error: err.message };
  }
}

/**
 * Vérifie si une notification similaire existe déjà (prévention des doublons)
 * @param {Object} supabase - Client Supabase
 * @param {string} userId - ID de l'utilisateur
 * @param {string} type - Type de notification
 * @param {Object} data - Données spécifiques
 * @returns {Promise<{exists: boolean}>}
 */
async function checkDuplicateNotification(supabase, userId, type, data) {
  try {
    // Pour les notifications de connexion, vérifier par jour
    if (type === 'daily_tokens' || type === 'sunday_bonus') {
      const { count } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('type', type)
        .eq('day_str', data.day_str || new Date().toISOString().split('T')[0]);
      
      return { exists: (count || 0) > 0 };
    }
    
    // Pour les abonnements/désabonnements, vérifier par follower et jour
    if (type === 'subscription' || type === 'unsubscription') {
      const today = new Date().toISOString().split('T')[0];
      const { count } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('type', type)
        .eq('follower_id', data.follower_id)
        .gte('created_at', `${today}T00:00:00Z`)
        .lt('created_at', `${today}T23:59:59Z`);
      
      return { exists: (count || 0) > 0 };
    }
    
    // Pour les soupçons, vérifier par badge et utilisateur soupçonneur
    if (type === 'suspicion_individual') {
      const { count } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('type', type)
        .eq('badge_id', data.badge_id)
        .eq('suspicious_user_id', data.suspicious_user_id)
        .eq('is_read', false); // Seulement les non lues
      
      return { exists: (count || 0) > 0 };
    }
    
    // Pour les blocages, vérifier par badge (une seule notification de blocage par badge)
    if (type === 'suspicion_blocked') {
      const { count } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('type', type)
        .eq('badge_id', data.badge_id)
        .eq('is_read', false); // Seulement les non lues
      
      return { exists: (count || 0) > 0 };
    }
    
    return { exists: false };
  } catch (err) {
    console.error('Erreur lors de la vérification des doublons:', err);
    return { exists: false }; // En cas d'erreur, on continue (mieux vaut un doublon qu'une notification manquée)
  }
}

/**
 * Créer une notification d'abonnement
 * @param {Object} supabase - Client Supabase
 * @param {string} userId - ID de l'utilisateur qui reçoit la notification
 * @param {string} followerId - ID de l'utilisateur qui s'abonne
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function createSubscriptionNotification(supabase, userId, followerId) {
  return await createNotification(supabase, userId, 'subscription', {
    follower_id: followerId
  }, true);
}

/**
 * Créer une notification de désabonnement (discrète, pas de pastille)
 * @param {Object} supabase - Client Supabase
 * @param {string} userId - ID de l'utilisateur qui reçoit la notification
 * @param {string} followerId - ID de l'utilisateur qui se désabonne
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function createUnsubscriptionNotification(supabase, userId, followerId) {
  return await createNotification(supabase, userId, 'unsubscription', {
    follower_id: followerId
  }, false); // show_badge = false (pas de pastille)
}

/**
 * Créer une notification de soupçon individuel
 * @param {Object} supabase - Client Supabase
 * @param {string} userId - ID de l'utilisateur propriétaire du badge
 * @param {string} badgeId - ID du badge soupçonné
 * @param {string} suspiciousUserId - ID de l'utilisateur qui soupçonne
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function createSuspicionNotification(supabase, userId, badgeId, suspiciousUserId) {
  return await createNotification(supabase, userId, 'suspicion_individual', {
    badge_id: badgeId,
    suspicious_user_id: suspiciousUserId
  }, true);
}

/**
 * Créer une notification de badge bloqué
 * @param {Object} supabase - Client Supabase
 * @param {string} userId - ID de l'utilisateur qui reçoit la notification
 * @param {string} badgeId - ID du badge bloqué
 * @param {number} suspicionCount - Nombre de soupçons
 * @param {string} badgeOwnerId - ID du propriétaire du badge (pour les soupçonneurs)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function createBlockedBadgeNotification(supabase, userId, badgeId, suspicionCount, badgeOwnerId = null) {
  return await createNotification(supabase, userId, 'suspicion_blocked', {
    badge_id: badgeId,
    suspicion_count: suspicionCount,
    badge_owner_id: badgeOwnerId
  }, true);
}

/**
 * Créer une notification de jetons journaliers
 * @param {Object} supabase - Client Supabase
 * @param {string} userId - ID de l'utilisateur
 * @param {string} dayStr - Date au format YYYY-MM-DD
 * @param {number} amount - Nombre de jetons obtenus
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function createDailyTokensNotification(supabase, userId, dayStr, amount) {
  return await createNotification(supabase, userId, 'daily_tokens', {
    day_str: dayStr,
    token_amount: amount
  }, true);
}

/**
 * Créer une notification de bonus dimanche
 * @param {Object} supabase - Client Supabase
 * @param {string} userId - ID de l'utilisateur
 * @param {string} dayStr - Date du dimanche au format YYYY-MM-DD
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function createSundayBonusNotification(supabase, userId, dayStr) {
  return await createNotification(supabase, userId, 'sunday_bonus', {
    day_str: dayStr,
    token_amount: 3
  }, true);
}

/**
 * Récupérer toutes les notifications (lues et non lues)
 * @param {Object} supabase - Client Supabase
 * @param {string} userId - ID de l'utilisateur
 * @returns {Promise<Array>} - Liste des notifications
 */
export async function getNotifications(supabase, userId) {
  try {
    const { data, error } = await supabase
      .from('notifications')
      .select(`
        id,
        type,
        is_read,
        show_badge,
        created_at,
        follower_id,
        badge_id,
        suspicious_user_id,
        badge_owner_id,
        suspicion_count,
        day_str,
        token_amount,
        profiles:follower_id (
          username,
          avatar_url
        ),
        badges:badge_id (
          name
        ),
        suspicious_profiles:suspicious_user_id (
          username
        ),
        owner_profiles:badge_owner_id (
          username
        )
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(100);
    
    if (error) {
      console.error('Erreur lors de la récupération des notifications:', error);
      return [];
    }
    
    // Transformer les notifications pour un format uniforme
    return (data || []).map(notif => ({
      id: notif.id,
      type: notif.type,
      is_read: notif.is_read || false,
      show_badge: notif.show_badge !== false, // Par défaut true
      created_at: notif.created_at,
      // Données spécifiques selon le type
      follower_id: notif.follower_id,
      follower_username: notif.profiles?.username || null,
      follower_avatar_url: notif.profiles?.avatar_url || null,
      badge_id: notif.badge_id,
      badge_name: notif.badges?.name || null,
      suspicious_user_id: notif.suspicious_user_id,
      suspicious_username: notif.suspicious_profiles?.username || null,
      badge_owner_id: notif.badge_owner_id,
      owner_username: notif.owner_profiles?.username || null,
      suspicion_count: notif.suspicion_count,
      day_str: notif.day_str,
      token_amount: notif.token_amount
    }));
  } catch (err) {
    console.error('Erreur lors de la récupération des notifications:', err);
    return [];
  }
}

/**
 * Marquer une notification comme lue
 * @param {Object} supabase - Client Supabase
 * @param {string} notificationId - ID de la notification
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function markNotificationAsRead(supabase, notificationId) {
  try {
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
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
 * Marquer toutes les notifications comme lues
 * @param {Object} supabase - Client Supabase
 * @param {string} userId - ID de l'utilisateur
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function markAllNotificationsAsRead(supabase, userId) {
  try {
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', userId)
      .eq('is_read', false);
    
    if (error) {
      return { success: false, error: error.message };
    }
    
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Obtenir le nombre de notifications non lues (seulement celles avec show_badge = true)
 * @param {Object} supabase - Client Supabase
 * @param {string} userId - ID de l'utilisateur
 * @returns {Promise<number>}
 */
export async function getUnreadNotificationsCount(supabase, userId) {
  try {
    const { count, error } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false)
      .eq('show_badge', true); // Seulement celles qui doivent afficher la pastille
    
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
 * @param {Function} callback - Fonction appelée quand une notification change
 * @returns {Function} - Fonction pour arrêter l'écoute
 */
export function setupRealtimeNotifications(supabase, userId, callback) {
  const channel = supabase
    .channel(`notifications:${userId}`)
    .on(
      'postgres_changes',
      {
        event: '*', // INSERT, UPDATE, DELETE
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${userId}`
      },
      (payload) => {
        console.log('🔔 Notification Realtime détectée:', payload.eventType, payload);
        if (callback) {
          callback(payload);
        }
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('✅ Realtime notifications activé avec succès pour user:', userId);
      } else if (status === 'CHANNEL_ERROR') {
        console.error('❌ Erreur lors de la souscription Realtime notifications');
      } else {
        console.log('📡 Statut Realtime notifications:', status);
      }
    });
  
  return () => {
    console.log('🔌 Arrêt de l\'écoute Realtime des notifications');
    supabase.removeChannel(channel);
  };
}

// Export de toutes les fonctions
export const NotificationService = {
  createSubscriptionNotification,
  createUnsubscriptionNotification,
  createSuspicionNotification,
  createBlockedBadgeNotification,
  createDailyTokensNotification,
  createSundayBonusNotification,
  getNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  getUnreadNotificationsCount,
  setupRealtimeNotifications
};
