// Module UI pour les notifications d'abonnement
// Gère le rendu et les interactions utilisateur pour les notifications
import * as SubscriptionNotifications from './subscriptionNotifications.js';
import { formatNotificationText, getNotificationUsers } from './subscriptionHelpers.js';

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
      // Ouvrir le modal - les notifications seront marquées comme lues à la fermeture
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
    // Marquer toutes les notifications comme lues quand on ferme le modal
    await markAllNotificationsAsRead();
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
 * @param {number} count - Nombre de notifications non lues
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
    const notifications = await SubscriptionNotifications.getNotifications(supabaseClient, currentUserId);
    
    if (notifications.length === 0) {
      list.innerHTML = '<p class="muted">Aucune notification pour le moment.</p>';
      return;
    }
    
    list.innerHTML = '';
    
    notifications.forEach(notification => {
      const item = renderNotificationItem(notification);
      list.appendChild(item);
    });
  } catch (err) {
    console.error('Erreur lors du chargement des notifications:', err);
    list.innerHTML = '<p class="muted error">Erreur lors du chargement.</p>';
  }
}

/**
 * Affiche une notification dans la liste
 * @param {Object} notification - Notification à afficher
 * @returns {HTMLElement} - Élément DOM de la notification
 */
function renderNotificationItem(notification) {
  const item = document.createElement('div');
  item.className = 'list-item clickable notification-item';
  
  // Gérer les notifications de soupçon différemment
  if (notification.type === 'suspicion') {
    // Si badge_owner_id existe et est différent de user_id, c'est une notification pour un soupçonneur
    // Sinon, c'est une notification pour le propriétaire du badge
    let text;
    if (notification.badge_owner_id && notification.badge_owner_id !== notification.user_id) {
      const ownerUsername = notification.profiles?.username || 'un utilisateur';
      text = `Le badge "${notification.badge_name}" de ${ownerUsername} a été bloqué suite à vos soupçons.`;
    } else if (notification.suspicious_user_id && notification.suspicious_username) {
      // Notification individuelle : quelqu'un a soupçonné ton badge
      const suspiciousUsername = notification.suspicious_username || 'Un utilisateur';
      text = `${suspiciousUsername} a soupçonné ton badge "${notification.badge_name}".`;
    } else {
      // Notification de blocage (≥3 soupçons)
      text = `Trop d'amis te soupçonnent de mentir pour le badge "${notification.badge_name}".`;
    }
    
    item.innerHTML = `
      <div class="notification-content">
        <div class="notification-text">
          <p style="margin: 0; font-size: 14px;">${text}</p>
        </div>
      </div>
    `;
    
    item.addEventListener('click', () => {
      handleSuspicionNotificationClick(notification);
    });
    
    return item;
  }
  
  const text = formatNotificationText(notification);
  
  // Si c'est une notification groupée, afficher plusieurs avatars
  const users = getNotificationUsers(notification);
  const avatarsHtml = users.slice(0, 3).map(user => {
    const avatarUrl = user.avatar_url || './icons/logobl.png';
    return `<img src="${avatarUrl}" alt="Avatar" class="logo tiny avatar" style="margin-left: -8px; border: 2px solid var(--bg);">`;
  }).join('');
  
  item.innerHTML = `
    <div class="notification-content">
      <div class="notification-avatars" style="display: flex; align-items: center; margin-right: 12px;">
        ${avatarsHtml}
      </div>
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
 * Gère le clic sur une notification de soupçon
 * @param {Object} notification - Notification de soupçon cliquée
 */
async function handleSuspicionNotificationClick(notification) {
  // Marquer la notification comme lue
  if (notification.id) {
    await SubscriptionNotifications.markNotificationAsRead(supabaseClient, notification.id);
  }
  
  // Fermer le modal de notifications
  const modal = document.getElementById('notifications-modal');
  if (modal) {
    modal.classList.add('hidden');
  }
  
  // Mettre à jour le badge de notification
  await refreshNotificationBadge();
  
  // L'utilisateur peut modifier sa réponse depuis son propre profil
  // On ne fait rien de spécial ici, l'utilisateur devra aller dans son profil
}

/**
 * Gère le clic sur une notification
 * @param {Object} notification - Notification cliquée
 */
async function handleNotificationClick(notification) {
  const users = getNotificationUsers(notification);
  
  // Si c'est une notification groupée, ouvrir le profil du premier utilisateur
  // Sinon, ouvrir le profil de l'utilisateur unique
  const user = users[0];
  
  if (!user || !user.id) return;
  
  // Marquer la notification comme lue
  if (notification.id && !notification.is_grouped) {
    await SubscriptionNotifications.markNotificationAsRead(supabaseClient, notification.id);
  } else if (notification.is_grouped) {
    // Pour les notifications groupées, on ne les supprime pas individuellement
    // On les supprimera toutes quand l'utilisateur marquera tout comme lu
  }
  
  // Fermer le modal de notifications
  const modal = document.getElementById('notifications-modal');
  if (modal) {
    modal.classList.add('hidden');
  }
  
  // Ouvrir le profil de l'utilisateur
  if (window.showCommunityProfile) {
    // Récupérer les infos complètes du profil
    try {
      const { data: profile } = await supabaseClient
        .from('profiles')
        .select('id, username, avatar_url, skill_points, is_private')
        .eq('id', user.id)
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
  
  // Mettre à jour le badge de notification
  await refreshNotificationBadge();
}

/**
 * Marque toutes les notifications comme lues
 */
async function markAllNotificationsAsRead() {
  if (!supabaseClient || !currentUserId) return;
  
  try {
    const result = await SubscriptionNotifications.markAllNotificationsAsRead(supabaseClient, currentUserId);
    
    if (result.success) {
      // Mettre à jour le badge pour qu'il disparaisse
      await refreshNotificationBadge();
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
  
  const count = await SubscriptionNotifications.getUnreadNotificationsCount(supabaseClient, currentUserId);
  renderNotificationBadge(count);
}

/**
 * Configure l'écoute Realtime pour les notifications
 * @returns {Function} - Fonction pour arrêter l'écoute
 */
export function setupRealtimeNotificationListener() {
  if (!supabaseClient || !currentUserId) return () => {};
  
  return SubscriptionNotifications.setupRealtimeNotifications(
    supabaseClient,
    currentUserId,
    async (payload) => {
      // Rafraîchir le badge quand une notification change (INSERT ou DELETE)
      // Cela permet de mettre à jour la pastille en temps réel
      await refreshNotificationBadge();
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

