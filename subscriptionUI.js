// Module UI pour les abonnements
// Gère le rendu et les interactions utilisateur pour les abonnements
import * as Subscriptions from './subscriptions.js';

let supabaseClient = null;
let currentUserId = null;

/**
 * Initialise le module avec les dépendances nécessaires
 * @param {Object} supabase - Client Supabase
 * @param {string} userId - ID de l'utilisateur actuel
 */
export function initSubscriptionUI(supabase, userId) {
  supabaseClient = supabase;
  currentUserId = userId;
  
  // Attacher les écouteurs d'événements pour les stats cliquables
  const followersStat = document.getElementById('profile-followers-stat');
  const subscriptionsStat = document.getElementById('profile-subscriptions-stat');
  
  if (followersStat) {
    followersStat.addEventListener('click', () => {
      if (currentUserId) {
        showSubscribersList(currentUserId);
      }
    });
  }
  
  if (subscriptionsStat) {
    subscriptionsStat.addEventListener('click', () => {
      if (currentUserId) {
        showSubscriptionsList(currentUserId);
      }
    });
  }
  
  // Écouteurs pour les modals
  const subscribersModalClose = document.getElementById('subscribers-modal-close');
  const subscriptionsModalClose = document.getElementById('subscriptions-modal-close');
  
  if (subscribersModalClose) {
    subscribersModalClose.addEventListener('click', () => {
      document.getElementById('subscribers-modal')?.classList.add('hidden');
    });
  }
  
  if (subscriptionsModalClose) {
    subscriptionsModalClose.addEventListener('click', () => {
      document.getElementById('subscriptions-modal')?.classList.add('hidden');
    });
  }
  
  // Fermer les modals en cliquant en dehors
  const subscribersModal = document.getElementById('subscribers-modal');
  const subscriptionsModal = document.getElementById('subscriptions-modal');
  
  if (subscribersModal) {
    subscribersModal.addEventListener('click', (e) => {
      if (e.target === subscribersModal) {
        subscribersModal.classList.add('hidden');
      }
    });
  }
  
  if (subscriptionsModal) {
    subscriptionsModal.addEventListener('click', (e) => {
      if (e.target === subscriptionsModal) {
        subscriptionsModal.classList.add('hidden');
      }
    });
  }
}

/**
 * Affiche les stats d'abonnement dans Mon profil
 * @param {number} followersCount - Nombre d'abonnés
 * @param {number} subscriptionsCount - Nombre d'abonnements
 */
export function renderSubscriptionStats(followersCount, subscriptionsCount) {
  const followersEl = document.getElementById('profile-section-followers-count');
  const subscriptionsEl = document.getElementById('profile-section-subscriptions-count');
  
  if (followersEl) {
    followersEl.textContent = followersCount || 0;
  }
  
  if (subscriptionsEl) {
    subscriptionsEl.textContent = subscriptionsCount || 0;
  }
}

/**
 * Affiche les stats et le bouton d'abonnement dans le modal communauté
 * @param {string} profileId - ID du profil affiché
 * @param {boolean} isOwnProfile - Si c'est le propre profil de l'utilisateur
 * @param {number} followersCount - Nombre d'abonnés
 * @param {number} subscriptionsCount - Nombre d'abonnements
 * @param {boolean} isSubscribed - Si l'utilisateur actuel est abonné
 */
