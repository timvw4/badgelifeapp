// Fonctions utilitaires pour le système d'abonnement

/**
 * Formate le texte d'une notification (simple ou groupée)
 * @param {Object} notification - Notification avec propriétés followers (array) ou follower (object)
 * @returns {string} - Texte formaté
 */
export function formatNotificationText(notification) {
  if (notification.followers && Array.isArray(notification.followers) && notification.followers.length > 1) {
    // Notification groupée
    const names = notification.followers.map(f => f.username || 'Utilisateur');
    if (names.length <= 2) {
      return `${names.join(' et ')} se sont abonnés à toi`;
    } else {
      const firstTwo = names.slice(0, 2).join(', ');
      const othersCount = names.length - 2;
      return `${firstTwo} et ${othersCount} autre${othersCount > 1 ? 's' : ''} se sont abonnés à toi`;
    }
  } else {
    // Notification simple
    const follower = notification.follower || notification.followers?.[0];
    const username = follower?.username || 'Quelqu\'un';
    return `${username} s'est abonné à toi`;
  }
}

/**
 * Extrait les utilisateurs d'une notification groupée
 * @param {Object} notification - Notification
 * @returns {Array} - Liste des utilisateurs
 */
export function getNotificationUsers(notification) {
  if (notification.followers && Array.isArray(notification.followers)) {
    return notification.followers;
  }
  return notification.follower ? [notification.follower] : [];
}

/**
 * Détermine si des notifications doivent être groupées
 * @param {Array} notifications - Liste des notifications
 * @param {number} hoursThreshold - Nombre d'heures pour considérer comme "récent" (défaut: 2)
 * @returns {boolean} - true si les notifications doivent être groupées
 */
export function shouldGroupNotifications(notifications, hoursThreshold = 2) {
  if (!notifications || notifications.length < 2) return false;
  
  const now = new Date();
  const threshold = new Date(now.getTime() - hoursThreshold * 60 * 60 * 1000);
  
  // Vérifier si toutes les notifications sont dans le seuil de temps
  const recentNotifications = notifications.filter(notif => {
    const createdAt = new Date(notif.created_at);
    return createdAt >= threshold;
  });
  
  return recentNotifications.length >= 2;
}

/**
 * Groupe les notifications récentes par type
 * @param {Array} notifications - Liste des notifications non groupées
 * @param {number} hoursThreshold - Nombre d'heures pour considérer comme "récent" (défaut: 2)
 * @returns {Array} - Liste des notifications groupées
 */
export function groupRecentNotifications(notifications, hoursThreshold = 2) {
  if (!notifications || notifications.length === 0) return [];
  
  const now = new Date();
  const threshold = new Date(now.getTime() - hoursThreshold * 60 * 60 * 1000);
  
  // Séparer les notifications récentes et anciennes
  const recent = [];
  const old = [];
  
  notifications.forEach(notif => {
    const createdAt = new Date(notif.created_at);
    if (createdAt >= threshold) {
      recent.push(notif);
    } else {
      old.push(notif);
    }
  });
  
  // Grouper les notifications récentes
  if (recent.length >= 2) {
    // Créer une notification groupée
    const grouped = {
      id: `grouped-${Date.now()}`,
      user_id: recent[0].user_id,
      followers: recent.map(n => ({
        id: n.follower_id,
        username: n.follower_username || 'Utilisateur',
        avatar_url: n.follower_avatar_url || null
      })),
      created_at: recent[0].created_at,
      is_grouped: true
    };
    
    return [grouped, ...old];
  }
  
  // Si pas assez de notifications récentes, retourner telles quelles
  return notifications.map(notif => ({
    ...notif,
    follower: {
      id: notif.follower_id,
      username: notif.follower_username || 'Utilisateur',
      avatar_url: notif.follower_avatar_url || null
    },
    is_grouped: false
  }));
}

