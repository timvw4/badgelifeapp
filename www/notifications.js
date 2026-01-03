// Module de gestion des notifications
// Logique métier pure (pas de UI)

// ============================================
// FONCTIONS DE CRÉATION DE NOTIFICATIONS
// ============================================

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
    // Vérifier les doublons (logique uniforme pour tous les types)
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
      .select('id, show_badge, is_read, type')
      .single();
    
    if (error) {
      console.error(`❌ Erreur lors de la création de la notification ${type}:`, error);
      return { success: false, error: error.message };
    }
    
    return { success: true, notificationId: notification.id };
  } catch (err) {
    console.error(`❌ Erreur lors de la création de la notification ${type}:`, err);
    return { success: false, error: err.message };
  }
}

/**
 * Vérifie si une notification similaire existe déjà (logique uniforme)
 * @param {Object} supabase - Client Supabase
 * @param {string} userId - ID de l'utilisateur
 * @param {string} type - Type de notification
 * @param {Object} data - Données spécifiques
 * @returns {Promise<{exists: boolean}>}
 */
async function checkDuplicateNotification(supabase, userId, type, data) {
  try {
    // Logique uniforme : vérifier toutes les notifications non lues du même type
    // Pour les types avec identifiant unique (day_str, badge_id, etc.), on vérifie aussi ces champs
    
    let query = supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('type', type)
      .eq('is_read', false);
    
    // Ajouter des filtres spécifiques selon le type
    if (type === 'daily_tokens' || type === 'sunday_bonus') {
      const dayStr = data.day_str || new Date().toISOString().split('T')[0];
      query = query.eq('day_str', dayStr);
    } else if (type === 'suspicion_individual') {
      if (data.badge_id) query = query.eq('badge_id', data.badge_id);
      if (data.suspicious_user_id) query = query.eq('suspicious_user_id', data.suspicious_user_id);
    } else if (type === 'suspicion_blocked') {
      if (data.badge_id) query = query.eq('badge_id', data.badge_id);
    } else if (type === 'subscription') {
      if (data.follower_id) query = query.eq('follower_id', data.follower_id);
    }
    
    const { count } = await query;
    return { exists: (count || 0) > 0 };
  } catch (err) {
    // En cas d'erreur, on continue (mieux vaut un doublon qu'une notification manquée)
    return { exists: false };
  }
}

/**
 * Créer une notification de soupçon individuel
 */
export async function createSuspicionNotification(supabase, userId, badgeId, suspiciousUserId) {
  return await createNotification(supabase, userId, 'suspicion_individual', {
    badge_id: badgeId,
    suspicious_user_id: suspiciousUserId
  }, true);
}

/**
 * Créer une notification de badge bloqué
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
 */
export async function createDailyTokensNotification(supabase, userId, dayStr, amount) {
  return await createNotification(supabase, userId, 'daily_tokens', {
    day_str: dayStr,
    token_amount: amount
  }, true);
}

/**
 * Créer une notification de bonus dimanche
 */
export async function createSundayBonusNotification(supabase, userId, dayStr, amount = 3) {
  return await createNotification(supabase, userId, 'sunday_bonus', {
    day_str: dayStr,
    token_amount: amount
  }, true);
}

/**
 * Créer une notification d'abonnement
 * Utilise une fonction SQL avec SECURITY DEFINER pour contourner RLS
 * @param {Object} supabase - Client Supabase
 * @param {string} followingId - ID de l'utilisateur qui reçoit la notification (celui qui est suivi)
 * @param {string} followerId - ID de l'utilisateur qui s'abonne (celui qui suit)
 * @returns {Promise<{success: boolean, error?: string, notificationId?: string}>}
 */
export async function createSubscriptionNotification(supabase, followingId, followerId) {
  console.log('🔔 Création d\'une notification d\'abonnement:', {
    followingId,
    followerId
  });
  
  try {
    // Utiliser la fonction SQL qui contourne RLS de manière sécurisée
    const { data, error } = await supabase.rpc('create_subscription_notification', {
      p_following_id: followingId,
      p_follower_id: followerId
    });
    
    if (error) {
      console.error('❌ Erreur lors de la création de la notification d\'abonnement:', error);
      return { success: false, error: error.message };
    }
    
    console.log('✅ Notification d\'abonnement créée:', data);
    return { success: true, notificationId: data };
  } catch (err) {
    console.error('❌ Exception lors de la création de la notification d\'abonnement:', err);
    return { success: false, error: err.message };
  }
}

// ============================================
// FONCTIONS DE LECTURE ET GESTION
// ============================================

/**
 * Récupérer toutes les notifications (lues et non lues)
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
        badge_id,
        suspicious_user_id,
        badge_owner_id,
        suspicion_count,
        day_str,
        token_amount,
        follower_id,
        badges:badge_id (
          name
        ),
        suspicious_profiles:suspicious_user_id (
          username
        ),
        owner_profiles:badge_owner_id (
          username
        ),
        follower_profiles:follower_id (
          username
        )
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(100);
    
    if (error) {
      console.error('❌ Erreur lors de la récupération des notifications:', error);
      return [];
    }
    
    // Transformer les notifications pour un format uniforme
    return (data || []).map(notif => ({
      id: notif.id,
      type: notif.type,
      is_read: notif.is_read || false,
      show_badge: notif.show_badge !== false,
      created_at: notif.created_at,
      user_id: userId,
      badge_id: notif.badge_id,
      badge_name: notif.badges?.name || null,
      suspicious_user_id: notif.suspicious_user_id,
      suspicious_username: notif.suspicious_profiles?.username || null,
      badge_owner_id: notif.badge_owner_id,
      owner_username: notif.owner_profiles?.username || null,
      suspicion_count: notif.suspicion_count,
      day_str: notif.day_str,
      token_amount: notif.token_amount,
      follower_id: notif.follower_id,
      follower_username: notif.follower_profiles?.username || null
    }));
  } catch (err) {
    console.error('❌ Erreur lors de la récupération des notifications:', err);
    return [];
  }
}

/**
 * Marquer une notification comme lue
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
 */
export async function getUnreadNotificationsCount(supabase, userId) {
  try {
    const { data: notifications, error } = await supabase
      .from('notifications')
      .select('id, type, is_read, show_badge')
      .eq('user_id', userId)
      .eq('is_read', false)
      .eq('show_badge', true);
    
    if (error) {
      console.error('❌ Erreur lors du comptage des notifications:', error);
      return 0;
    }
    
    return notifications?.length || 0;
  } catch (err) {
    console.error('❌ Exception lors du comptage des notifications:', err);
    return 0;
  }
}

/**
 * Configurer l'écoute Realtime pour les notifications
 */
export function setupRealtimeNotifications(supabase, userId, callback) {
  const channel = supabase
    .channel(`notifications:${userId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'notifications'
      },
      (payload) => {
        const notificationUserId = payload.new?.user_id || payload.old?.user_id;
        if (notificationUserId === userId && callback) {
          callback(payload);
        }
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('✅ Realtime notifications activé pour user:', userId);
      } else if (status === 'CHANNEL_ERROR') {
        console.error('❌ Erreur lors de la souscription Realtime notifications');
      }
    });
  
  return () => {
    supabase.removeChannel(channel);
  };
}