export async function renderCommunityProfileSubscription(profileId, isOwnProfile, followersCount, subscriptionsCount, isSubscribed) {
  const followersCountEl = document.getElementById('community-profile-followers-count');
  const subscriptionsCountEl = document.getElementById('community-profile-subscriptions-count');
  const subscribeBtn = document.getElementById('community-profile-subscribe-btn');
  const followersStat = document.getElementById('community-profile-followers-stat');
  const subscriptionsStat = document.getElementById('community-profile-subscriptions-stat');
  
  // Afficher les stats
  if (followersCountEl) {
    followersCountEl.textContent = followersCount || 0;
  }
  
  if (subscriptionsCountEl) {
    subscriptionsCountEl.textContent = subscriptionsCount || 0;
  }
  
  // Gérer le bouton s'abonner/se désabonner
  if (subscribeBtn) {
    if (isOwnProfile) {
      subscribeBtn.style.display = 'none';
    } else {
      subscribeBtn.style.display = 'block';
      subscribeBtn.textContent = isSubscribed ? 'Se désabonner' : 'S\'abonner';
      subscribeBtn.className = isSubscribed ? 'ghost' : 'primary';
      
      // Supprimer les anciens écouteurs
      const newBtn = subscribeBtn.cloneNode(true);
      subscribeBtn.parentNode.replaceChild(newBtn, subscribeBtn);
      
      // Ajouter le nouvel écouteur
      newBtn.addEventListener('click', async () => {
        await handleSubscribeClick(profileId, isSubscribed);
      });
    }
  }
  
  // Écouteurs pour les stats cliquables
  if (followersStat && !isOwnProfile) {
    followersStat.addEventListener('click', () => {
      showSubscribersList(profileId);
    });
  }
  
  if (subscriptionsStat && !isOwnProfile) {
    subscriptionsStat.addEventListener('click', () => {
      showSubscriptionsList(profileId);
    });
  }
}

/**
 * Gère le clic sur le bouton s'abonner/se désabonner
 * @param {string} profileId - ID du profil
 * @param {boolean} currentlySubscribed - Si actuellement abonné
 */
async function handleSubscribeClick(profileId, currentlySubscribed) {
  if (!supabaseClient || !currentUserId) return;
  
  const subscribeBtn = document.getElementById('community-profile-subscribe-btn');
  if (subscribeBtn) {
    subscribeBtn.disabled = true;
    subscribeBtn.textContent = '...';
  }
  
  let result;
  if (currentlySubscribed) {
    result = await Subscriptions.unsubscribeFromUser(supabaseClient, currentUserId, profileId);
  } else {
    result = await Subscriptions.subscribeToUser(supabaseClient, currentUserId, profileId);
    
    // Créer la notification pour l'utilisateur suivi
    if (result.success) {
      const { createNotification } = await import('./subscriptionNotifications.js');
      await createNotification(supabaseClient, profileId, currentUserId);
    }
  }
  
  if (subscribeBtn) {
    subscribeBtn.disabled = false;
  }
  
  if (result.success) {
    // Recharger les stats
    const followersCount = await Subscriptions.getFollowersCount(supabaseClient, profileId);
    const subscriptionsCount = await Subscriptions.getSubscriptionsCount(supabaseClient, profileId);
    const isSubscribed = await Subscriptions.isSubscribed(supabaseClient, currentUserId, profileId);
    
    await renderCommunityProfileSubscription(profileId, false, followersCount, subscriptionsCount, isSubscribed);
    
    // Si c'est notre propre profil, mettre à jour nos stats aussi
    if (profileId === currentUserId) {
      const mySubscriptionsCount = await Subscriptions.getSubscriptionsCount(supabaseClient, currentUserId);
      renderSubscriptionStats(followersCount, mySubscriptionsCount);
    }
  } else {
    alert(result.error || 'Une erreur est survenue.');
  }
}

/**
 * Affiche la liste des abonnés dans un modal
 * @param {string} userId - ID de l'utilisateur
 */
