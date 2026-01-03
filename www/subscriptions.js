// Module de gestion des abonnements
// Logique métier pure (pas de UI)

/**
 * S'abonner à un utilisateur
 * @param {Object} supabase - Client Supabase
 * @param {string} followerId - ID de l'utilisateur qui s'abonne
 * @param {string} followingId - ID de l'utilisateur à suivre
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function subscribeToUser(supabase, followerId, followingId) {
  if (followerId === followingId) {
    return { success: false, error: 'Tu ne peux pas t\'abonner à toi-même.' };
  }
  
  try {
    const { error } = await supabase
      .from('subscriptions')
      .insert({
        follower_id: followerId,
        following_id: followingId
      });
    
    if (error) {
      if (error.code === '23505') {
        // Déjà abonné
        return { success: false, error: 'Tu es déjà abonné à cet utilisateur.' };
      }
      return { success: false, error: error.message };
    }
    
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Se désabonner d'un utilisateur
 * @param {Object} supabase - Client Supabase
 * @param {string} followerId - ID de l'utilisateur qui se désabonne
 * @param {string} followingId - ID de l'utilisateur à ne plus suivre
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function unsubscribeFromUser(supabase, followerId, followingId) {
  try {
    const { error } = await supabase
      .from('subscriptions')
      .delete()
      .eq('follower_id', followerId)
      .eq('following_id', followingId);
    
    if (error) {
      return { success: false, error: error.message };
    }
    
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Obtenir le nombre d'abonnements d'un utilisateur
 * @param {Object} supabase - Client Supabase
 * @param {string} userId - ID de l'utilisateur
 * @returns {Promise<number>}
 */
export async function getSubscriptionsCount(supabase, userId) {
  try {
    console.log('🔢 getSubscriptionsCount appelé pour userId:', userId);
    const { count, error } = await supabase
      .from('subscriptions')
      .select('*', { count: 'exact', head: true })
      .eq('follower_id', userId);
    
    if (error) {
      console.error('❌ Erreur lors du comptage des abonnements:', error);
      return 0;
    }
    
    const result = count || 0;
    console.log('✅ Nombre d\'abonnements récupéré:', result, 'pour userId:', userId);
    return result;
  } catch (err) {
    console.error('❌ Exception lors du comptage des abonnements:', err);
    return 0;
  }
}

/**
 * Obtenir le nombre d'abonnés d'un utilisateur
 * @param {Object} supabase - Client Supabase
 * @param {string} userId - ID de l'utilisateur
 * @returns {Promise<number>}
 */
export async function getFollowersCount(supabase, userId) {
  try {
    console.log('🔢 getFollowersCount appelé pour userId:', userId);
    const { count, error } = await supabase
      .from('subscriptions')
      .select('*', { count: 'exact', head: true })
      .eq('following_id', userId);
    
    if (error) {
      console.error('❌ Erreur lors du comptage des abonnés:', error);
      return 0;
    }
    
    const result = count || 0;
    console.log('✅ Nombre d\'abonnés récupéré:', result, 'pour userId:', userId);
    return result;
  } catch (err) {
    console.error('❌ Exception lors du comptage des abonnés:', err);
    return 0;
  }
}

/**
 * Vérifier si un utilisateur est abonné à un autre
 * @param {Object} supabase - Client Supabase
 * @param {string} followerId - ID de l'utilisateur qui suit
 * @param {string} followingId - ID de l'utilisateur suivi
 * @returns {Promise<boolean>}
 */
export async function isSubscribed(supabase, followerId, followingId) {
  try {
    // Utiliser .maybeSingle() au lieu de .single() pour éviter l'erreur 406 quand aucun résultat
    const { data, error } = await supabase
      .from('subscriptions')
      .select('id')
      .eq('follower_id', followerId)
      .eq('following_id', followingId)
      .maybeSingle();
    
    if (error) {
      console.error('Erreur lors de la vérification d\'abonnement:', error);
      return false;
    }
    
    return !!data;
  } catch (err) {
    console.error('Erreur lors de la vérification d\'abonnement:', err);
    return false;
  }
}

/**
 * Obtenir la liste des abonnements (utilisateurs suivis)
 * @param {Object} supabase - Client Supabase
 * @param {string} userId - ID de l'utilisateur
 * @returns {Promise<Array>} - Liste des profils suivis
 */
export async function getSubscriptions(supabase, userId) {
  try {
    const { data, error } = await supabase
      .from('subscriptions')
      .select(`
        following_id,
        created_at,
        profiles:following_id (
          id,
          username,
          avatar_url,
          skill_points,
          rank
        )
      `)
      .eq('follower_id', userId)
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('Erreur lors de la récupération des abonnements:', error);
      return [];
    }
    
    return (data || []).map(item => ({
      ...item.profiles,
      subscription_date: item.created_at
    }));
  } catch (err) {
    console.error('Erreur lors de la récupération des abonnements:', err);
    return [];
  }
}

