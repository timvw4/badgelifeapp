// Module UI pour les notifications
// Gère uniquement l'affichage et les interactions utilisateur
import * as Notifications from './notifications.js';

let supabaseClient = null;
let currentUserId = null;

/**
 * Ferme le modal et marque toutes les notifications comme lues
 */
async function closeModalAndMarkAsRead() {
  const notificationsModal = document.getElementById('notifications-modal');
  if (notificationsModal) {
    notificationsModal.classList.add('hidden');
  }
  await markAllNotificationsAsReadInternal();
  await refreshNotificationBadge();
}

/**
 * Initialise le module avec les dépendances nécessaires
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
 * @param {number} count - Nombre de notifications non lues
 * @param {boolean} hideProfileBadge - Si true, masque seulement la pastille de la barre de navigation
 */
export function renderNotificationBadge(count, hideProfileBadge = false) {
  const indicator = document.getElementById('notification-indicator');
  const profileIndicator = document.getElementById('profile-notification-indicator');
  
  // Mettre à jour la pastille du bouton cloche (toujours basée sur le nombre réel)
  if (indicator) {
    if (count > 0) {
      indicator.classList.remove('hidden');
    } else {
      indicator.classList.add('hidden');
    }
  }
  
  // Mettre à jour la pastille du bouton "Mon profil" dans la barre de navigation
  if (profileIndicator) {
    if (hideProfileBadge || count === 0) {
      // Masquer la pastille de la barre de navigation si demandé ou s'il n'y a plus de notifications
      profileIndicator.classList.add('hidden');
    } else {
      // Afficher seulement si on ne demande pas de la masquer et qu'il y a des notifications
      profileIndicator.classList.remove('hidden');
    }
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
    const notifications = await Notifications.getNotifications(supabaseClient, currentUserId);
    
    if (notifications.length === 0) {
      list.innerHTML = '<p class="muted">Aucune notification pour le moment.</p>';
      return;
    }
    
    list.innerHTML = '';
    
    // Limiter à 10 notifications les plus récentes
    const recentNotifications = notifications.slice(0, 10);
    
    recentNotifications.forEach((notification) => {
      const item = renderNotificationItem(notification);
      if (item) {
        list.appendChild(item);
      }
    });
    
    await refreshNotificationBadge();
  } catch (err) {
    console.error('❌ Erreur lors du chargement des notifications:', err);
    list.innerHTML = '<p class="muted error">Erreur lors du chargement.</p>';
  }
}

/**
 * Formate le texte d'une notification selon son type
 */
function formatNotificationText(notification) {
  switch (notification.type) {
    case 'suspicion_individual':
      return `${notification.suspicious_username || 'Un utilisateur'} a soupçonné ton badge "${notification.badge_name || 'ce badge'}".`;
    
    case 'suspicion_blocked':
      if (notification.badge_owner_id && notification.badge_owner_id !== notification.user_id) {
        return `Le badge "${notification.badge_name || 'ce badge'}" de ${notification.owner_username || 'un utilisateur'} a été bloqué suite à vos soupçons.`;
      } else {
        return `Trop d'amis te soupçonnent de mentir pour le badge "${notification.badge_name || 'ce badge'}".`;
      }
    
    case 'daily_tokens':
      return `🪙 Tu as obtenu ${notification.token_amount || 2} jeton${(notification.token_amount || 2) > 1 ? 's' : ''} d'expérience !`;
    
    case 'sunday_bonus':
      return `🪙 Tu as obtenu ${notification.token_amount || 3} jetons bonus pour ta semaine complète !`;
    
    case 'subscription':
      return `${notification.follower_username || 'Un utilisateur'} s'est abonné à toi.`;
    
    default:
      return 'Nouvelle notification';
  }
}

/**
 * Affiche une notification dans la liste
 */
