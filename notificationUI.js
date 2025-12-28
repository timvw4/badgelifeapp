// Module UI pour les notifications unifiées
// Gère le rendu et les interactions utilisateur pour tous les types de notifications
import * as NotificationService from './subscriptionNotifications.js';

let supabaseClient = null;
let currentUserId = null;

/**
 * Initialise le module avec les dépendances nécessaires
 * @param {Object} supabase - Client Supabase
 * @param {string} userId - ID de l'utilisateur actuel
 */
export function initNotificationUI(supabase, userId) {
  supabaseClient = supabase;
  currentUserId = userId;
  
  // Attacher l'écouteur pour le bouton de notifications
  const notificationsBtn = document.getElementById('notifications-btn');
  if (notificationsBtn) {
    notificationsBtn.addEventListener('click', async () => {
      await showNotificationsModal();
    });
  }
  
  // Écouteurs pour le modal de notifications
  const notificationsModalClose = document.getElementById('notifications-modal-close');
  const notificationsModal = document.getElementById('notifications-modal');
  
  // Fonction pour fermer le modal et marquer toutes les notifications comme lues
  const closeModalAndMarkAsRead = async () => {
    if (notificationsModal) {
      notificationsModal.classList.add('hidden');
    }
    // Marquer toutes les notifications non lues comme lues quand on ferme le modal
    await markAllNotificationsAsRead();
    await refreshNotificationBadge();
  };
  
  if (notificationsModalClose) {
    notificationsModalClose.addEventListener('click', closeModalAndMarkAsRead);
  }
  
  // Fermer le modal en cliquant en dehors
  if (notificationsModal) {
    notificationsModal.addEventListener('click', async (e) => {
      if (e.target === notificationsModal) {
        await closeModalAndMarkAsRead();
      }
    });
  }
}

/**
 * Affiche la pastille de notification selon le nombre de notifications non lues
 * @param {number} count - Nombre de notifications non lues (avec show_badge = true)
 */
export function renderNotificationBadge(count) {
  const indicator = document.getElementById('notification-indicator');
  
  if (!indicator) return;
  
  // Afficher ou masquer la pastille rouge selon s'il y a des notifications
  if (count > 0) {
    indicator.classList.remove('hidden');
  } else {
    indicator.classList.add('hidden');
  }
}

/**
 * Affiche le modal avec la liste des notifications
 */
export async function showNotificationsModal() {
  if (!supabaseClient || !currentUserId) return;
  
  const modal = document.getElementById('notifications-modal');
  const list = document.getElementById('notifications-list');
  
  if (!modal || !list) return;
  
  modal.classList.remove('hidden');
  list.innerHTML = '<p class="muted">Chargement...</p>';
  
  try {
    const notifications = await NotificationService.getNotifications(supabaseClient, currentUserId);
    
    if (notifications.length === 0) {
      list.innerHTML = '<p class="muted">Aucune notification pour le moment.</p>';
      return;
    }
    
    list.innerHTML = '';
    
    notifications.forEach(notification => {
      const item = renderNotificationItem(notification);
      list.appendChild(item);
    });
    
    // Rafraîchir le badge après avoir chargé les notifications
    await refreshNotificationBadge();
  } catch (err) {
    console.error('Erreur lors du chargement des notifications:', err);
    list.innerHTML = '<p class="muted error">Erreur lors du chargement.</p>';
  }
}

/**
 * Formate le texte d'une notification selon son type
 * @param {Object} notification - Notification à formater
 * @returns {string} - Texte formaté
 */
function formatNotificationText(notification) {
  switch (notification.type) {
    case 'subscription':
      return `${notification.follower_username || 'Quelqu\'un'} s'est abonné à toi`;
    
    case 'unsubscription':
      return `${notification.follower_username || 'Quelqu\'un'} s'est désabonné de toi`;
    
    case 'suspicion_individual':
      return `${notification.suspicious_username || 'Un utilisateur'} a soupçonné ton badge "${notification.badge_name || 'ce badge'}".`;
    
    case 'suspicion_blocked':
      if (notification.badge_owner_id && notification.badge_owner_id !== notification.user_id) {
        // Notification pour un soupçonneur
        return `Le badge "${notification.badge_name || 'ce badge'}" de ${notification.owner_username || 'un utilisateur'} a été bloqué suite à vos soupçons.`;
      } else {
        // Notification pour le propriétaire
        return `Trop d'amis te soupçonnent de mentir pour le badge "${notification.badge_name || 'ce badge'}".`;
      }
    
    case 'daily_tokens':
      return `🪙 Tu as obtenu ${notification.token_amount || 2} jeton${(notification.token_amount || 2) > 1 ? 's' : ''} d'expérience !`;
    
    case 'sunday_bonus':
      return `🪙 Tu as obtenu ${notification.token_amount || 3} jetons bonus pour ta semaine complète !`;
    
    default:
      return 'Nouvelle notification';
  }
}

/**
 * Affiche une notification dans la liste
 * @param {Object} notification - Notification à afficher
 * @returns {HTMLElement} - Élément DOM de la notification
 */
function renderNotificationItem(notification) {
  const item = document.createElement('div');
  const isRead = notification.is_read || false;
  item.className = `list-item clickable notification-item${isRead ? ' read' : ''}`;
  item.setAttribute('data-notification-id', notification.id || '');
  
  const text = formatNotificationText(notification);
  
  // Pour les notifications d'abonnement/désabonnement, afficher l'avatar
  let avatarHtml = '';
  if ((notification.type === 'subscription' || notification.type === 'unsubscription') && notification.follower_avatar_url) {
    avatarHtml = `
      <div class="notification-avatars" style="display: flex; align-items: center; margin-right: 12px;">
        <img src="${notification.follower_avatar_url || './icons/logobl.png'}" alt="Avatar" class="logo tiny avatar" style="border: 2px solid var(--bg);">
      </div>
    `;
  }
  
  item.innerHTML = `
    <div class="notification-content">
      ${avatarHtml}
      <div class="notification-text">
        <p style="margin: 0; font-size: 14px;">${text}</p>
      </div>
    </div>
  `;
  
  item.addEventListener('click', () => {
    handleNotificationClick(notification);
  });
  
  return item;
}

