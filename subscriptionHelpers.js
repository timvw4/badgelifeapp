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
 * Groupe les notifications récentes par type
 * Ne groupe QUE les notifications de DIFFÉRENTS utilisateurs
 * Si plusieurs notifications viennent du même utilisateur, elles restent séparées
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
  
  // Séparer les notifications par utilisateur
  // Compter combien de fois chaque utilisateur apparaît
  const followerCounts = new Map();
  recent.forEach(notif => {
    const count = followerCounts.get(notif.follower_id) || 0;
    followerCounts.set(notif.follower_id, count + 1);
  });
  
  // Notifications à grouper : celles d'utilisateurs qui n'apparaissent qu'une seule fois
  const singleNotifications = recent.filter(n => followerCounts.get(n.follower_id) === 1);
  
  // Notifications à garder séparées : celles d'utilisateurs qui apparaissent plusieurs fois
  const multipleNotifications = recent.filter(n => followerCounts.get(n.follower_id) > 1);
  
  // Grouper les notifications d'utilisateurs uniques (si au moins 2)
  if (singleNotifications.length >= 2) {
    const grouped = {
      id: `grouped-${Date.now()}`,
      user_id: singleNotifications[0].user_id,
      followers: singleNotifications.map(n => ({
        id: n.follower_id,
        username: n.follower_username || 'Utilisateur',
        avatar_url: n.follower_avatar_url || null
      })),
      created_at: singleNotifications[0].created_at,
      is_grouped: true
    };
    
    // Transformer les notifications multiples (même utilisateur) pour qu'elles restent séparées
    const formattedMultiple = multipleNotifications.map(notif => ({
      ...notif,
      follower: {
        id: notif.follower_id,
        username: notif.follower_username || 'Utilisateur',
        avatar_url: notif.follower_avatar_url || null
      },
      is_grouped: false
    }));
    
    // Transformer les anciennes notifications
    const formattedOld = old.map(notif => ({
      ...notif,
      follower: {
        id: notif.follower_id,
        username: notif.follower_username || 'Utilisateur',
        avatar_url: notif.follower_avatar_url || null
      },
      is_grouped: false
    }));
    
    return [grouped, ...formattedMultiple, ...formattedOld];
  }
  
  // Si pas assez de notifications uniques à grouper, retourner toutes les notifications séparées
  const allFormatted = [...recent, ...old].map(notif => ({
    ...notif,
    follower: {
      id: notif.follower_id,
      username: notif.follower_username || 'Utilisateur',
      avatar_url: notif.follower_avatar_url || null
    },
    is_grouped: false
  }));
  
  return allFormatted;
}