function renderNotificationItem(notification) {
  try {
    if (!notification || !notification.type) {
      return null;
    }
    
    const item = document.createElement('div');
    const isRead = notification.is_read || false;
    item.className = `list-item clickable notification-item${isRead ? ' read' : ''}`;
    item.setAttribute('data-notification-id', notification.id || '');
    
    const text = formatNotificationText(notification);
    
    item.innerHTML = `
      <div class="notification-content">
        <div class="notification-text">
          <p style="margin: 0; font-size: 14px;">${text}</p>
        </div>
      </div>
    `;
    
    item.addEventListener('click', () => {
      handleNotificationClick(notification);
    });
    
    return item;
  } catch (err) {
    console.error('❌ Erreur lors du rendu de la notification:', err);
    return null;
  }
}

/**
 * Gère le clic sur une notification selon son type
 */
async function handleNotificationClick(notification) {
  // Actions spécifiques selon le type (avant de fermer le modal)
  switch (notification.type) {
    case 'suspicion_individual':
    case 'suspicion_blocked':
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
      // Ne rien faire
      break;
    
    case 'subscription':
      // Ouvrir le profil de l'utilisateur qui s'est abonné
      if (notification.follower_id) {
        await openUserProfile(notification.follower_id);
      }
      break;
  }
  
  // Fermer le modal et marquer toutes les notifications comme lues
  await closeModalAndMarkAsRead();
}

/**
 * Ouvre le profil d'un utilisateur
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
 */
async function openUserProfileWithBadge(userId, badgeId) {
  await openUserProfile(userId);
  
  setTimeout(() => {
    const badgeElement = document.querySelector(`[data-badge-id="${badgeId}"]`);
    if (badgeElement) {
      badgeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      badgeElement.style.transition = 'box-shadow 0.3s ease';
      badgeElement.style.boxShadow = '0 0 20px rgba(99, 102, 241, 0.5)';
      setTimeout(() => {
        badgeElement.style.boxShadow = '';
      }, 2000);
    }
  }, 500);
}

/**
 * Marque toutes les notifications comme lues (fonction interne pour UI)
 */
async function markAllNotificationsAsReadInternal() {
  if (!supabaseClient || !currentUserId) return;
  
  try {
    const result = await Notifications.markAllNotificationsAsRead(supabaseClient, currentUserId);
    
    if (result.success) {
      const modal = document.getElementById('notifications-modal');
      if (modal && !modal.classList.contains('hidden')) {
        await showNotificationsModal();
      }
    }
  } catch (err) {
    console.error('Erreur lors du marquage des notifications comme lues:', err);
  }
}

/**
 * Obtient le nombre de notifications non lues
 * @returns {Promise<number>}
 */
export async function getUnreadNotificationsCount() {
  if (!supabaseClient || !currentUserId) return 0;
  
  return await Notifications.getUnreadNotificationsCount(supabaseClient, currentUserId);
}

/**
 * Rafraîchit le badge de notification
 */
export async function refreshNotificationBadge() {
  if (!supabaseClient || !currentUserId) return;
  
  const count = await Notifications.getUnreadNotificationsCount(supabaseClient, currentUserId);
  renderNotificationBadge(count);
}

/**
 * Configure l'écoute Realtime pour les notifications
 */
export function setupRealtimeNotificationListener() {
  if (!supabaseClient || !currentUserId) return () => {};
  
  return Notifications.setupRealtimeNotifications(
    supabaseClient,
    currentUserId,
    async (payload) => {
      await refreshNotificationBadge();
      
      const modal = document.getElementById('notifications-modal');
      if (modal && !modal.classList.contains('hidden')) {
        await showNotificationsModal();
      }
    }
  );
}

// Export de toutes les fonctions UI
export const NotificationUI = {
  initNotificationUI,
  renderNotificationBadge,
  showNotificationsModal,
  refreshNotificationBadge,
  setupRealtimeNotificationListener,
  getUnreadNotificationsCount
};