export async function showSubscribersList(userId) {
  if (!supabaseClient) return;
  
  const modal = document.getElementById('subscribers-modal');
  const list = document.getElementById('subscribers-list');
  
  if (!modal || !list) return;
  
  modal.classList.remove('hidden');
  list.innerHTML = '<p class="muted">Chargement...</p>';
  
  try {
    const followers = await Subscriptions.getFollowers(supabaseClient, userId);
    
    if (followers.length === 0) {
      list.innerHTML = '<p class="muted">Aucun abonné pour le moment.</p>';
      return;
    }
    
    list.innerHTML = '';
    
    followers.forEach(follower => {
      // Calculer le rang depuis les skill points pour avoir le format correct
      const rankMeta = window.getRankMeta ? window.getRankMeta(follower.skill_points || 0) : { name: follower.rank || '—', isGold: false, color: 'inherit' };
      const rankText = window.formatRankText ? window.formatRankText(rankMeta.name) : rankMeta.name;
      const rankStyle = rankMeta.isGold ? '' : `style="color: ${rankMeta.color || 'inherit'} !important"`;
      const rankClass = rankMeta.isGold ? 'rank-gold' : 'muted';
      
      const item = document.createElement('div');
      item.className = 'list-item clickable';
      item.innerHTML = `
        <div class="community-profile-header">
          <img src="${follower.avatar_url || './icons/logobl.png'}" alt="Avatar" class="logo small avatar">
          <div>
            <strong>${follower.username || 'Utilisateur'}</strong>
            <p class="${rankClass}" ${rankStyle}>${rankText}</p>
          </div>
        </div>
      `;
      
      item.addEventListener('click', () => {
        // Fermer ce modal
        modal.classList.add('hidden');
        // Ouvrir le profil de l'utilisateur
        if (window.showCommunityProfile) {
          window.showCommunityProfile({
            userId: follower.id,
            username: follower.username,
            avatar: follower.avatar_url,
            rank: rankMeta.name,
            badges: 0,
            skills: follower.skill_points || 0,
            skillPoints: follower.skill_points || 0,
            isPrivate: false
          });
        }
      });
      
      list.appendChild(item);
    });
  } catch (err) {
    console.error('Erreur lors du chargement des abonnés:', err);
    list.innerHTML = '<p class="muted error">Erreur lors du chargement.</p>';
  }
}

/**
 * Affiche la liste des abonnements dans un modal
 * @param {string} userId - ID de l'utilisateur
 */
export async function showSubscriptionsList(userId) {
  if (!supabaseClient) return;
  
  const modal = document.getElementById('subscriptions-modal');
  const list = document.getElementById('subscriptions-list');
  
  if (!modal || !list) return;
  
  modal.classList.remove('hidden');
  list.innerHTML = '<p class="muted">Chargement...</p>';
  
  try {
    const subscriptions = await Subscriptions.getSubscriptions(supabaseClient, userId);
    
    if (subscriptions.length === 0) {
      list.innerHTML = '<p class="muted">Aucun abonnement pour le moment.</p>';
      return;
    }
    
    list.innerHTML = '';
    
    subscriptions.forEach(subscription => {
      // Calculer le rang depuis les skill points pour avoir le format correct
      const rankMeta = window.getRankMeta ? window.getRankMeta(subscription.skill_points || 0) : { name: subscription.rank || '—', isGold: false, color: 'inherit' };
      const rankText = window.formatRankText ? window.formatRankText(rankMeta.name) : rankMeta.name;
      const rankStyle = rankMeta.isGold ? '' : `style="color: ${rankMeta.color || 'inherit'} !important"`;
      const rankClass = rankMeta.isGold ? 'rank-gold' : 'muted';
      
      const item = document.createElement('div');
      item.className = 'list-item clickable';
      item.innerHTML = `
        <div class="community-profile-header">
          <img src="${subscription.avatar_url || './icons/logobl.png'}" alt="Avatar" class="logo small avatar">
          <div>
            <strong>${subscription.username || 'Utilisateur'}</strong>
            <p class="${rankClass}" ${rankStyle}>${rankText}</p>
          </div>
        </div>
      `;
      
      item.addEventListener('click', () => {
        // Fermer ce modal
        modal.classList.add('hidden');
        // Ouvrir le profil de l'utilisateur
        if (window.showCommunityProfile) {
          window.showCommunityProfile({
            userId: subscription.id,
            username: subscription.username,
            avatar: subscription.avatar_url,
            rank: rankMeta.name,
            badges: 0,
            skills: subscription.skill_points || 0,
            skillPoints: subscription.skill_points || 0,
            isPrivate: false
          });
        }
      });
      
      list.appendChild(item);
    });
  } catch (err) {
    console.error('Erreur lors du chargement des abonnements:', err);
    list.innerHTML = '<p class="muted error">Erreur lors du chargement.</p>';
  }
}

// Export de toutes les fonctions sous un objet
export const SubscriptionUI = {
  initSubscriptionUI,
  renderSubscriptionStats,
  renderCommunityProfileSubscription,
  showSubscribersList,
  showSubscriptionsList
};