/**
 * Obtenir la liste des abonnés
 * @param {Object} supabase - Client Supabase
 * @param {string} userId - ID de l'utilisateur
 * @returns {Promise<Array>} - Liste des profils abonnés
 */
export async function getFollowers(supabase, userId) {
  try {
    const { data, error } = await supabase
      .from('subscriptions')
      .select(`
        follower_id,
        created_at,
        profiles:follower_id (
          id,
          username,
          avatar_url,
          skill_points,
          rank
        )
      `)
      .eq('following_id', userId)
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('Erreur lors de la récupération des abonnés:', error);
      return [];
    }
    
    return (data || []).map(item => ({
      ...item.profiles,
      subscription_date: item.created_at
    }));
  } catch (err) {
    console.error('Erreur lors de la récupération des abonnés:', err);
    return [];
  }
}

/**
 * Vérifier si deux utilisateurs sont mutuellement abonnés
 * @param {Object} supabase - Client Supabase
 * @param {string} userId1 - ID du premier utilisateur
 * @param {string} userId2 - ID du deuxième utilisateur
 * @returns {Promise<boolean>}
 */
export async function isMutuallySubscribed(supabase, userId1, userId2) {
  // Si c'est le même utilisateur, retourner false
  if (userId1 === userId2) {
    return false;
  }
  
  try {
    // Vérifier que userId1 suit userId2 ET que userId2 suit userId1
    const [sub1, sub2] = await Promise.all([
      isSubscribed(supabase, userId1, userId2),
      isSubscribed(supabase, userId2, userId1)
    ]);
    
    return sub1 && sub2;
  } catch (err) {
    console.error('Erreur lors de la vérification d\'abonnement mutuel:', err);
    return false;
  }
}

/**
 * Obtenir la liste des amis mutuels (utilisateurs mutuellement abonnés)
 * @param {Object} supabase - Client Supabase
 * @param {string} userId - ID de l'utilisateur
 * @returns {Promise<Array>} - Liste des profils amis mutuels avec leur date d'abonnement mutuel
 */
export async function getMutualFriends(supabase, userId) {
  try {
    // Récupérer tous les utilisateurs que l'utilisateur suit
    const { data: subscriptions, error: subError } = await supabase
      .from('subscriptions')
      .select(`
        following_id,
        created_at,
        profiles:following_id (
          id,
          username,
          avatar_url,
          skill_points,
          rank,
          badge_count,
          is_private
        )
      `)
      .eq('follower_id', userId);
    
    if (subError) {
      console.error('Erreur lors de la récupération des abonnements:', subError);
      return [];
    }
    
    // Récupérer tous les utilisateurs qui suivent l'utilisateur
    const { data: followers, error: folError } = await supabase
      .from('subscriptions')
      .select(`
        follower_id,
        created_at
      `)
      .eq('following_id', userId);
    
    if (folError) {
      console.error('Erreur lors de la récupération des abonnés:', folError);
      return [];
    }
    
    // Créer un Set des IDs des abonnés pour une recherche rapide
    const followerIds = new Set((followers || []).map(f => f.follower_id));
    
    // Filtrer pour ne garder que les amis mutuels (ceux que l'utilisateur suit ET qui suivent l'utilisateur)
    const mutualFriends = (subscriptions || [])
      .filter(sub => followerIds.has(sub.following_id))
      .map(sub => {
        // Trouver la date d'abonnement la plus récente entre les deux abonnements
        const followerSub = followers.find(f => f.follower_id === sub.following_id);
        const mutualDate = new Date(sub.created_at) > new Date(followerSub.created_at) 
          ? sub.created_at 
          : followerSub.created_at;
        
        return {
          ...sub.profiles,
          mutual_subscription_date: mutualDate
        };
      });
    
    return mutualFriends;
  } catch (err) {
    console.error('Erreur lors de la récupération des amis mutuels:', err);
    return [];
  }
}

/**
 * Vérifier si un utilisateur peut voir les badges d'un autre utilisateur
 * @param {Object} supabase - Client Supabase
 * @param {string} viewerId - ID de l'utilisateur qui regarde
 * @param {string} profileId - ID du propriétaire du profil
 * @param {boolean} isPrivate - Si le profil est privé
 * @returns {Promise<boolean>}
 */
export async function canViewBadges(supabase, viewerId, profileId, isPrivate) {
  // Si c'est son propre profil, toujours autorisé
  if (viewerId === profileId) {
    return true;
  }
  
  // Si le profil est public, tout le monde peut voir
  if (!isPrivate) {
    return true;
  }
  
  // Si le profil est privé, vérifier l'abonnement mutuel (les deux doivent être abonnés l'un à l'autre)
  return await isMutuallySubscribed(supabase, viewerId, profileId);
}

// Export de toutes les fonctions sous un objet
export const Subscriptions = {
  subscribeToUser,
  unsubscribeFromUser,
  getSubscriptionsCount,
  getFollowersCount,
  isSubscribed,
  isMutuallySubscribed,
  getSubscriptions,
  getFollowers,
  getMutualFriends,
  canViewBadges
};

