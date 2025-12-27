// Module de gestion des soupçons de badges
// Logique métier pure (pas de UI)
import * as Subscriptions from './subscriptions.js';

/**
 * Soupçonner un badge d'un utilisateur
 * @param {Object} supabase - Client Supabase
 * @param {string} suspiciousUserId - ID de l'utilisateur qui soupçonne
 * @param {string} userId - ID de l'utilisateur propriétaire du badge
 * @param {string} badgeId - ID du badge soupçonné
 * @returns {Promise<{success: boolean, error?: string, blocked?: boolean}>}
 */
export async function suspectBadge(supabase, suspiciousUserId, userId, badgeId) {
  // Vérifier que l'utilisateur ne soupçonne pas son propre badge
  if (suspiciousUserId === userId) {
    return { success: false, error: 'Tu ne peux pas soupçonner ton propre badge.' };
  }
  
  // Vérifier l'abonnement mutuel
  const isMutual = await Subscriptions.isMutuallySubscribed(supabase, suspiciousUserId, userId);
  if (!isMutual) {
    return { success: false, error: 'Tu peux seulement soupçonner les badges de tes amis mutuellement abonnés.' };
  }
  
  try {
    // Vérifier si l'utilisateur a déjà soupçonné ce badge
    const { data: existing, error: checkError } = await supabase
      .from('badge_suspicions')
      .select('id')
      .eq('user_id', userId)
      .eq('badge_id', badgeId)
      .eq('suspicious_user_id', suspiciousUserId)
      .single();
    
    if (checkError && checkError.code !== 'PGRST116') {
      console.error('Erreur lors de la vérification du soupçon existant:', checkError);
      return { success: false, error: checkError.message };
    }
    
    if (existing) {
      return { success: false, error: 'Tu as déjà soupçonné ce badge.' };
    }
    
    // Insérer le soupçon
    const { error: insertError } = await supabase
      .from('badge_suspicions')
      .insert({
        user_id: userId,
        badge_id: badgeId,
        suspicious_user_id: suspiciousUserId
      });
    
    if (insertError) {
      return { success: false, error: insertError.message };
    }
    
    // Compter les soupçons et vérifier si le badge doit être bloqué
    const result = await checkAndBlockBadge(supabase, userId, badgeId);
    
    return { 
      success: true, 
      blocked: result.blocked,
      suspicionCount: result.suspicionCount
    };
  } catch (err) {
    console.error('Erreur lors du soupçon de badge:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Retirer un soupçon sur un badge
 * @param {Object} supabase - Client Supabase
 * @param {string} suspiciousUserId - ID de l'utilisateur qui retire son soupçon
 * @param {string} userId - ID de l'utilisateur propriétaire du badge
 * @param {string} badgeId - ID du badge
 * @returns {Promise<{success: boolean, error?: string, unblocked?: boolean}>}
 */
export async function removeSuspicion(supabase, suspiciousUserId, userId, badgeId) {
  try {
    // Supprimer le soupçon
    const { error: deleteError } = await supabase
      .from('badge_suspicions')
      .delete()
      .eq('user_id', userId)
      .eq('badge_id', badgeId)
      .eq('suspicious_user_id', suspiciousUserId);
    
    if (deleteError) {
      return { success: false, error: deleteError.message };
    }
    
    // Recompter les soupçons
    const suspicionCount = await getSuspicionCount(supabase, userId, badgeId);
    
    // Si le badge était bloqué et qu'il passe sous 3 soupçons, le débloquer
    const { data: badgeData } = await supabase
      .from('user_badges')
      .select('is_blocked_by_suspicions')
      .eq('user_id', userId)
      .eq('badge_id', badgeId)
      .single();
    
    let unblocked = false;
    if (badgeData && badgeData.is_blocked_by_suspicions && suspicionCount < 3) {
      // Débloquer le badge
      const { error: updateError } = await supabase
        .from('user_badges')
        .update({ is_blocked_by_suspicions: false })
        .eq('user_id', userId)
        .eq('badge_id', badgeId);
      
      if (!updateError) {
        unblocked = true;
      }
    }
    
    return { 
      success: true, 
      unblocked,
      suspicionCount
    };
  } catch (err) {
    console.error('Erreur lors du retrait du soupçon:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Obtenir le nombre de soupçons pour un badge
 * @param {Object} supabase - Client Supabase
 * @param {string} userId - ID de l'utilisateur propriétaire du badge
 * @param {string} badgeId - ID du badge
 * @returns {Promise<number>}
 */
export async function getSuspicionCount(supabase, userId, badgeId) {
  try {
    const { count, error } = await supabase
      .from('badge_suspicions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('badge_id', badgeId);
    
    if (error) {
      console.error('Erreur lors du comptage des soupçons:', error);
      return 0;
    }
    
    return count || 0;
  } catch (err) {
    console.error('Erreur lors du comptage des soupçons:', err);
    return 0;
  }
}

/**
 * Vérifier si un utilisateur a déjà soupçonné un badge
 * @param {Object} supabase - Client Supabase
 * @param {string} suspiciousUserId - ID de l'utilisateur qui soupçonne
 * @param {string} userId - ID de l'utilisateur propriétaire du badge
 * @param {string} badgeId - ID du badge
 * @returns {Promise<boolean>}
 */
export async function hasSuspected(supabase, suspiciousUserId, userId, badgeId) {
  try {
    const { data, error } = await supabase
      .from('badge_suspicions')
      .select('id')
      .eq('user_id', userId)
      .eq('badge_id', badgeId)
      .eq('suspicious_user_id', suspiciousUserId)
      .single();
    
    if (error && error.code !== 'PGRST116') {
      console.error('Erreur lors de la vérification du soupçon:', error);
      return false;
    }
    
    return !!data;
  } catch (err) {
    console.error('Erreur lors de la vérification du soupçon:', err);
    return false;
  }
}

/**
 * Vérifier et bloquer un badge si nécessaire (≥3 soupçons)
 * @param {Object} supabase - Client Supabase
 * @param {string} userId - ID de l'utilisateur propriétaire du badge
 * @param {string} badgeId - ID du badge
 * @returns {Promise<{blocked: boolean, suspicionCount: number}>}
 */
export async function checkAndBlockBadge(supabase, userId, badgeId) {
  try {
    const suspicionCount = await getSuspicionCount(supabase, userId, badgeId);
    
    // Vérifier si le badge existe dans user_badges
    const { data: badgeData, error: fetchError } = await supabase
      .from('user_badges')
      .select('id, is_blocked_by_suspicions')
      .eq('user_id', userId)
      .eq('badge_id', badgeId)
      .single();
    
    // Si le badge n'existe pas dans user_badges, on ne peut pas le bloquer
    if (fetchError || !badgeData) {
      return { blocked: false, suspicionCount };
    }
    
    // Si ≥ 3 soupçons et pas encore bloqué, bloquer le badge
    if (suspicionCount >= 3 && !badgeData.is_blocked_by_suspicions) {
      const { error: updateError } = await supabase
        .from('user_badges')
        .update({ is_blocked_by_suspicions: true })
        .eq('user_id', userId)
        .eq('badge_id', badgeId);
      
      if (!updateError) {
        // Récupérer tous les soupçonneurs pour créer les notifications
        const suspiciousUserIds = await getSuspiciousUsers(supabase, userId, badgeId);
        
        // Créer les notifications (propriétaire + soupçonneurs)
        const { createSuspicionNotifications } = await import('./subscriptionNotifications.js');
        await createSuspicionNotifications(supabase, userId, badgeId, suspicionCount, suspiciousUserIds);
        
        return { blocked: true, suspicionCount };
      }
    }
    
    return { blocked: badgeData.is_blocked_by_suspicions || false, suspicionCount };
  } catch (err) {
    console.error('Erreur lors de la vérification du blocage:', err);
    return { blocked: false, suspicionCount: 0 };
  }
}

/**
 * Obtenir tous les soupçonneurs d'un badge
 * @param {Object} supabase - Client Supabase
 * @param {string} userId - ID de l'utilisateur propriétaire du badge
 * @param {string} badgeId - ID du badge
 * @returns {Promise<Array>} - Liste des IDs des utilisateurs qui ont soupçonné
 */
export async function getSuspiciousUsers(supabase, userId, badgeId) {
  try {
    const { data, error } = await supabase
      .from('badge_suspicions')
      .select('suspicious_user_id')
      .eq('user_id', userId)
      .eq('badge_id', badgeId);
    
    if (error) {
      console.error('Erreur lors de la récupération des soupçonneurs:', error);
      return [];
    }
    
    return (data || []).map(item => item.suspicious_user_id);
  } catch (err) {
    console.error('Erreur lors de la récupération des soupçonneurs:', err);
    return [];
  }
}

/**
 * Récupérer toutes les données de soupçons pour plusieurs badges en une seule requête
 * @param {Object} supabase - Client Supabase
 * @param {string} suspiciousUserId - ID de l'utilisateur qui regarde (pour vérifier s'il a soupçonné)
 * @param {string} userId - ID de l'utilisateur propriétaire des badges
 * @param {Array<string>} badgeIds - Liste des IDs des badges
 * @returns {Promise<Map>} - Map avec badgeId -> { count, hasSuspected }
 */
export async function getAllSuspicionData(supabase, suspiciousUserId, userId, badgeIds) {
  if (!badgeIds || badgeIds.length === 0) {
    return new Map();
  }
  
  try {
    // Récupérer tous les soupçons pour ces badges en une seule requête
    const { data: allSuspicions, error: suspicionsError } = await supabase
      .from('badge_suspicions')
      .select('badge_id, suspicious_user_id')
      .eq('user_id', userId)
      .in('badge_id', badgeIds);
    
    if (suspicionsError) {
      console.error('Erreur lors de la récupération des soupçons:', suspicionsError);
      return new Map();
    }
    
    // Créer une Map pour compter les soupçons par badge
    const suspicionCounts = new Map();
    const hasSuspectedMap = new Map();
    
    // Initialiser tous les badges avec 0 soupçons
    badgeIds.forEach(badgeId => {
      suspicionCounts.set(badgeId, 0);
      hasSuspectedMap.set(badgeId, false);
    });
    
    // Compter les soupçons et vérifier si l'utilisateur actuel a soupçonné
    (allSuspicions || []).forEach(suspicion => {
      const badgeId = suspicion.badge_id;
      const currentCount = suspicionCounts.get(badgeId) || 0;
      suspicionCounts.set(badgeId, currentCount + 1);
      
      // Vérifier si l'utilisateur actuel a soupçonné ce badge
      if (suspicion.suspicious_user_id === suspiciousUserId) {
        hasSuspectedMap.set(badgeId, true);
      }
    });
    
    // Créer la Map finale avec toutes les données
    const result = new Map();
    badgeIds.forEach(badgeId => {
      result.set(badgeId, {
        count: suspicionCounts.get(badgeId) || 0,
        hasSuspected: hasSuspectedMap.get(badgeId) || false
      });
    });
    
    return result;
  } catch (err) {
    console.error('Erreur lors de la récupération des données de soupçons:', err);
    return new Map();
  }
}

// Export de toutes les fonctions
export const BadgeSuspicions = {
  suspectBadge,
  removeSuspicion,
  getSuspicionCount,
  hasSuspected,
  checkAndBlockBadge,
  getSuspiciousUsers,
  getAllSuspicionData
};