/**
 * Gère le clic sur une notification selon son type
 * @param {Object} notification - Notification cliquée
 */
async function handleNotificationClick(notification) {
  // Marquer la notification comme lue si elle ne l'est pas déjà
  if (notification.id && !notification.is_read) {
    await NotificationService.markNotificationAsRead(supabaseClient, notification.id);
    const item = document.querySelector(`[data-notification-id="${notification.id}"]`);
    if (item) {
      item.classList.add('read');
      notification.is_read = true;
    }
  }
  
  // Fermer le modal de notifications
  const modal = document.getElementById('notifications-modal');
  if (modal) {
    modal.classList.add('hidden');
  }
  
  // Actions spécifiques selon le type
  switch (notification.type) {
    case 'subscription':
    case 'unsubscription':
      // Ouvrir le profil de l'utilisateur
      if (notification.follower_id && window.showCommunityProfile) {
        await openUserProfile(notification.follower_id);
      }
      break;
    
    case 'suspicion_individual':
    case 'suspicion_blocked':
      // Ouvrir le profil et afficher le badge soupçonné
      let targetUserId = notification.user_id;
      if (notification.badge_owner_id && notification.badge_owner_id !== notification.user_id) {
        targetUserId = notification.badge_owner_id;
      }
      if (targetUserId && notification.badge_id && window.showCommunityProfile) {
        await openUserProfileWithBadge(targetUserId, notification.badge_id);
      }
      break;
    
    case 'daily_tokens':
    case 'sunday_bonus':
      // Pour les notifications de connexion, ne rien faire (juste fermer le modal)
      break;
  }
  
  // Mettre à jour le badge de notification
  await refreshNotificationBadge();
}

/**
 * Ouvre le profil d'un utilisateur
 * @param {string} userId - ID de l'utilisateur
 */
async function openUserProfile(userId) {
  if (!window.showCommunityProfile) return;
  
  try {
    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('id, username, avatar_url, skill_points, is_private')
      .eq('id', userId)
      .single();
    
    if (profile) {
      const rankMeta = window.getRankMeta ? window.getRankMeta(profile.skill_points || 0) : { name: '—' };
      
      window.showCommunityProfile({
        userId: profile.id,
        username: profile.username,
        avatar: profile.avatar_url,
        rank: rankMeta.name,
        badges: 0,
        skills: profile.skill_points || 0,
        isPrivate: profile.is_private || false
      });
    }
  } catch (err) {
    console.error('Erreur lors de la récupération du profil:', err);
  }
}

/**
 * Ouvre le profil d'un utilisateur et met en évidence un badge spécifique
 * @param {string} userId - ID de l'utilisateur
 * @param {string} badgeId - ID du badge à mettre en évidence
 */
async function openUserProfileWithBadge(userId, badgeId) {
  await openUserProfile(userId);
  
  // Attendre que le profil soit chargé, puis scroller vers le badge
  setTimeout(() => {
    const badgeElement = document.querySelector(`[data-badge-id="${badgeId}"]`);
    if (badgeElement) {
      badgeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Ajouter un effet visuel pour mettre en évidence le badge
      badgeElement.style.transition = 'box-shadow 0.3s ease';
      badgeElement.style.boxShadow = '0 0 20px rgba(99, 102, 241, 0.5)';
      setTimeout(() => {
        badgeElement.style.boxShadow = '';
      }, 2000);
    }
  }, 500);
}

/**
 * Marque toutes les notifications comme lues
 */
async function markAllNotificationsAsRead() {
  if (!supabaseClient || !currentUserId) return;
  
  try {
    const result = await NotificationService.markAllNotificationsAsRead(supabaseClient, currentUserId);
    
    if (result.success) {
      // Si le modal est ouvert, rafraîchir l'affichage pour mettre à jour les styles visuels
      const modal = document.getElementById('notifications-modal');
      if (modal && !modal.classList.contains('hidden')) {
        await showNotificationsModal();
      }
    } else {
      console.error('Erreur lors du marquage des notifications comme lues:', result.error);
    }
  } catch (err) {
    console.error('Erreur lors du marquage des notifications comme lues:', err);
  }
}

/**
 * Rafraîchit le badge de notification
 */
export async function refreshNotificationBadge() {
  if (!supabaseClient || !currentUserId) return;
  
  const count = await NotificationService.getUnreadNotificationsCount(supabaseClient, currentUserId);
  renderNotificationBadge(count);
}

/**
 * Configure l'écoute Realtime pour les notifications
 * @returns {Function} - Fonction pour arrêter l'écoute
 */
export function setupRealtimeNotificationListener() {
  if (!supabaseClient || !currentUserId) return () => {};
  
  return NotificationService.setupRealtimeNotifications(
    supabaseClient,
    currentUserId,
    async (payload) => {
      // Rafraîchir le badge quand une notification change
      await refreshNotificationBadge();
      
      // Si le modal est ouvert, rafraîchir la liste
      const modal = document.getElementById('notifications-modal');
      if (modal && !modal.classList.contains('hidden')) {
        await showNotificationsModal();
      }
    }
  );
}

// Export de toutes les fonctions sous un objet
export const NotificationUI = {
  initNotificationUI,
  renderNotificationBadge,
  showNotificationsModal,
  refreshNotificationBadge,
  setupRealtimeNotificationListener
};
