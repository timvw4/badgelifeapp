// App front-end de BadgeLife
// Utilise Supabase (base de données + auth) et une UI 100% front.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, ADMIN_USER_IDS } from './config.js';

// Nom du bucket d'avatars dans Supabase Storage
const AVATAR_BUCKET = 'avatars';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const state = {
  session: null,
  user: null,
  profile: null,
  badges: [],
  badgeById: new Map(),
  communityProfiles: [],
  ideas: [],
  ideaVotes: new Map(), // idea_id -> { likes, dislikes, myVote }
  lowSkillBadges: new Set(), // ids des badges low skill
  userBadges: new Set(),
  userBadgeLevels: new Map(),
  userBadgeAnswers: new Map(), // stocke la réponse saisie par badge
  attemptedBadges: new Set(),
  wasEverUnlocked: new Set(), // badges qui ont déjà été débloqués au moins une fois
  allBadgesFilter: 'all', // all | unlocked | blocked
  themesEnabled: false,
  selectedThemes: null, // null => aucun thème sélectionné (pas de filtre). Set non-vide => filtre.
  currentSkillPoints: 0, // calculé dans updateCounters
  realtimeChannel: null, // Canal Supabase Realtime
  failedBadgeId: null, // ID du badge qui vient d'échouer (pour afficher le message)
  tokens: 0, // Nombre de jetons de l'utilisateur
  selectedBadgeFromWheel: null, // Badge sélectionné par la roue
  isWheelSpinning: false, // État de la roue (en train de tourner ou non)
};

const els = {};

// Ordre fixe des thèmes (utilisé pour le catalogue "Mes badges")
// Tout thème inconnu sera affiché après ceux-ci (ordre alphabétique).
const THEME_ORDER = [
  'Sport',
  'Voyage',
  'Relations',
  'Amour',
  'Études',
  'Travail',
  'Loisir',
  'Technologie',
  'Santé',
  'Lifestyle',
  'Cuisine',
  'Animaux',
  'Nature',
  'Réseaux sociaux',
  'Autres',
  'Badges cachés',
];

function compareThemesFixed(a, b) {
  // "Badges cachés" toujours en bas
  const hiddenTheme = 'Badges cachés';
  if (a === hiddenTheme && b !== hiddenTheme) return 1;
  if (b === hiddenTheme && a !== hiddenTheme) return -1;
  const aa = String(a || '').trim();
  const bb = String(b || '').trim();
  const ia = THEME_ORDER.indexOf(aa);
  const ib = THEME_ORDER.indexOf(bb);
  if (ia !== -1 || ib !== -1) {
    // thèmes connus : ordre fixe
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  }
  // thèmes inconnus : ordre alpha
  return aa.localeCompare(bb, 'fr', { sensitivity: 'base' });
}

function pseudoToEmail(pseudo) {
  if (!pseudo) return '';
  const cleaned = pseudo
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')        // espaces -> tirets
    .replace(/[^a-z0-9._-]/g, ''); // caractères non autorisés retirés
  return `${cleaned || 'user'}@badgelife.dev`; // domaine valide pour Supabase
}

document.addEventListener('DOMContentLoaded', () => {
  cacheElements();
  bindAllBadgesFilters();
  bindRankTooltip();
  attachAuthTabListeners();
  attachFormListeners();
  attachNavListeners();
  attachProfileListeners();
  attachSettingsMenuListeners();
  attachRefreshButton();
  attachCommunitySearchListener();
  attachCommunityTabListeners();
  attachIdeaListeners();
  bootstrapSession();
});

function cacheElements() {
  els.authView = document.getElementById('auth-view');
  els.appView = document.getElementById('app-view');
  els.authMessage = document.getElementById('auth-message');
  els.loginForm = document.getElementById('login-form');
  els.signupForm = document.getElementById('signup-form');
  els.profileUsername = document.getElementById('profile-username');
  els.profileRank = document.getElementById('profile-rank');
  els.rankTooltip = document.getElementById('rank-tooltip');
  els.avatarImg = document.getElementById('avatar-img');
  els.avatarPreviewImg = document.getElementById('avatar-preview-img');
  els.badgeCount = document.getElementById('badge-count');
  els.skillCount = document.getElementById('skill-count');
  els.adminLink = document.getElementById('admin-link');
  els.settingsToggle = document.getElementById('settings-toggle');
  els.settingsMenu = document.getElementById('settings-menu');
  els.refreshBtn = document.getElementById('refresh-btn');
  els.logoutBtn = document.getElementById('logout-btn');
  els.editProfileBtn = document.getElementById('edit-profile-btn');
  els.profilePrivacyBtn = document.getElementById('profile-privacy-btn');
  els.profilePrivacyIndicator = document.getElementById('profile-privacy-indicator');
  els.profilePanel = document.getElementById('profile-panel');
  els.profileForm = document.getElementById('profile-form');
  els.profileName = document.getElementById('profile-name');
  els.profilePassword = document.getElementById('profile-password');
  els.profileAvatar = document.getElementById('profile-avatar');
  els.profileMessage = document.getElementById('profile-message');
  els.tabButtons = document.querySelectorAll('.tab-button[data-tab]');
  els.tabSections = {
    'my-badges': document.getElementById('my-badges'),
    'all-badges': document.getElementById('all-badges'),
    'community': document.getElementById('community'),
  };
  els.myBadgesList = document.getElementById('my-badges-list');
  els.allBadgesList = document.getElementById('all-badges-list');
  els.filterAll = document.getElementById('filter-all');
  els.filterUnlocked = document.getElementById('filter-unlocked');
  els.filterBlocked = document.getElementById('filter-blocked');
  els.communityList = document.getElementById('community-list');
  els.communityProfileModal = document.getElementById('community-profile-modal');
  els.communityProfileClose = document.getElementById('community-profile-close');
  els.communityProfileAvatar = document.getElementById('community-profile-avatar');
  els.communityProfileUsername = document.getElementById('community-profile-username');
  els.communityProfilePrivacyIndicator = document.getElementById('community-profile-privacy-indicator');
  els.communityProfileRank = document.getElementById('community-profile-rank');
  els.communityProfileBadges = document.getElementById('community-profile-badges');
  els.communityProfileMystery = document.getElementById('community-profile-mystery');
  els.communityProfileBadgesList = document.getElementById('community-profile-badges-list');
  els.communitySearch = document.getElementById('community-search');
  els.communityProfilesPanel = document.getElementById('community-profiles-panel');
  els.communityIdeasPanel = document.getElementById('community-ideas-panel');
  els.communityTabDiscover = document.getElementById('community-tab-discover');
  els.communityTabShare = document.getElementById('community-tab-share');
  els.ideaForm = document.getElementById('idea-form');
  els.ideaTitle = document.getElementById('idea-title');
  els.ideaEmoji = document.getElementById('idea-emoji');
  els.ideaDescription = document.getElementById('idea-description');
  els.ideaMessage = document.getElementById('idea-message');
  els.ideaList = document.getElementById('idea-list');
  // Éléments de la roue
  els.tokensCounter = document.getElementById('tokens-counter');
  els.tokensCount = document.getElementById('tokens-count');
  els.wheelContainer = document.getElementById('wheel-container');
  els.wheel = document.getElementById('wheel');
  els.wheelItems = document.getElementById('wheel-items');
  els.wheelIndicator = document.getElementById('wheel-indicator');
  els.spinButton = document.getElementById('spin-button');
  els.badgeQuestionContainer = document.getElementById('badge-question-container');
  els.selectedBadgeName = document.getElementById('selected-badge-name');
  els.selectedBadgeQuestion = document.getElementById('selected-badge-question');
  els.badgeAnswerForm = document.getElementById('badge-answer-form');
  els.badgeAnswerInput = document.getElementById('badge-answer-input');
  els.badgeAnswerMessage = document.getElementById('badge-answer-message');
}

const RANKS = [
  { min: 0, name: 'Compliqué', fontClass: 'rank-font-0', colorClass: 'rank-color-0' },
  { min: 15, name: 'Instable', fontClass: 'rank-font-1', colorClass: 'rank-color-1' },
  { min: 30, name: 'Classique', fontClass: 'rank-font-2', colorClass: 'rank-color-2' },
  { min: 60, name: 'Epanouie', fontClass: 'rank-font-3', colorClass: 'rank-color-3' },
  { min: 100, name: 'Rêve', fontClass: 'rank-font-4', colorClass: 'rank-color-4' },
];

function getRankMeta(skillPoints) {
  const pts = Number(skillPoints) || 0;
  let current = RANKS[0];
  RANKS.forEach(r => {
    if (pts >= r.min) current = r;
  });
  return { ...current, points: pts };
}

function applyRankToElement(el, rankMeta) {
  if (!el || !rankMeta) return;
  const classes = ['rank-font-0', 'rank-font-1', 'rank-font-2', 'rank-font-3', 'rank-font-4'];
  classes.forEach(c => el.classList.remove(c));
  el.classList.add(rankMeta.fontClass);
}

function applyRankColor(el, rankMeta) {
  if (!el || !rankMeta) return;
  const classes = ['rank-color-0', 'rank-color-1', 'rank-color-2', 'rank-color-3', 'rank-color-4'];
  classes.forEach(c => el.classList.remove(c));
  if (rankMeta.colorClass) el.classList.add(rankMeta.colorClass);
}

function renderRankTooltip() {
  if (!els.rankTooltip) return;
  // On montre les seuils de skills nécessaires
  els.rankTooltip.innerHTML = `
    <div class="rank-tooltip-title">Type de vie</div>
    <div class="rank-tooltip-list">
      ${RANKS.map(r => `
        <div class="rank-tooltip-row">
          <span class="rank-tooltip-rank ${r.colorClass}">${r.name}</span>
          <span class="muted">${r.min}+ skills</span>
        </div>
      `).join('')}
    </div>
  `;
}

function bindRankTooltip() {
  if (!els.profileRank || !els.rankTooltip) return;
  renderRankTooltip();

  els.profileRank.addEventListener('click', (e) => {
    e.stopPropagation();
    els.rankTooltip.classList.toggle('hidden');
  });

  document.addEventListener('click', (e) => {
    if (els.rankTooltip.classList.contains('hidden')) return;
    const clickedInside = e.target === els.rankTooltip || els.rankTooltip.contains(e.target) || e.target === els.profileRank;
    if (!clickedInside) els.rankTooltip.classList.add('hidden');
  });
}

function bindAllBadgesFilters() {
  // Les filtres ne sont plus utilisés avec la roue, mais on garde la fonction pour éviter les erreurs
  // Cette fonction peut être supprimée si nécessaire
}

function attachAuthTabListeners() {
  document.querySelectorAll('[data-auth-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-auth-tab]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const target = btn.dataset.authTab;
      if (target === 'login') {
        els.loginForm.classList.remove('hidden');
        els.signupForm.classList.add('hidden');
      } else {
        els.signupForm.classList.remove('hidden');
        els.loginForm.classList.add('hidden');
      }
      setMessage('');
    });
  });
}

function attachFormListeners() {
  els.loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value.trim();
    if (!username) return setMessage('Entre ton pseudo.', true);
    setMessage('Connexion en cours...');
    const email = pseudoToEmail(username); // alias factice mais valide
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      // Message plus clair : pas de connexion si le compte n’existe pas.
      if (error.message?.toLowerCase().includes('invalid login') || error.message?.toLowerCase().includes('invalid')) {
        return setMessage('Compte introuvable ou mot de passe incorrect. Crée un compte si c’est ta première fois.', true);
      }
      return setMessage(error.message, true);
    }
    state.session = data.session;
    state.user = data.user;
    toggleAdminLink(isAdminUser(state.user));
    await loadAppData();
    setupRealtimeSubscription(); // Démarrer l'écoute Realtime après la connexion
  });

  els.signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('signup-username').value.trim();
    const password = document.getElementById('signup-password').value.trim();
    if (username.length < 3) return setMessage('Choisis un pseudo de 3 caractères minimum.', true);
    const email = pseudoToEmail(username); // alias factice mais valide
    setMessage('Création du compte...');

    // Vérifie qu’aucun compte n’utilise déjà ce pseudo (empêche doublon pseudo+mot de passe)
    const { data: existingProfiles, error: profileCheckError } = await supabase
      .from('profiles')
      .select('id')
      .ilike('username', username);
    if (profileCheckError) {
      return setMessage('Erreur lors de la vérification du pseudo.', true);
    }
    if (existingProfiles && existingProfiles.length > 0) {
      return setMessage('Ce pseudo est déjà utilisé. Choisis-en un autre.', true);
    }

    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return setMessage(error.message, true);
    const userId = data.user?.id;
    if (userId) {
      // Donner 3 jetons aux nouveaux utilisateurs
      await supabase.from('profiles').upsert({ 
        id: userId, 
        username, 
        badge_count: 0, 
        skill_points: 0, 
        rank: 'Compliqué',
        tokens: 3,
        last_token_date: null // Pas de date pour qu'ils reçoivent les jetons quotidiens au prochain minuit
      });
    }
    state.session = data.session;
    state.user = data.user;
    toggleAdminLink(isAdminUser(state.user));
    await loadAppData();
    setupRealtimeSubscription(); // Démarrer l'écoute Realtime après l'inscription
    
    // Afficher l'infobulle pour les 3 jetons d'inscription
    showSignupTokensNotification();
  });

  els.logoutBtn.addEventListener('click', async () => {
    await supabase.auth.signOut();
    resetState();
    toggleViews(false);
    toggleAdminLink(false);
    setMessage('Déconnecté. Connecte-toi pour continuer.');
  });
}

function attachNavListeners() {
  els.tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      els.tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      Object.entries(els.tabSections).forEach(([key, section]) => {
        section.classList.toggle('hidden', key !== tab);
      });
    });
  });
}

function attachSettingsMenuListeners() {
  if (!els.settingsToggle || !els.settingsMenu) return;
  els.settingsToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    els.settingsMenu.classList.toggle('hidden');
  });
  document.addEventListener('click', (e) => {
    if (els.settingsMenu.classList.contains('hidden')) return;
    if (els.settingsMenu.contains(e.target) || els.settingsToggle.contains(e.target)) return;
    els.settingsMenu.classList.add('hidden');
  });
  
  // Bouton de confidentialité du profil
  if (els.profilePrivacyBtn) {
    els.profilePrivacyBtn.addEventListener('click', async () => {
      if (!state.user || !state.profile) return;
      const isPrivate = state.profile.is_private || false;
      const newPrivacy = !isPrivate;
      
      // Mise à jour optimiste : changer l'état immédiatement
      const oldPrivacy = state.profile.is_private;
      state.profile.is_private = newPrivacy;
      updatePrivacyButton();
      updatePrivacyIndicator();
      
      // Ensuite, mettre à jour dans Supabase
      const { error } = await supabase
        .from('profiles')
        .update({ is_private: newPrivacy })
        .eq('id', state.user.id);
      
      if (error) {
        console.error('Erreur mise à jour is_private:', error);
        // Revenir en arrière en cas d'erreur
        state.profile.is_private = oldPrivacy;
        updatePrivacyButton();
        updatePrivacyIndicator();
        // Si la colonne n'existe pas, informer l'utilisateur
        if (error.message && error.message.includes('is_private')) {
          setMessage('La colonne is_private n\'existe pas dans Supabase. Veuillez l\'ajouter à la table profiles.', true);
        } else {
          setMessage('Erreur lors de la mise à jour du profil.', true);
        }
        return;
      }
      
      setMessage(`Profil ${newPrivacy ? 'privé' : 'public'}.`, false);
    });
  }
}

function updatePrivacyButton() {
  if (!els.profilePrivacyBtn || !state.profile) return;
  const isPrivate = state.profile.is_private || false;
  els.profilePrivacyBtn.textContent = `Profil: ${isPrivate ? 'Privé' : 'Public'}`;
}

function updatePrivacyIndicator() {
  if (!els.profilePrivacyIndicator || !state.profile) return;
  const isPrivate = state.profile.is_private || false;
  els.profilePrivacyIndicator.style.background = isPrivate ? '#ef4444' : '#22c55e';
  els.profilePrivacyIndicator.style.display = 'inline-block'; // S'assurer qu'il est visible
}

function attachRefreshButton() {
  if (!els.refreshBtn) return;
  els.refreshBtn.addEventListener('click', () => {
    // Recharge la page pour mettre à jour l'affichage
    window.location.reload();
  });
}

function attachCommunitySearchListener() {
  if (!els.communitySearch) return;
  els.communitySearch.addEventListener('input', (e) => {
    renderCommunityFiltered(e.target.value || '');
  });
}

function attachCommunityTabListeners() {
  const tabs = document.querySelectorAll('[data-community-tab]');
  tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      // Désactiver tous les onglets
      tabs.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      const target = btn.dataset.communityTab;
      
      // Afficher/masquer les panneaux
      if (target === 'discover') {
        els.communityProfilesPanel.classList.remove('hidden');
        els.communityIdeasPanel.classList.add('hidden');
      } else if (target === 'share') {
        els.communityProfilesPanel.classList.add('hidden');
        els.communityIdeasPanel.classList.remove('hidden');
      }
    });
  });
}


function attachIdeaListeners() {
  if (els.ideaForm) {
    els.ideaForm.addEventListener('submit', (e) => {
      e.preventDefault();
      submitIdea();
    });
  }
}

function getIdeaStats(ideaId) {
  return state.ideaVotes.get(ideaId) || { likes: 0, dislikes: 0, myVote: null };
}

async function voteIdea(ideaId, vote) {
  if (!state.user) {
    if (els.ideaMessage) {
      els.ideaMessage.textContent = 'Connecte-toi pour voter.';
      els.ideaMessage.classList.add('error');
    }
    return;
  }
  const current = getIdeaStats(ideaId).myVote;
  try {
    if (current === vote) {
      // retirer le vote
      await supabase.from('idea_votes').delete().eq('idea_id', ideaId).eq('user_id', state.user.id);
    } else {
      await supabase.from('idea_votes').upsert({ idea_id: ideaId, user_id: state.user.id, vote });
    }
    await fetchIdeaVotes();
  } catch (err) {
    console.error('voteIdea error:', err);
  }
}

async function bootstrapSession() {
  const { data } = await supabase.auth.getSession();
  if (data.session) {
    state.session = data.session;
    state.user = data.session.user;
    toggleAdminLink(isAdminUser(state.user));
    await loadAppData();
    setupRealtimeSubscription(); // Démarrer l'écoute Realtime après le chargement initial
  } else {
    toggleViews(false);
    toggleAdminLink(false);
    stopRealtimeSubscription(); // Arrêter l'écoute Realtime si l'utilisateur n'est pas connecté
  }
}

function resetState() {
  stopRealtimeSubscription(); // Arrêter l'écoute Realtime
  state.session = null;
  state.user = null;
  state.profile = null;
  state.badges = [];
  state.userBadges = new Set();
  state.userBadgeLevels = new Map();
  state.userBadgeAnswers = new Map();
  state.attemptedBadges = new Set();
  state.wasEverUnlocked = new Set();
  els.myBadgesList.innerHTML = '';
  els.allBadgesList.innerHTML = '';
  els.communityList.innerHTML = '';
}

// Configuration de Supabase Realtime pour écouter les changements
function setupRealtimeSubscription() {
  // Arrêter toute subscription existante
  stopRealtimeSubscription();
  
  if (!state.user) return; // Pas d'utilisateur connecté, pas de subscription
  
  // Créer un canal pour écouter les changements sur les tables profiles et user_badges
  const channel = supabase
    .channel('app-changes')
    .on(
      'postgres_changes',
      {
        event: '*', // Écouter tous les événements (INSERT, UPDATE, DELETE)
        schema: 'public',
        table: 'profiles',
      },
      (payload) => {
        handleProfileChange(payload);
      }
    )
    .on(
      'postgres_changes',
      {
        event: '*', // Écouter tous les événements (INSERT, UPDATE, DELETE)
        schema: 'public',
        table: 'user_badges',
        filter: `user_id=eq.${state.user.id}`, // Seulement les badges de l'utilisateur actuel
      },
      (payload) => {
        handleBadgeChange(payload);
      }
    )
    .subscribe();
  
  state.realtimeChannel = channel;
}

function stopRealtimeSubscription() {
  if (state.realtimeChannel) {
    supabase.removeChannel(state.realtimeChannel);
    state.realtimeChannel = null;
  }
}

// Gérer les changements détectés par Realtime
async function handleProfileChange(payload) {
  if (!state.user) return;
  
  const { eventType, new: newRecord } = payload;
  
  // Si c'est une mise à jour du profil de l'utilisateur actuel
  if (newRecord && newRecord.id === state.user.id) {
    // Mettre à jour le profil local
    if (state.profile) {
      state.profile = { ...state.profile, ...newRecord };
      updatePrivacyButton();
      updatePrivacyIndicator();
      // Re-rendre si nécessaire
      render();
    }
  }
  
  // Si c'est une mise à jour d'un profil dans la communauté
  // Rafraîchir la liste de la communauté pour voir les changements
  if (eventType === 'UPDATE' && newRecord) {
    // Mettre à jour le profil dans la liste de la communauté si présent
    if (state.communityProfiles.length > 0) {
      const updatedProfile = state.communityProfiles.find(p => p.id === newRecord.id);
      if (updatedProfile) {
        // Mettre à jour le profil dans la liste
        Object.assign(updatedProfile, newRecord);
        // Re-rendre la communauté
        renderCommunityFiltered('');
      }
    }
  }
}

// Gérer les changements de badges détectés par Realtime
async function handleBadgeChange(payload) {
  if (!state.user) return;
  
  const { eventType, new: newRecord, old: oldRecord } = payload;
  
  // Ignorer les changements si on est en mode local
  if (isLocalBadgesMode()) return;
  
  // Mettre à jour l'état local selon le type d'événement
  if (eventType === 'INSERT' && newRecord) {
    // Nouveau badge débloqué
    if (newRecord.success !== false) {
      state.userBadges.add(newRecord.badge_id);
      state.wasEverUnlocked.add(newRecord.badge_id); // Marquer comme ayant été débloqué au moins une fois
    } else {
      state.attemptedBadges.add(newRecord.badge_id);
    }
    if (newRecord.level) {
      state.userBadgeLevels.set(newRecord.badge_id, newRecord.level);
    }
    if (newRecord.user_answer) {
      state.userBadgeAnswers.set(newRecord.badge_id, newRecord.user_answer);
    }
    if (newRecord.was_ever_unlocked === true) {
      state.wasEverUnlocked.add(newRecord.badge_id);
    }
  } else if (eventType === 'UPDATE' && newRecord) {
    // Badge mis à jour
    if (newRecord.success !== false) {
      state.userBadges.add(newRecord.badge_id);
      state.wasEverUnlocked.add(newRecord.badge_id); // Marquer comme ayant été débloqué au moins une fois
    } else {
      state.userBadges.delete(newRecord.badge_id);
      state.attemptedBadges.add(newRecord.badge_id);
    }
    if (newRecord.level) {
      state.userBadgeLevels.set(newRecord.badge_id, newRecord.level);
    } else {
      state.userBadgeLevels.delete(newRecord.badge_id);
    }
    if (newRecord.user_answer) {
      state.userBadgeAnswers.set(newRecord.badge_id, newRecord.user_answer);
    } else {
      state.userBadgeAnswers.delete(newRecord.badge_id);
    }
    if (newRecord.was_ever_unlocked === true) {
      state.wasEverUnlocked.add(newRecord.badge_id);
    }
  } else if (eventType === 'DELETE' && oldRecord) {
    // Badge supprimé
    state.userBadges.delete(oldRecord.badge_id);
    state.attemptedBadges.delete(oldRecord.badge_id);
    state.userBadgeLevels.delete(oldRecord.badge_id);
    state.userBadgeAnswers.delete(oldRecord.badge_id);
  }
  
  // Synchroniser les badges fantômes après changement
  await syncGhostBadges();
  
  // Mettre à jour les compteurs et re-rendre
  await updateCounters(false);
  render();
}

async function loadAppData() {
  toggleViews(true);
  try { await fetchProfile(); } catch (e) { console.error(e); }
  try { await fetchBadges(); } catch (e) { console.error(e); }
  try { await fetchUserBadges(); } catch (e) { console.error(e); }
  try { await fetchCommunity(); } catch (e) { console.error(e); }
  try { await fetchIdeas(); } catch (e) { console.error(e); }
  try { await fetchIdeaVotes(); } catch (e) { console.error(e); }
  render();
}

async function fetchProfile() {
  if (!state.user) return;
  // Essayer d'abord avec toutes les colonnes, sinon sans les nouvelles
  let { data, error } = await supabase.from('profiles').select('username, badge_count, avatar_url, skill_points, rank, is_private, tokens, last_token_date').eq('id', state.user.id).single();
  
  // Si certaines colonnes n'existent pas, réessayer sans
  if (error && error.message && (error.message.includes('is_private') || error.message.includes('tokens') || error.message.includes('last_token_date'))) {
    const retry = await supabase.from('profiles').select('username, badge_count, avatar_url, skill_points, rank').eq('id', state.user.id).single();
    if (!retry.error) {
      data = retry.data;
      error = null;
    }
  }
  
  if (error && error.code !== 'PGRST116') {
    console.error('Erreur fetchProfile:', error);
    return;
  }
  if (!data) {
    // Essayer d'insérer avec toutes les colonnes, sinon sans
    const insertData = { id: state.user.id, username: 'Invité', badge_count: 0, avatar_url: null, skill_points: 0, rank: 'Compliqué', tokens: 3 };
    try {
      await supabase.from('profiles').insert({ ...insertData, is_private: false });
      state.profile = { ...insertData, is_private: false, tokens: 3, last_token_date: null };
    } catch (e) {
      await supabase.from('profiles').insert(insertData);
      state.profile = { ...insertData, is_private: false, tokens: 3, last_token_date: null };
    }
  } else {
    state.profile = { 
      ...data, 
      is_private: data.is_private ?? false,
      tokens: data.tokens ?? 3,
      last_token_date: data.last_token_date || null
    };
  }
  state.tokens = state.profile.tokens || 0;
  updatePrivacyButton();
  updatePrivacyIndicator();
  // Vérifier et attribuer les jetons après avoir chargé le profil
  await checkAndGrantTokens();
}

// Vérifie si on est passé à un nouveau jour (minuit) et attribue 2 jetons
async function checkAndGrantTokens() {
  if (!state.user || !state.profile) return;
  
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Minuit aujourd'hui
  const todayStr = today.toISOString().split('T')[0]; // Format YYYY-MM-DD
  
  const lastTokenDate = state.profile.last_token_date ? new Date(state.profile.last_token_date + 'T00:00:00') : null;
  const lastTokenDateStr = lastTokenDate ? lastTokenDate.toISOString().split('T')[0] : null;
  
  // Si last_token_date est différent d'aujourd'hui, attribuer 2 jetons
  if (lastTokenDateStr !== todayStr) {
    const newTokens = (state.profile.tokens || 0) + 2;
    
    // Mettre à jour dans Supabase
    const { error } = await supabase
      .from('profiles')
      .update({ 
        tokens: newTokens,
        last_token_date: todayStr
      })
      .eq('id', state.user.id);
    
    if (!error) {
      state.profile.tokens = newTokens;
      state.profile.last_token_date = todayStr;
      state.tokens = newTokens;
      
      // Afficher l'infobulle de récompense
      showTokenRewardNotification();
      updateTokensDisplay();
    } else {
      console.error('Erreur lors de la mise à jour des jetons:', error);
    }
  } else {
    // Mettre à jour l'affichage même si pas de nouveaux jetons
    updateTokensDisplay();
  }
}

// Affiche une notification quand des jetons sont attribués
function showTokenRewardNotification() {
  // Créer une infobulle temporaire
  const notification = document.createElement('div');
  notification.className = 'token-reward-notification';
  notification.innerHTML = `
    <div class="token-reward-content">
      <span class="token-emoji">🪙</span>
      <span>+2 jetons d'expérience !</span>
    </div>
  `;
  document.body.appendChild(notification);
  
  // Animation d'apparition
  setTimeout(() => notification.classList.add('show'), 10);
  
  // Disparition après 3 secondes
  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

// Affiche une notification pour les 3 jetons d'inscription
function showSignupTokensNotification() {
  // Créer une infobulle temporaire
  const notification = document.createElement('div');
  notification.className = 'token-reward-notification';
  notification.innerHTML = `
    <div class="token-reward-content">
      <span class="token-emoji">🪙</span>
      <span>Bienvenue ! Tu as reçu 3 jetons d'expérience pour t'être inscrit !</span>
    </div>
  `;
  document.body.appendChild(notification);
  
  // Animation d'apparition
  setTimeout(() => notification.classList.add('show'), 10);
  
  // Disparition après 5 secondes (plus long pour laisser le temps de lire)
  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => notification.remove(), 300);
  }, 5000);
}

// Affiche un message explicatif quand on clique sur le bouton sans jetons
function showNoTokensMessage() {
  // Créer un message temporaire
  const message = document.createElement('div');
  message.className = 'no-tokens-message';
  message.innerHTML = `
    <div class="no-tokens-content">
      <span class="token-emoji">🪙</span>
      <div>
        <strong>Pas de jetons disponibles</strong>
        <p>Tu recevras 2 jetons d'expérience chaque jour à minuit. Reviens demain pour continuer à débloquer des badges !</p>
      </div>
    </div>
  `;
  
  // Insérer le message avant le bouton de la roue
  if (els.spinButton && els.spinButton.parentElement) {
    els.spinButton.parentElement.insertBefore(message, els.spinButton);
  } else if (els.wheelContainer) {
    els.wheelContainer.appendChild(message);
  }
  
  // Animation d'apparition
  setTimeout(() => message.classList.add('show'), 10);
  
  // Disparition après 5 secondes
  setTimeout(() => {
    message.classList.remove('show');
    setTimeout(() => message.remove(), 300);
  }, 5000);
}

// Met à jour l'affichage du compteur de jetons
function updateTokensDisplay() {
  if (!els.tokensCount) return;
  els.tokensCount.textContent = state.tokens || 0;
  
  // Activer/désactiver le bouton selon le nombre de jetons
  if (els.spinButton) {
    els.spinButton.disabled = (state.tokens || 0) < 1 || state.isWheelSpinning;
    els.spinButton.textContent = state.isWheelSpinning 
      ? 'Roue en cours...' 
      : `Tourner la roue (1 jeton)`;
  }
}

async function fetchBadges() {
  // On récupère en priorité depuis Supabase.
  // Si on définit window.USE_LOCAL_BADGES = true, ou si Supabase échoue,
  // on charge un fichier local badges.json (plus simple à éditer dans le code).
  const selectWithEmoji = 'id,name,description,question,answer,emoji,low_skill,theme';
  const selectFallback = 'id,name,description,question,answer,theme';
  const useLocalOnly = typeof window !== 'undefined' && window.USE_LOCAL_BADGES === true;

  if (!useLocalOnly) {
    let { data, error } = await supabase.from('badges').select(selectWithEmoji);

    if (error) {
      console.warn('Colonne emoji absente ? On retente sans emoji.', error);
      const retry = await supabase.from('badges').select(selectFallback);
      if (retry.error) {
        console.error(retry.error);
      } else {
        data = retry.data;
      }
    }

    if (data) {
      state.badges = data;
      buildBadgeMaps();
      return;
    }
  }

  // Fallback local
  const localBadges = await loadLocalBadges();
  if (!localBadges.length && !useLocalOnly) {
    setMessage('Impossible de charger les badges.', true);
  }
  state.badges = localBadges;
  buildBadgeMaps();
}

function isLocalBadgesMode() {
  return typeof window !== 'undefined' && window.USE_LOCAL_BADGES === true;
}

function getLocalUserId() {
  return state.user?.id || 'local-user';
}

function loadLocalUserBadgeRows() {
  if (typeof localStorage === 'undefined') return [];
  const key = `localUserBadges:${getLocalUserId()}`;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function saveLocalUserBadgeRows(rows) {
  if (typeof localStorage === 'undefined') return;
  const key = `localUserBadges:${getLocalUserId()}`;
  try {
    localStorage.setItem(key, JSON.stringify(rows ?? []));
  } catch (_) {
    // stockage silencieux
  }
}

async function loadLocalBadges() {
  try {
    const resp = await fetch('./badges.json', { cache: 'no-cache' });
    if (!resp.ok) throw new Error(`badges.json introuvable (${resp.status})`);
    const json = await resp.json();
    if (!Array.isArray(json)) {
      console.warn('badges.json doit contenir un tableau.');
      return [];
    }
    return json;
  } catch (err) {
    console.error('Chargement local des badges échoué :', err);
    return [];
  }
}

async function fetchUserBadges() {
  if (!state.user) return;
  if (isLocalBadgesMode()) {
    const rows = loadLocalUserBadgeRows();
    state.attemptedBadges = new Set(rows.map(row => row.badge_id));
    state.userBadges = new Set(rows.filter(r => r.success !== false).map(row => row.badge_id));
    // Charger les niveaux et réponses pour tous les badges (débloqués et bloqués avec réponses)
    state.userBadgeLevels = new Map(rows.filter(r => r.level !== null).map(r => [r.badge_id, r.level]));
    state.userBadgeAnswers = new Map(rows.filter(r => r.user_answer).map(r => [r.badge_id, r.user_answer]));
    // Marquer les badges actuellement débloqués comme ayant été débloqués au moins une fois
    state.userBadges.forEach(id => state.wasEverUnlocked.add(id));
  await updateCounters(true);
  // Synchroniser les badges fantômes après avoir chargé les badges utilisateur
  await syncGhostBadges();
  return;
  }

  const { data, error } = await supabase.from('user_badges').select('badge_id, level, success, user_answer, was_ever_unlocked').eq('user_id', state.user.id);
  if (error) {
    console.error(error);
    return;
  }
  const rows = data ?? [];
  state.attemptedBadges = new Set(rows.map(row => row.badge_id));
  state.userBadges = new Set(rows.filter(r => r.success !== false).map(row => row.badge_id));
  // Charger les niveaux et réponses pour tous les badges (débloqués et bloqués avec réponses)
  state.userBadgeLevels = new Map(rows.filter(r => r.level !== null).map(r => [r.badge_id, r.level]));
  state.userBadgeAnswers = new Map(rows.filter(r => r.user_answer).map(r => [r.badge_id, r.user_answer]));
  // Charger was_ever_unlocked depuis la base de données
  rows.forEach(row => {
    if (row.was_ever_unlocked === true) {
      state.wasEverUnlocked.add(row.badge_id);
    }
  });
  await updateCounters(true);
  // Synchroniser les badges fantômes après avoir chargé les badges utilisateur
  await syncGhostBadges();
}

async function fetchCommunity() {
  // Essayer d'abord avec is_private, sinon sans
  let { data, error } = await supabase
    .from('profiles')
    .select('id,username,badge_count,avatar_url,skill_points,rank,is_private')
    .order('badge_count', { ascending: false })
    .limit(50);
  
  // Si la colonne is_private n'existe pas, réessayer sans
  if (error && error.message && error.message.includes('is_private')) {
    const retry = await supabase
      .from('profiles')
      .select('id,username,badge_count,avatar_url,skill_points,rank')
      .order('badge_count', { ascending: false })
      .limit(50);
    if (!retry.error) {
      data = retry.data;
      error = null;
    }
  }
  
  if (error) {
    console.error('Erreur fetchCommunity:', error);
    // Même en cas d'erreur, essayer d'afficher ce qui est disponible
    if (!data || data.length === 0) {
      renderCommunity([]);
      return;
    }
  }

  const profiles = data ?? [];
  
  // S'assurer que tous les profils ont is_private défini
  profiles.forEach(p => {
    if (p.is_private === undefined) {
      p.is_private = false;
    }
  });
  const ids = profiles.map(p => p.id).filter(Boolean);

  if (ids.length) {
    // Recalcule les compteurs via user_badges pour avoir des chiffres à jour (success != false).
    const { data: rows, error: errBadges } = await supabase
      .from('user_badges')
      .select('user_id, badge_id, level, success')
      .in('user_id', ids);
    if (!errBadges && Array.isArray(rows)) {
      // Grouper les badges par utilisateur
      const badgesByUser = new Map();
      rows.forEach(r => {
        if (r.success === false) return;
        const uid = r.user_id;
        if (!badgesByUser.has(uid)) {
          badgesByUser.set(uid, []);
        }
        badgesByUser.get(uid).push(r);
      });
      
      const countMap = new Map();
      const mysteryMap = new Map();
      
      // Pour chaque utilisateur, calculer les points et filtrer les badges fantômes
      badgesByUser.forEach((userBadges, userId) => {
        // Calculer les points de skills pour cet utilisateur
        let userSkillPoints = 0;
        const badgesWithLevels = new Set();
        const userBadgeIds = new Set();
        
        userBadges.forEach(row => {
          if (row.badge_id) {
            userBadgeIds.add(row.badge_id);
            if (row.level) {
              userSkillPoints += getSkillPointsForBadge(row.badge_id, row.level);
              badgesWithLevels.add(row.badge_id);
            }
          }
        });
        
        // Ajouter les points pour les badges sans niveau
        userBadges.forEach(row => {
          if (row.badge_id && !badgesWithLevels.has(row.badge_id)) {
            const badge = state.badges.find(b => b.id === row.badge_id);
            if (badge) {
              userSkillPoints += calculatePointsForBadgeWithoutLevel(badge, row.badge_id, row.user_answer);
            }
          }
        });
        
        // Filtrer les badges fantômes qui ne devraient pas être débloqués
        const validBadges = userBadges.filter(row => {
          if (!row.badge_id) return false;
          const badge = state.badges.find(b => b.id === row.badge_id);
          if (!badge || !isGhostBadge(badge)) return true; // Garder les badges non-fantômes
          
          // Vérifier si le badge fantôme devrait être débloqué
          const shouldBeUnlocked = checkGhostBadgeConditionsForUser(badge, userBadgeIds, userSkillPoints);
          return shouldBeUnlocked;
        });
        
        // Compter les badges valides
        countMap.set(userId, validBadges.length);
        
        // Compter les badges "mystery" (Expert)
        validBadges.forEach(r => {
          if (isMysteryLevel(r.level)) {
            mysteryMap.set(userId, (mysteryMap.get(userId) || 0) + 1);
          }
        });
      });
      
      profiles.forEach(p => {
        p.badge_count = countMap.get(p.id) || 0;
        p.mystery_count = mysteryMap.get(p.id) || 0;
        // S'assurer que is_private existe, sinon le définir à false
        if (p.is_private === undefined) {
          p.is_private = false;
        }
      });
    }
  }

  state.communityProfiles = profiles;
  renderCommunityFiltered('');
}

async function fetchIdeaVotes() {
  try {
    const { data, error } = await supabase
      .from('idea_votes')
      .select('idea_id, vote, user_id');
    if (error) throw error;
    const stats = new Map();
    const currentUserId = state.user?.id;
    data.forEach(row => {
      const s = stats.get(row.idea_id) || { likes: 0, dislikes: 0, myVote: null };
      if (row.vote > 0) s.likes += 1;
      if (row.vote < 0) s.dislikes += 1;
      if (currentUserId && row.user_id === currentUserId) {
        s.myVote = row.vote;
      }
      stats.set(row.idea_id, s);
    });
    state.ideaVotes = stats;
    renderIdeas();
  } catch (err) {
    console.error('fetchIdeaVotes error:', err);
  }
}

async function fetchIdeas() {
  try {
    const { data, error } = await supabase
      .from('ideas')
      .select('id,title,description,emoji,user_id,created_at')
      .order('created_at', { ascending: false });
    if (error) throw error;
    state.ideas = data || [];
    renderIdeas();
  } catch (err) {
    console.error('fetchIdeas error:', err);
    // Si la colonne emoji n'existe pas, on retente sans emoji
    if (err.message && err.message.toLowerCase().includes('emoji')) {
      try {
        const { data, error: error2 } = await supabase
          .from('ideas')
          .select('id,title,description,user_id,created_at')
          .order('created_at', { ascending: false });
        if (error2) throw error2;
        state.ideas = data || [];
        renderIdeas();
      } catch (err2) {
        console.error('fetchIdeas retry error:', err2);
      }
    }
  }
}
function render() {
  if (state.profile) {
    els.profileUsername.textContent = state.profile.username;
    if (els.profileName) els.profileName.value = state.profile.username;
    updateAvatar(state.profile.avatar_url);
    updateCounters(false);
  }
  renderAllBadges();
  renderMyBadges();
}

function isGhostBadge(badge) {
  const config = parseConfig(badge.answer);
  if (config?.isGhost !== true) return false;
  const hasAnyPrereq =
    (Array.isArray(config.requiredBadges) && config.requiredBadges.length > 0) ||
    (Number(config.minBadges || 0) > 0) ||
    (Number(config.minSkills || 0) > 0) ||
    Boolean((config.minRank || '').toString().trim());
  return hasAnyPrereq;
}

function checkGhostBadgeConditions(badge) {
  return checkGhostBadgeConditionsForUser(badge, state.userBadges, state.currentSkillPoints || 0);
}

// Vérifie si un badge fantôme devrait être débloqué pour un utilisateur donné
// userBadgeIds: Set ou array des IDs de badges débloqués de l'utilisateur
// userSkillPoints: nombre de points de skills de l'utilisateur
function checkGhostBadgeConditionsForUser(badge, userBadgeIds, userSkillPoints) {
  const config = parseConfig(badge.answer);
  if (!config?.isGhost) return false;

  // Convertir en Set si c'est un array
  const badgeSet = userBadgeIds instanceof Set ? userBadgeIds : new Set(userBadgeIds);

  const prereqMode = (config.prereqMode === 'any') ? 'any' : 'all'; // défaut: all (ET)
  const checks = [];

  // 1) Badges requis (liste) => ce bloc est vrai seulement si TOUS les badges requis sont débloqués
  if (Array.isArray(config.requiredBadges) && config.requiredBadges.length > 0) {
    const okBadges = config.requiredBadges.every(requiredId => {
      const idStr = String(requiredId);
      return badgeSet.has(idStr) || badgeSet.has(Number(idStr));
    });
    checks.push(okBadges);
  }

  // 2) Min badges débloqués
  const minBadges = Number(config.minBadges || 0);
  if (Number.isFinite(minBadges) && minBadges > 0) {
    checks.push((badgeSet?.size || 0) >= minBadges);
  }

  // 3) Min points de skills
  const minSkills = Number(config.minSkills || 0);
  if (Number.isFinite(minSkills) && minSkills > 0) {
    checks.push((userSkillPoints || 0) >= minSkills);
  }

  // 4) Rang minimum
  const minRank = (config.minRank || '').toString().trim();
  if (minRank) {
    const order = ['Compliqué', 'Instable', 'Classique', 'Epanouie', 'Rêve'];
    const currentRank = getRankMeta(userSkillPoints || 0).name;
    checks.push(order.indexOf(currentRank) >= order.indexOf(minRank));
  }

  // Sécurité: aucun prérequis défini => jamais débloqué
  if (!checks.length) return false;

  return prereqMode === 'any'
    ? checks.some(Boolean)
    : checks.every(Boolean);
}

async function syncGhostBadges() {
  if (!state.user) return;

  const ghostBadges = state.badges.filter(isGhostBadge);
  let changed = false;

  for (const badge of ghostBadges) {
    const shouldBeUnlocked = checkGhostBadgeConditions(badge);
    const isUnlocked = state.userBadges.has(badge.id);
    const isLocalMode = isLocalBadgesMode();

    // 1) Débloquer si conditions OK et pas déjà débloqué
    if (shouldBeUnlocked && !isUnlocked) {
      if (isLocalMode) {
        const rows = loadLocalUserBadgeRows();
        const others = rows.filter(r => r.badge_id !== badge.id);
        const updated = [...others, {
          badge_id: badge.id,
          success: true,
          level: null,
          user_answer: null
        }];
        saveLocalUserBadgeRows(updated);
      } else {
        await supabase.from('user_badges').upsert({
          user_id: state.user.id,
          badge_id: badge.id,
          success: true,
          level: null,
          user_answer: null,
        });
      }
      state.userBadges.add(badge.id);
      state.wasEverUnlocked.add(badge.id); // Marquer comme ayant été débloqué au moins une fois
      state.userBadgeLevels.delete(badge.id);
      state.userBadgeAnswers.delete(badge.id);
      changed = true;
      continue;
    }

    // 2) RebLoquer si conditions NON OK mais badge déjà débloqué
    if (!shouldBeUnlocked && isUnlocked) {
      if (isLocalMode) {
        const rows = loadLocalUserBadgeRows();
        const updated = rows.filter(r => r.badge_id !== badge.id);
        saveLocalUserBadgeRows(updated);
      } else {
        await supabase
          .from('user_badges')
          .delete()
          .eq('user_id', state.user.id)
          .eq('badge_id', badge.id);
      }
      state.userBadges.delete(badge.id);
      state.userBadgeLevels.delete(badge.id);
      state.userBadgeAnswers.delete(badge.id);
      changed = true;
    }
  }

  if (changed) {
    await updateCounters(false);
    render();
  }
}

function renderAllBadges() {
  // Nouvelle fonction pour afficher la roue au lieu de la liste de badges
  renderWheelBadges();
}

// Affiche la roue avec les badges non débloqués (hors fantômes)
function renderWheelBadges() {
  if (!els.wheelContainer || !els.wheelItems) return;
  
  // Filtrer les badges : seulement ceux non débloqués et non fantômes
  const availableBadges = state.badges.filter(badge => {
    return !isGhostBadge(badge) && !state.userBadges.has(badge.id);
  });
  
  if (availableBadges.length === 0) {
    els.wheelContainer.innerHTML = '<p class="muted">Tous les badges sont débloqués ! 🎉</p>';
    return;
  }
  
  // Vider la roue
  els.wheelItems.innerHTML = '';
  
  // Répéter les badges plusieurs fois pour créer un effet de boucle (au moins 5 fois)
  const REPEAT_COUNT = Math.max(5, Math.ceil(300 / availableBadges.length)); // Assez de répétitions pour remplir la hauteur visible
  
  // Créer les éléments de la roue (emojis des badges) en boucle
  for (let i = 0; i < REPEAT_COUNT; i++) {
    availableBadges.forEach(badge => {
      const item = document.createElement('div');
      item.className = 'wheel-item';
      item.dataset.badgeId = badge.id;
      item.textContent = getBadgeEmoji(badge);
      els.wheelItems.appendChild(item);
    });
  }
  
  // Mettre à jour l'affichage des jetons
  updateTokensDisplay();
  
  // Attacher l'événement au bouton de spin
  if (els.spinButton && !els.spinButton.hasAttribute('data-listener-attached')) {
    els.spinButton.addEventListener('click', handleSpinWheel);
    els.spinButton.setAttribute('data-listener-attached', 'true');
  }
  
  // Attacher l'événement au formulaire de réponse
  if (els.badgeAnswerForm && !els.badgeAnswerForm.hasAttribute('data-listener-attached')) {
    els.badgeAnswerForm.addEventListener('submit', handleBadgeAnswerFromWheel);
    els.badgeAnswerForm.setAttribute('data-listener-attached', 'true');
  }
}

// Fait tourner la roue et sélectionne un badge aléatoirement
async function handleSpinWheel() {
  if (state.isWheelSpinning) return;
  
  // Vérifier si l'utilisateur a des jetons
  if ((state.tokens || 0) < 1) {
    showNoTokensMessage();
    return;
  }
  
  // Filtrer les badges disponibles
  const availableBadges = state.badges.filter(badge => {
    return !isGhostBadge(badge) && !state.userBadges.has(badge.id);
  });
  
  if (availableBadges.length === 0) {
    alert('Tous les badges sont débloqués ! 🎉');
    return;
  }
  
  // Consommer un jeton
  const newTokens = (state.tokens || 0) - 1;
  const { error } = await supabase
    .from('profiles')
    .update({ tokens: newTokens })
    .eq('id', state.user.id);
  
  if (error) {
    console.error('Erreur lors de la consommation du jeton:', error);
    return;
  }
  
  state.tokens = newTokens;
  state.profile.tokens = newTokens;
  updateTokensDisplay();
  state.isWheelSpinning = true;
  
  // Sélectionner un badge aléatoirement (roue équitable)
  const randomIndex = Math.floor(Math.random() * availableBadges.length);
  const selectedBadge = availableBadges[randomIndex];
  state.selectedBadgeFromWheel = selectedBadge;
  
  // Animation de la roue
  const wheelItems = els.wheelItems.querySelectorAll('.wheel-item');
  const itemHeight = 60; // Hauteur d'un élément (à ajuster selon le CSS)
  const singleSetHeight = availableBadges.length * itemHeight; // Hauteur d'un set complet de badges
  
  // Trouver le premier élément du badge sélectionné dans la première moitié de la roue
  // (pour éviter de viser trop loin)
  let targetIndex = -1;
  const firstHalfItems = Math.floor(wheelItems.length / 2);
  for (let i = 0; i < firstHalfItems; i++) {
    if (wheelItems[i].dataset.badgeId === selectedBadge.id) {
      targetIndex = i;
      break;
    }
  }
  
  // Si on ne trouve pas dans la première moitié, prendre le premier trouvé
  if (targetIndex === -1) {
    for (let i = 0; i < wheelItems.length; i++) {
      if (wheelItems[i].dataset.badgeId === selectedBadge.id) {
        targetIndex = i;
        break;
      }
    }
  }
  
  // Calculer la position finale
  // On fait plusieurs tours complets + on s'arrête sur le badge sélectionné
  const spins = 3; // Nombre de tours complets
  const centerOffset = 150; // Position du centre de la roue (hauteur / 2)
  const finalPosition = -(spins * singleSetHeight + targetIndex * itemHeight - centerOffset + itemHeight / 2);
  
  // Réinitialiser la position pour permettre une nouvelle animation
  els.wheelItems.style.transition = 'none';
  els.wheelItems.style.transform = 'translateY(0)';
  
  // Forcer un reflow pour que la réinitialisation prenne effet
  void els.wheelItems.offsetHeight;
  
  // Appliquer l'animation
  els.wheelItems.style.transition = 'transform 3s cubic-bezier(0.17, 0.67, 0.12, 0.99)';
  els.wheelItems.style.transform = `translateY(${finalPosition}px)`;
  
  // Après l'animation, afficher la question
  setTimeout(() => {
    state.isWheelSpinning = false;
    updateTokensDisplay();
    showBadgeQuestion(selectedBadge);
  }, 3000);
}

// Affiche la question du badge sélectionné
function showBadgeQuestion(badge) {
  if (!els.badgeQuestionContainer || !els.selectedBadgeName || !els.selectedBadgeQuestion) return;
  
  els.selectedBadgeName.textContent = stripEmojis(badge.name || '');
  els.selectedBadgeQuestion.textContent = badge.question || '';
  els.badgeAnswerInput.value = '';
  els.badgeAnswerMessage.textContent = '';
  els.badgeAnswerMessage.className = 'message';
  
  // Afficher le conteneur
  els.badgeQuestionContainer.classList.remove('hidden');
  
  // Scroll vers le conteneur
  els.badgeQuestionContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Gère la réponse au badge depuis la roue
async function handleBadgeAnswerFromWheel(e) {
  e.preventDefault();
  if (!state.selectedBadgeFromWheel) return;
  
  const answer = els.badgeAnswerInput.value.trim();
  if (!answer) {
    els.badgeAnswerMessage.textContent = 'Entre une réponse.';
    els.badgeAnswerMessage.classList.add('error');
    return;
  }
  
  // Utiliser la même fonction que pour les badges normaux
  await handleBadgeAnswer(e, state.selectedBadgeFromWheel, answer);
  
  // Après la réponse, vérifier si le badge a été débloqué
  const wasUnlocked = state.userBadges.has(state.selectedBadgeFromWheel.id);
  
  if (wasUnlocked) {
    els.badgeAnswerMessage.textContent = '🎉 Badge débloqué !';
    els.badgeAnswerMessage.classList.remove('error');
    els.badgeAnswerMessage.classList.add('success');
    
    // Masquer le conteneur après 2 secondes et recharger la roue
    setTimeout(() => {
      els.badgeQuestionContainer.classList.add('hidden');
      renderWheelBadges();
      renderMyBadges(); // Mettre à jour "Mes badges"
    }, 2000);
  } else {
    els.badgeAnswerMessage.textContent = 'Ta réponse n\'a pas suffi pour débloquer ce badge.';
    els.badgeAnswerMessage.classList.add('error');
    els.badgeAnswerMessage.classList.remove('success');
  }
}

function renderMyBadges() {
  // On affiche uniquement les badges qui ont été répondu (débloqués, bloqués, ou rebloqués)
  // Les badges jamais répondu ne sont pas affichés
  const allBadges = state.badges.slice();
  if (!allBadges.length) {
    els.myBadgesList.innerHTML = '<p class="muted">Aucun badge pour le moment.</p>';
    return;
  }

  // Filtrer les badges : ne garder que ceux qui sont débloqués OU rebloqués
  const visibleBadges = allBadges.filter(badge => {
    const unlocked = state.userBadges.has(badge.id);
    const userAnswer = state.userBadgeAnswers.get(badge.id);
    const hasAnswer = userAnswer !== undefined && userAnswer !== null;
    const wasEverUnlocked = state.wasEverUnlocked.has(badge.id);
    const isBlocked = !unlocked && hasAnswer;
    const isReblocked = isBlocked && wasEverUnlocked;
    // Afficher uniquement si débloqué OU rebloqué
    return unlocked || isReblocked;
  });

  if (!visibleBadges.length) {
    els.myBadgesList.innerHTML = '<p class="muted">Aucun badge pour le moment.</p>';
    return;
  }

  els.myBadgesList.classList.remove('list-mode');
  els.myBadgesList.classList.add('my-badges-catalog');
  els.myBadgesList.innerHTML = '';
  
  // Regrouper par thème
  const themeName = (b) => (b.theme && String(b.theme).trim()) ? String(b.theme).trim() : 'Autres';
  const groups = new Map();
  visibleBadges.forEach(b => {
    const t = themeName(b);
    if (!groups.has(t)) groups.set(t, []);
    groups.get(t).push(b);
  });
  const themes = Array.from(groups.keys()).sort(compareThemesFixed);
  // Trier les badges dans un thème par ID (numérique ou texte)
  const sortById = (a, b) => String(a.id).localeCompare(String(b.id), 'fr', { numeric: true, sensitivity: 'base' });

  themes.forEach((t) => {
    // Ne pas afficher le thème s'il n'y a aucun badge à afficher
    const themeBadges = groups.get(t) || [];
    if (themeBadges.length === 0) return;

    const title = document.createElement('div');
    title.className = 'section-subtitle theme-title';
    // Si aucun badge de ce thème n'est débloqué, on floute le titre du thème
    const hasAnyUnlockedInTheme = themeBadges.some(b => state.userBadges.has(b.id));
    if (!hasAnyUnlockedInTheme) {
      // Mode Pokédex : thème caché tant qu'aucun badge du thème n'est débloqué
      title.classList.add('theme-locked');
      title.textContent = '?????';
      title.dataset.theme = t;
    } else {
      title.textContent = t;
    }
    els.myBadgesList.appendChild(title);

    themeBadges.sort(sortById).forEach(badge => {
      const unlocked = state.userBadges.has(badge.id);
      const levelLabel = state.userBadgeLevels.get(badge.id);
      const config = parseConfig(badge.answer);
      const isGhost = isGhostBadge(badge);
      const userAnswer = state.userBadgeAnswers.get(badge.id);
      const hasAnswer = userAnswer !== undefined && userAnswer !== null;
      const wasEverUnlocked = state.wasEverUnlocked.has(badge.id);
      const isBlocked = !unlocked && hasAnswer;
      // Distinguer deux états de badges bloqués :
      // - "bloqué" : répondu mais jamais débloqué (affiche ????)
      // - "rebloqué" : débloqué puis rebloqué (affiche le badge en flou et grisé)
      const isReblocked = isBlocked && wasEverUnlocked;
      const isBlockedNeverUnlocked = isBlocked && !wasEverUnlocked;

      const card = document.createElement('article');
      card.className = `card-badge clickable compact all-badge-card my-catalog-card${unlocked ? '' : ' locked'}${isBlocked ? ' blocked' : ''}${isReblocked ? ' reblocked' : ''}`;

      // Afficher les badges selon leur état :
      // - débloqués : normalement
      // - rebloqués : emoji/nom en flou et grisé
      // - bloqués (jamais débloqués) : ?????
      // - jamais répondu : ❓ et ?????
      const safeEmoji = unlocked || isReblocked ? getBadgeEmoji(badge) : '❓';
      const safeTitle = unlocked || isReblocked ? stripEmojis(badge.name || '') : '?????';

      // Déterminer le label selon l'état du badge :
      // 1. Débloqué : afficher le niveau
      // 2. Rebloqué : afficher "Rebloqué"
      // 3. Bloqué : afficher "Bloqué"
      // 4. À débloquer : afficher "À débloquer"
      let statusLabel;
      let statusClass;
      
      if (unlocked) {
        // État : Débloqué
        statusLabel = formatLevelTag(unlocked, levelLabel, config);
        statusClass = isMysteryLevel(levelLabel) ? 'mystery' : 'success';
      } else if (isReblocked) {
        // État : Rebloqué
        statusLabel = 'Rebloqué';
        statusClass = 'reblocked';
      } else if (isBlocked) {
        // État : Bloqué
        statusLabel = 'Bloqué';
        statusClass = 'blocked';
      } else {
        // État : À débloquer
        statusLabel = 'À débloquer';
        statusClass = 'locked';
      }
      const isExpert = unlocked && isMysteryLevel(levelLabel);
      
      if (isExpert) {
        card.classList.add('expert-badge');
      }

      const formattedAnswer = unlocked && userAnswer ? formatUserAnswer(badge, userAnswer) : null;
      const ghostText = unlocked && isGhost ? (config?.ghostDisplayText || 'Débloqué automatiquement') : null;
      const displayText = formattedAnswer || ghostText || (isBlocked && userAnswer ? formatUserAnswer(badge, userAnswer) : null) || (unlocked ? '' : 'Badge non débloqué');

      card.innerHTML = `
        <div class="row level-row">
          <span class="tag ${statusClass}">${statusLabel}</span>
        </div>
        <div class="badge-compact">
          <div class="badge-emoji">${safeEmoji}</div>
          <div class="badge-title">${safeTitle}</div>
        </div>
        <div class="all-badge-details hidden">
          <p class="muted">${displayText || ''}</p>
        </div>
      `;

      const details = card.querySelector('.all-badge-details');
      card.addEventListener('click', (e) => {
        const tag = e.target.tagName.toLowerCase();
        if (tag === 'input' || tag === 'button' || e.target.closest('form')) return;
        
        // Fermer tous les autres badges
        const allCards = els.myBadgesList.querySelectorAll('.my-catalog-card');
        allCards.forEach(otherCard => {
          if (otherCard !== card) {
            const otherDetails = otherCard.querySelector('.all-badge-details');
            if (otherDetails) {
              otherDetails.classList.add('hidden');
              otherCard.classList.remove('expanded');
            }
          }
        });
        
        // Ouvrir/fermer le badge cliqué
        details.classList.toggle('hidden');
        card.classList.toggle('expanded');
      });

      els.myBadgesList.appendChild(card);
    });
  });
}

function renderCommunity(profiles) {
  if (!profiles.length) {
    els.communityList.innerHTML = '<p class="muted">Personne pour le moment.</p>';
    return;
  }
  els.communityList.innerHTML = '';
  profiles.forEach(profile => {
    const avatarUrl = profile.avatar_url || './icons/logobl.png';
    const item = document.createElement('div');
    item.className = 'list-item';
    item.dataset.userId = profile.id || '';
    item.dataset.username = profile.username;
    item.dataset.avatar = avatarUrl;
    item.dataset.badges = profile.badge_count ?? 0;
    item.dataset.mystery = profile.mystery_count ?? 0;
    item.dataset.skillPoints = profile.skill_points ?? 0;
    item.dataset.rank = profile.rank ?? '';
    item.dataset.isPrivate = (profile.is_private === true || profile.is_private === 'true') ? 'true' : 'false';
    const rankMeta = getRankMeta(profile.skill_points ?? 0);
    // Utiliser le rang stocké ou calculer depuis les points
    const displayRank = profile.rank || rankMeta.name;
    const rankText = formatRankText(displayRank);
    item.innerHTML = `
      <div class="community-profile-header">
        <img src="${avatarUrl}" alt="Avatar" class="logo small avatar">
        <div>
          <strong class="${rankMeta.fontClass}">${profile.username}</strong>
          <p class="muted ${rankMeta.colorClass}">${rankText}</p>
        </div>
      </div>
      <span class="pill">${profile.badge_count ?? 0} badge(s)</span>
    `;
    item.addEventListener('click', () => showCommunityProfile(item.dataset));
    els.communityList.appendChild(item);
  });
}

function renderCommunityFiltered(term = '') {
  const lower = term.trim().toLowerCase();
  const list = state.communityProfiles || [];
  const filtered = lower
    ? list.filter(p => (p.username || '').toLowerCase().includes(lower))
    : list;
  renderCommunity(filtered);
}

function renderIdeas() {
  if (!els.ideaList) return;
  if (!state.ideas.length) {
    els.ideaList.innerHTML = '<p class="muted">Aucune idée proposée pour le moment.</p>';
    return;
  }
  const uid = state.user?.id;
  const nameMap = new Map(state.communityProfiles.map(p => [p.id, p.username || '']));
  els.ideaList.innerHTML = '';
  state.ideas.forEach(idea => {
    const canDelete = uid && idea.user_id === uid;
    const authorName = nameMap.get(idea.user_id) || idea.user_id || 'Anonyme';
    const stats = getIdeaStats(idea.id);
    const card = document.createElement('article');
    card.className = 'idea-card';
    const emoji = idea.emoji ? `<span class="idea-emoji">${idea.emoji}</span>` : '';
    card.innerHTML = `
      <header>
        <div>
          <div class="idea-title">${emoji} ${idea.title || ''}</div>
          <div class="idea-meta">par ${authorName}</div>
        </div>
        ${canDelete ? `<div class="idea-actions"><button class="idea-delete" data-id="${idea.id}">✕</button></div>` : ''}
      </header>
      <div class="idea-description muted">${idea.description || ''}</div>
      <div class="idea-votes">
        <button class="idea-vote-btn ${stats.myVote === 1 ? 'active' : ''}" data-id="${idea.id}" data-vote="1">👍 <span>${stats.likes}</span></button>
        <button class="idea-vote-btn ${stats.myVote === -1 ? 'active' : ''}" data-id="${idea.id}" data-vote="-1">👎 <span>${stats.dislikes}</span></button>
      </div>
    `;
    if (canDelete) {
      const btn = card.querySelector('.idea-delete');
      btn.addEventListener('click', () => deleteIdea(idea.id));
    }
    card.querySelectorAll('.idea-vote-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const ideaId = btn.dataset.id;
        const vote = Number(btn.dataset.vote);
        voteIdea(ideaId, vote);
      });
    });
    els.ideaList.appendChild(card);
  });
}

async function submitIdea() {
  if (!els.ideaTitle || !els.ideaDescription || !els.ideaMessage) return;
  const title = els.ideaTitle.value.trim();
  const emoji = els.ideaEmoji ? els.ideaEmoji.value.trim() : '';
  const description = els.ideaDescription.value.trim();
  if (!title || !description) {
    els.ideaMessage.textContent = 'Nom et description requis.';
    els.ideaMessage.classList.add('error');
    return;
  }
  const userId = state.user?.id || null;
  const payload = { title, description, user_id: userId };
  if (emoji) {
    payload.emoji = emoji;
  }
  const { data, error } = await supabase
    .from('ideas')
    .insert(payload)
    .select();
  if (error) {
    els.ideaMessage.textContent = 'Erreur, idée non envoyée.';
    els.ideaMessage.classList.add('error');
    return;
  }
  els.ideaMessage.textContent = 'Idée envoyée, merci !';
  els.ideaMessage.classList.remove('error');
  els.ideaTitle.value = '';
  if (els.ideaEmoji) els.ideaEmoji.value = '';
  els.ideaDescription.value = '';
  if (data && data.length) {
    state.ideas = [data[0], ...state.ideas];
    renderIdeas();
  } else {
    await fetchIdeas();
  }
}

async function deleteIdea(id) {
  if (!state.user) return;
  const { error } = await supabase.from('ideas').delete().eq('id', id);
  if (error) {
    console.error(error);
    return;
  }
  state.ideas = state.ideas.filter(i => i.id !== id);
  renderIdeas();
}

async function handleBadgeAnswer(event, badge, providedAnswer = null) {
  event.preventDefault();
  const localMode = isLocalBadgesMode();
  if (!state.user && !localMode) return setMessage('Connecte-toi pour gagner des badges.', true);
  if (localMode && !state.user) {
    // User local par défaut pour stocker en localStorage
    state.user = { id: 'local-user', username: 'Local user' };
  }
  const form = event.target;
  const config = parseConfig(badge.answer);
  const isMultiSelect = config?.type === 'multiSelect';
  const isSingleSelect = config?.type === 'singleSelect';
  
  // Si une réponse est fournie (depuis la roue), l'utiliser directement
  let answer = providedAnswer;
  let rawAnswer = answer;
  let selectedOptions = [];
  
  if (!answer) {
    const selectInput = isMultiSelect ? form.querySelector('select[name="answer-select"]') : null;
    const checkboxInputs = isMultiSelect ? form.querySelectorAll('input[name="answer-option"]:checked') : null;
    const singleSelectInput = isSingleSelect ? form.querySelector('select[name="answer-single"]') : null;
    const answerInput = (isMultiSelect || isSingleSelect) ? null : form.querySelector('input[name="answer"]');
    selectedOptions = isMultiSelect
      ? (
          selectInput
            ? Array.from(selectInput.selectedOptions || []).map(o => o.value)
            : Array.from(checkboxInputs || []).map(el => el.value)
      )
    : [];
    const feedback = form ? form.querySelector('.message') : null;
    if (feedback) feedback.textContent = '';
    rawAnswer = isMultiSelect
      ? selectedOptions.join(', ')
      : (isSingleSelect ? (singleSelectInput?.value || '') : (answerInput?.value.trim() || ''));
    
    if (isMultiSelect && !selectedOptions.length) {
      if (feedback) {
        feedback.textContent = 'Choisis au moins une option.';
        feedback.classList.add('error');
      }
      return;
    }
    if (isSingleSelect && !rawAnswer) {
      if (feedback) {
        feedback.textContent = 'Choisis une option.';
        feedback.classList.add('error');
      }
      return;
    }
    if (!isMultiSelect && !isSingleSelect && !rawAnswer) {
      if (feedback) {
        feedback.textContent = 'Réponse vide.';
        feedback.classList.add('error');
      }
      return;
    }
  }

  const result = evaluateBadgeAnswer(badge, rawAnswer, selectedOptions);
  if (!result.ok) {
    // On enregistre aussi l'échec avec niveau 0 (badge bloqué)
    const level0 = 'niv 0'; // Niveau 0 = badge bloqué = 0 point
    if (localMode) {
      const rows = loadLocalUserBadgeRows();
      const others = rows.filter(r => r.badge_id !== badge.id);
      const updated = [...others, { badge_id: badge.id, success: false, level: level0, user_answer: rawAnswer || null }];
      saveLocalUserBadgeRows(updated);
    } else {
      // Préserver was_ever_unlocked si le badge a déjà été débloqué avant
      const wasEverUnlocked = state.wasEverUnlocked.has(badge.id);
      await supabase.from('user_badges').upsert({
        user_id: state.user.id,
        badge_id: badge.id,
        success: false,
        level: level0,
        user_answer: rawAnswer || null,
        was_ever_unlocked: wasEverUnlocked,
      });
    }
    state.userBadges.delete(badge.id);
    state.userBadgeLevels.set(badge.id, level0); // Stocker le niveau 0
    state.userBadgeAnswers.set(badge.id, rawAnswer);
    state.attemptedBadges.add(badge.id);
    
    // Stocker l'ID du badge qui a échoué pour afficher le message dans renderAllBadges()
    state.failedBadgeId = badge.id;
    
    // Faire disparaître le message après 4 secondes
    setTimeout(() => {
      state.failedBadgeId = null;
      render();
    }, 4000);
    
    await updateCounters(false);
    await syncGhostBadges();
    render();
    return;
  }

  if (localMode) {
    const rows = loadLocalUserBadgeRows();
    const others = rows.filter(r => r.badge_id !== badge.id);
    const updated = [...others, { badge_id: badge.id, success: true, level: result.level || null, user_answer: rawAnswer }];
    saveLocalUserBadgeRows(updated);
  } else {
    const { error } = await supabase.from('user_badges').upsert({
      user_id: state.user.id,
      badge_id: badge.id,
      success: true,
      level: result.level || null,
      user_answer: rawAnswer, // on mémorise la réponse saisie
      was_ever_unlocked: true, // Marquer comme ayant été débloqué au moins une fois
    });
    if (error) {
      feedback.textContent = 'Erreur, merci de réessayer.';
      feedback.classList.add('error');
      return;
    }
  }
  state.userBadges.add(badge.id);
  state.wasEverUnlocked.add(badge.id); // Marquer comme ayant été débloqué au moins une fois
  if (result.level) state.userBadgeLevels.set(badge.id, result.level);
  state.userBadgeAnswers.set(badge.id, rawAnswer);
  state.attemptedBadges.add(badge.id);
  await updateCounters(false);
  // Synchroniser les badges fantômes après avoir débloqué / rebloqué un badge
  await syncGhostBadges();
  feedback.textContent = result.message || 'Bravo, badge gagné !';
  feedback.classList.remove('error');
  render();
}

function isMysteryLevel(label) {
  if (typeof label !== 'string') return false;
  const lower = label.toLowerCase();
  // Compat anciennes données: "mystère/mystere/secret" + nouveau libellé "expert"
  return lower.includes('mystère') || lower.includes('mystere') || lower.includes('secret') || lower.includes('expert');
}

function formatLevelTag(unlocked, levelLabel, config) {
  const normalizeSkillText = (text) => {
    if (typeof text !== 'string') return text;
    // Remplace les anciens libellés "niv"/"niveau" par "Skill"
    // Ex: "niv 3/5" -> "Skill 3/5"
    return text
      .replace(/\bniv\b/gi, 'Skill')
      .replace(/\bniveau\b/gi, 'Skill')
      .replace(/\bniveaux\b/gi, 'Skills');
  };

  if (!unlocked) {
    // Mode Pokédex : si le badge est bloqué, on masque l'indicateur exact
    // et on affiche toujours "Skill ?/?"
    return 'À débloquer · ?/?';
  }
  
  // Niveau 0 = badge bloqué
  if (levelLabel) {
    const labelLower = String(levelLabel).toLowerCase();
    if (labelLower === 'niv 0' || labelLower === 'skill 0' || labelLower === 'niveau 0') {
      return 'Bloqué · Skill 0';
    }
  }
  
  if (isMysteryLevel(levelLabel)) return 'Débloqué · Expert';
  const pos = getLevelPosition(levelLabel, config);
  if (pos !== null) {
    // Compter le total de niveaux (incluant le niveau 0 s'il est dans la config)
    const total = getLevelCount(config);
    const hasLevel0 = config && Array.isArray(config.levels) && 
      config.levels.some(l => {
        const lbl = String(l?.label || '').toLowerCase();
        return lbl === 'niv 0' || lbl === 'skill 0' || lbl === 'niveau 0';
      });
    const displayTotal = hasLevel0 ? total : total + 1; // +1 si le niveau 0 n'est pas dans la config
    return `Débloqué · Skill ${pos}/${displayTotal}`;
  }
  const total = getLevelCount(config);
  if (total > 0) {
    return levelLabel ? normalizeSkillText(`Débloqué · ${levelLabel}`) : 'Skill débloqué';
  }
  return levelLabel ? normalizeSkillText(`Débloqué · ${levelLabel}`) : 'Skill débloqué';
}

function getLevelPosition(levelLabel, config) {
  if (!config || !levelLabel) return null;
  // Niveau 0 = badge bloqué
  const labelLower = String(levelLabel).toLowerCase();
  const isLevel0 = labelLower === 'niv 0' || labelLower === 'skill 0' || labelLower === 'niveau 0';
  if (isLevel0) {
    return 0;
  }
  if (!Array.isArray(config.levels)) return null;
  const idx = config.levels.findIndex(l => (l?.label || '').toLowerCase() === labelLower);
  if (idx >= 0) {
    // Si c'est le niveau 0 dans la liste, retourner 0, sinon idx + 1
    const foundLabel = config.levels[idx]?.label || '';
    const foundLabelLower = String(foundLabel).toLowerCase();
    if (foundLabelLower === 'niv 0' || foundLabelLower === 'skill 0' || foundLabelLower === 'niveau 0') {
      return 0;
    }
    return idx + 1;
  }
  return null;
}

function getLevelCount(config) {
  if (!config) return 0;
  if (Array.isArray(config.levels)) return config.levels.length;
  return 0;
}

function buildBadgeMaps() {
  state.badgeById = new Map(state.badges.map(b => [b.id, b]));
  state.lowSkillBadges = new Set(state.badges.filter(b => b.low_skill === true).map(b => b.id));
}

function getBadgeById(id) {
  return state.badgeById?.get(id);
}

function getSkillPointsForBadge(badgeId, levelLabel) {
  const badge = getBadgeById(badgeId);
  if (!badge) return 0;
  const config = parseConfig(badge.answer);
  
  // Niveau 0 = badge bloqué = 0 point
  const labelLower = levelLabel ? String(levelLabel).toLowerCase() : '';
  if (labelLower === 'niv 0' || labelLower === 'skill 0' || labelLower === 'niveau 0') {
    return 0;
  }
  
  // Si c'est un badge fantôme avec skillPoints défini, l'utiliser directement
  if (config?.isGhost === true && typeof config.skillPoints === 'number' && config.skillPoints > 0) {
    const basePoints = config.skillPoints;
    if (state.lowSkillBadges.has(badgeId)) {
      return -Math.abs(basePoints) * 2;
    }
    return basePoints;
  }
  
  // Chercher le niveau correspondant pour obtenir les points personnalisés
  let basePoints = 1;
  if (config && Array.isArray(config.levels) && levelLabel) {
    const level = config.levels.find(l => (l?.label || '').toLowerCase() === levelLabel.toLowerCase());
    if (level) {
      // Utiliser points personnalisé si disponible (permettre 0 pour le niveau 0)
      const isLevel0 = labelLower === 'niv 0' || labelLower === 'skill 0' || labelLower === 'niveau 0';
      if (typeof level.points === 'number' && (level.points > 0 || (level.points === 0 && isLevel0))) {
        basePoints = level.points;
      } else if (isMysteryLevel(levelLabel)) {
        basePoints = 10; // Expert = 10 points
      } else {
        // Sinon utiliser la position dans la liste
        const pos = getLevelPosition(levelLabel, config);
        basePoints = pos !== null ? pos : 1;
      }
    } else {
      // Niveau non trouvé, utiliser la logique par défaut
      const pos = getLevelPosition(levelLabel, config);
      basePoints = isMysteryLevel(levelLabel) ? 10 : (pos !== null ? pos : 1);
    }
  } else {
    // Pas de niveaux, utiliser la logique par défaut
    const pos = getLevelPosition(levelLabel, config);
    basePoints = isMysteryLevel(levelLabel) ? 10 : (pos !== null ? pos : 1);
  }

  // Low skills: on perd des points, et la valeur est x2
  // Ex: Skill 1 => -2, Skill 3 => -6, Expert => -20
  if (state.lowSkillBadges.has(badgeId)) {
    return -Math.abs(basePoints) * 2;
  }
  return basePoints;
}

function getSkillPointsForBooleanBadge(badge, userAnswer) {
  if (!badge) return 0;
  const config = parseConfig(badge.answer);
  if (!config || config.type !== 'boolean') return 0;
  
  // Si skillPoints est défini, l'utiliser
  if (typeof config.skillPoints === 'number' && config.skillPoints > 0) {
    const lower = (userAnswer || '').trim().toLowerCase();
    const trueLabels = (config.trueLabels ?? ['oui', 'yes', 'y']).map(s => s.toLowerCase());
    const isTrue = trueLabels.includes(lower);
    
    if (isTrue) {
      // Réponse "oui" : attribuer les points définis
      const isLowSkill = state.lowSkillBadges.has(badge.id);
      if (isLowSkill) {
        return -Math.abs(config.skillPoints) * 2;
      }
      return config.skillPoints;
    }
    // Réponse "non" : 0 point
    return 0;
  }
  
  // Comportement par défaut : 1 point (ou -1 pour low skill)
  const isLowSkill = state.lowSkillBadges.has(badge.id);
  return isLowSkill ? -1 : 1;
}

// Helper : calcule les points pour un badge sans niveau (fantôme, boolean, ou défaut)
function calculatePointsForBadgeWithoutLevel(badge, badgeId, userAnswer) {
  if (!badge) return 0;
  const config = parseConfig(badge.answer);
  if (!config) return 0;
  
  const hasLevels = config && Array.isArray(config.levels) && config.levels.length > 0;
  if (hasLevels) return 0; // Ce badge a des niveaux, ne pas utiliser cette fonction
  
  // Badge fantôme avec skillPoints défini
  if (config?.isGhost === true && typeof config.skillPoints === 'number' && config.skillPoints > 0) {
    const isLowSkill = state.lowSkillBadges.has(badgeId);
    return isLowSkill ? -Math.abs(config.skillPoints) * 2 : config.skillPoints;
  }
  
  // Badge boolean
  if (config.type === 'boolean') {
    return getSkillPointsForBooleanBadge(badge, userAnswer);
  }
  
  // Comportement par défaut : 1 point (ou -1 pour low skill)
  const isLowSkill = state.lowSkillBadges.has(badgeId);
  return isLowSkill ? -1 : 1;
}

// Helper : formate le texte du rang (ex: "Vie de Rêve" ou "Vie Classique")
function formatRankText(rankName) {
  return rankName === 'Rêve' ? `Vie de ${rankName}` : `Vie ${rankName}`;
}

function parseConfig(answer) {
  try {
    return JSON.parse(answer ?? '');
  } catch (_) {
    return null;
  }
}

function evaluateBadgeAnswer(badge, rawAnswer, selectedOptions = []) {
  const lower = rawAnswer.trim().toLowerCase();
  const config = parseConfig(badge.answer);
  const isLecteurBadge = badge && typeof badge.name === 'string' && badge.name.toLowerCase().includes('lecteur');

  if (config && config.type === 'multiSelect') {
    const count = Array.isArray(selectedOptions) ? selectedOptions.length : 0;
    if (!count) {
      return { ok: false, message: 'Choisis au moins une option.' };
    }

    // Règle "bloquer" et "aucun" valable pour TOUS les multi-select (même si skills par option est désactivé)
    // Format admin : "valeur|bloquer" ou "valeur|aucun" (ou "valeur|" en compat)
    if (config.optionSkills && typeof config.optionSkills === 'object') {
      for (const val of selectedOptions) {
        const key = String(val);
        const hasKey = Object.prototype.hasOwnProperty.call(config.optionSkills, key);
        if (!hasKey) continue;
        const lbl = (config.optionSkills[key] ?? '').toString().trim();
        if (!lbl || lbl.toLowerCase() === 'bloquer' || lbl.toLowerCase() === 'aucun') {
          return { ok: false, message: 'Ce choix ne permet pas de débloquer ce badge.' };
        }
      }
    }

    // Mode 1 (nouveau) : le niveau dépend des options cochées
    if (config.multiSkillMode === 'option' && config.optionSkills && typeof config.optionSkills === 'object') {
      // Si une option est configurée comme "bloquante" (ex: "Choix |" => skill vide),
      // alors le badge reste bloqué si l'utilisateur la sélectionne.
      for (const val of selectedOptions) {
        const key = String(val);
        const hasKey = Object.prototype.hasOwnProperty.call(config.optionSkills, key);
        if (!hasKey) continue;
        const lbl = (config.optionSkills[key] ?? '').toString().trim();
        // Nouveau format : "valeur|bloquer"
        if (lbl.toLowerCase() === 'bloquer') return { ok: false, message: 'Ce choix ne permet pas de débloquer ce badge.' };
        // Compat : si vide après "|" on considère aussi que c'est bloquant
        if (!lbl) return { ok: false, message: 'Ce choix ne permet pas de débloquer ce badge.' };
      }

      const levels = Array.isArray(config.levels) ? config.levels.map(l => l?.label).filter(Boolean) : [];
      // Créer une map label -> position, en gérant le niveau 0
      const labelToPos = new Map();
      levels.forEach((lbl, idx) => {
        const labelLower = String(lbl).toLowerCase();
        // Niveau 0 = position 0
        if (labelLower === 'niv 0' || labelLower === 'skill 0' || labelLower === 'niveau 0') {
          labelToPos.set(String(lbl), 0);
        } else {
          labelToPos.set(String(lbl), idx + 1);
        }
      });
      let bestLabel = null;
      let bestPos = -1;
      selectedOptions.forEach(val => {
        const raw = config.optionSkills[String(val)];
        const lbl = (raw ?? '').toString().trim();
        if (!lbl) return;
        // Ignorer "aucun" dans le calcul du meilleur skill
        if (lbl.toLowerCase() === 'aucun') return;
        if (isMysteryLevel(lbl)) {
          bestLabel = 'Expert';
          bestPos = Number.POSITIVE_INFINITY;
          return;
        }
        // Vérifier si c'est le niveau 0
        const labelLower = lbl.toLowerCase();
        if (labelLower === 'niv 0' || labelLower === 'skill 0' || labelLower === 'niveau 0') {
          bestLabel = lbl;
          bestPos = 0;
          return;
        }
        const pos = labelToPos.get(lbl) ?? getLevelPosition(lbl, config) ?? -1;
        if (pos > bestPos) {
          bestPos = pos;
          bestLabel = lbl;
        }
      });
      
      // Si toutes les options sélectionnées sont "aucun" ou n'ont pas de skill, bloquer le badge
      if (!bestLabel) {
        return { ok: false, message: 'Aucun skill valide sélectionné. Le badge ne peut pas être débloqué.' };
      }
      
      const storedLabel = bestLabel ? (isMysteryLevel(bestLabel) ? 'Expert' : bestLabel) : null;
      return { ok: true, level: storedLabel, message: 'Bravo, badge débloqué !' };
    }

    // Mode 2 (ancien) : le niveau dépend du nombre de coches
    const levels = Array.isArray(config.levels) ? [...config.levels] : [];
    levels.sort((a, b) => (b.min ?? 0) - (a.min ?? 0));
    const level = levels.find(l => count >= (l.min ?? 0));
    // Si aucune règle ne correspond (ex: Skill 1 min=2 mais l'utilisateur n'a coché que 1),
    // alors on bloque le badge.
    if (!level) {
      const minNeeded = Math.min(...levels.map(l => Number(l.min)).filter(n => !Number.isNaN(n)));
      if (Number.isFinite(minNeeded) && count < minNeeded) {
        return { ok: false, message: `Il faut au moins ${minNeeded} choix pour débloquer ce badge.` };
      }
      return { ok: false, message: 'Pas assez de choix pour débloquer ce badge.' };
    }
    const maxLevel = levels.length ? levels[0] : null;
    const levelLabel = level?.label ?? null;
    const isMax = maxLevel && levelLabel === maxLevel.label;
    const finalLabel = (isLecteurBadge && isMax) ? 'Skill max'
      : (isMax && !isMysteryLevel(levelLabel) ? 'Skill max' : levelLabel);
    const storedLabel = isMysteryLevel(finalLabel) ? 'Expert' : finalLabel;
    return { ok: true, level: storedLabel, message: 'Bravo, badge débloqué !' };
  }

  if (config && config.type === 'singleSelect') {
    const value = (rawAnswer || '').trim();
    if (!value) return { ok: false, message: 'Choisis une option.' };
    const options = Array.isArray(config.options) ? config.options : [];
    const isValid = options.some(o => String(o.value) === String(value));
    if (!isValid) return { ok: false, message: 'Option invalide.' };
    const skillLabelRaw = (config.optionSkills && typeof config.optionSkills === 'object')
      ? config.optionSkills[String(value)]
      : null;
    const skillLabel = (skillLabelRaw ?? '').toString().trim();
    // Si l'admin a mis "Option |" (rien après le "|"), on bloque le badge.
    if (config.optionSkills && typeof config.optionSkills === 'object') {
      const key = String(value);
      const hasKey = Object.prototype.hasOwnProperty.call(config.optionSkills, key);
      if (hasKey) {
        // Nouveau format : "valeur|bloquer"
        if (skillLabel.toLowerCase() === 'bloquer') return { ok: false, message: 'Ce choix ne permet pas de débloquer ce badge.' };
        // "aucun" => pas de skill, bloque le badge
        if (skillLabel.toLowerCase() === 'aucun') return { ok: false, message: 'Ce choix ne permet pas de débloquer ce badge.' };
        // Compat : si vide après "|" on considère aussi que c'est bloquant
        if (!skillLabel) return { ok: false, message: 'Ce choix ne permet pas de débloquer ce badge.' };
      } else {
        // Si l'option n'est pas dans optionSkills, elle n'a pas de skill => bloque
        return { ok: false, message: 'Ce choix ne permet pas de débloquer ce badge.' };
      }
    } else {
      // Si optionSkills n'existe pas, le badge n'a pas de skills => peut être débloqué sans skill
    }
    const storedLabel = skillLabel ? (isMysteryLevel(skillLabel) ? 'Expert' : skillLabel) : null;
    return { ok: true, level: storedLabel, message: 'Bravo, badge débloqué !' };
  }

  if (config && config.type === 'range' && Array.isArray(config.levels)) {
    const value = Number(rawAnswer);
    if (Number.isNaN(value)) {
      return { ok: false, message: 'Merci de saisir un nombre.' };
    }
    const level = config.levels.find(l => value >= (l.min ?? -Infinity) && value <= (l.max ?? Infinity));
    if (!level) {
      return { ok: false, message: 'Valeur hors des skills.' };
    }
    const maxLevel = config.levels[config.levels.length - 1];
    const isMax = level === maxLevel;
    const finalLabel = (isLecteurBadge && isMax) ? 'Skill max'
      : ((isMax && !isMysteryLevel(level.label)) ? 'Skill max' : level.label);
    const storedLabel = isMysteryLevel(finalLabel) ? 'Expert' : finalLabel;
    return { ok: true, level: storedLabel, message: `Bravo, skill obtenu : ${storedLabel}` };
  }

  if (config && config.type === 'boolean') {
    const trueLabels = (config.trueLabels ?? ['oui', 'yes', 'y']).map(s => s.toLowerCase());
    const falseLabels = (config.falseLabels ?? ['non', 'no', 'n']).map(s => s.toLowerCase());
    const isTrue = trueLabels.includes(lower);
    const isFalse = falseLabels.includes(lower);
    if (!isTrue && !isFalse) {
      return { ok: false, message: 'Réponds par oui ou non.' };
    }
    const expected = config.expected !== false;
    if (isTrue === expected) {
      return { ok: true, level: null, message: 'Bravo, badge débloqué !' };
    }
    return { ok: false, message: 'Réponse incorrecte.' };
  }

  const expected = (badge.answer ?? '').trim().toLowerCase();
  if (lower === expected && expected.length) {
    return { ok: true, level: null, message: 'Bravo, badge débloqué !' };
  }
  return { ok: false, message: 'Mauvaise réponse, réessaie.' };
}

// Formate l'affichage de la réponse utilisateur, avec un suffixe ou un template optionnel par badge.
// Si aucun template n'est fourni, on affiche simplement la valeur.
function formatUserAnswer(badge, answer) {
  const config = parseConfig(badge.answer);
  const suffix = config?.displaySuffix;     // ex: "pays visités"
  const prefix = config?.displayPrefix;     // texte avant
  // On ne transforme plus la réponse selon le nom/question du badge.
  // (Plus de "cas spéciaux" : l’admin contrôle via "Texte réponse" si besoin.)
  
  // Badges fantômes : en communauté aussi, on affiche le texte fantôme (car pas de réponse utilisateur)
  if (isGhostBadge(badge) && typeof config?.ghostDisplayText === 'string' && config.ghostDisplayText.trim()) {
    return config.ghostDisplayText.trim();
  }

  // Si l'admin a défini un texte "remplacement" pour Oui/Non, on l'affiche directement.
  if (config?.type === 'boolean') {
    const trueLabels = (config.trueLabels ?? ['oui', 'yes', 'y']).map(s => s.toLowerCase());
    const answerLower = String(answer).toLowerCase().trim();
    const isTrue = trueLabels.includes(answerLower);
    
    if (isTrue && typeof config?.booleanDisplayText === 'string' && config.booleanDisplayText.trim()) {
    return config.booleanDisplayText.trim();
    }
    if (!isTrue && typeof config?.booleanDisplayTextFalse === 'string' && config.booleanDisplayTextFalse.trim()) {
      return config.booleanDisplayTextFalse.trim();
    }
  }

  // Helper: applique "avant/après" si défini
  const wrap = (value) => {
    const v = (value ?? '').toString();
    if (!v) return v;
    const pre = (typeof prefix === 'string' && prefix.trim()) ? prefix.trim() : '';
    const suf = (typeof suffix === 'string' && suffix.trim()) ? suffix.trim() : '';
    return `${pre ? pre + ' ' : ''}${v}${suf ? ' ' + suf : ''}`.trim();
  };

  if (config?.type === 'multiSelect') {
    // Pour les badges multiSelect:
    // - mode "count" (défaut) : afficher uniquement le nombre
    // - mode "list" : afficher la liste des choix cochés
    if (answer && typeof answer === 'string') {
      const rawValues = answer.split(',').map(v => v.trim()).filter(Boolean);
      const mode = config?.multiDisplayMode === 'list' ? 'list' : 'count';
      if (mode === 'list') {
        const options = Array.isArray(config?.options) ? config.options : [];
        const labelByValue = new Map(options.map(o => [String(o.value), String(o.label || o.value)]));
        const labels = rawValues.map(v => labelByValue.get(String(v)) || v);
        // On affiche une liste simple, séparée par virgules
        return wrap(labels.join(', '));
      }
      const selectedCount = rawValues.length;
      return wrap(`${selectedCount}`);
    }
    return wrap('0');
  }
  if (config?.type === 'singleSelect') {
    const value = (answer ?? '').toString().trim();
    const options = Array.isArray(config?.options) ? config.options : [];
    const labelByValue = new Map(options.map(o => [String(o.value), String(o.label || o.value)]));
    const label = labelByValue.get(String(value)) || value;
    return wrap(label);
  }
  // Fallback lisible si rien n'est configuré
  return wrap(`${answer}`);
}

function getBadgeEmoji(badge) {
  if (badge.emoji && typeof badge.emoji === 'string' && badge.emoji.trim()) {
    return badge.emoji.trim();
  }
  const emojiInName = (badge.name || '').match(/\p{Extended_Pictographic}/u);
  if (emojiInName && emojiInName[0]) return emojiInName[0];
  return '🏅';
}

function stripEmojis(text) {
  if (!text) return '';
  // Supprime les caractères emoji pour ne garder que le texte
  return text.replace(/\p{Extended_Pictographic}/gu, '').trim();
}

// Gestion du panneau profil (avatar + mot de passe)
function attachProfileListeners() {
  if (!els.editProfileBtn || !els.profileForm) return;
  els.editProfileBtn.addEventListener('click', () => {
    const isHidden = els.profilePanel.classList.contains('hidden');
    els.profilePanel.classList.toggle('hidden', !isHidden);
    if (state.profile) {
      els.profileName.value = state.profile.username || '';
      updateAvatar(state.profile.avatar_url);
    }
    els.profilePassword.value = '';
    els.profileMessage.textContent = isHidden ? ' ' : '';
  });

  if (els.profileAvatar) {
    els.profileAvatar.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) {
        const previewUrl = URL.createObjectURL(file);
        els.avatarPreviewImg.src = previewUrl;
      } else if (state.profile?.avatar_url) {
        els.avatarPreviewImg.src = state.profile.avatar_url;
      } else {
        els.avatarPreviewImg.src = './icons/logobl.png';
      }
    });
  }

  els.profileForm.addEventListener('submit', handleProfileUpdate);
}

async function handleProfileUpdate(e) {
  e.preventDefault();
  if (!state.user) return setProfileMessage('Connecte-toi pour modifier ton profil.', true);

  const newPassword = els.profilePassword.value.trim();
  const avatarFile = els.profileAvatar?.files?.[0];
  let avatarUrl = state.profile?.avatar_url || null;

  // Upload avatar si fourni
  if (avatarFile) {
    // Optionnel : validation de taille (plafond porté à ~10 Mo)
    const MAX_AVATAR_BYTES = 10 * 1024 * 1024;
    if (avatarFile.size > MAX_AVATAR_BYTES) {
      return setProfileMessage('Image trop lourde (max ~10 Mo).', true);
    }

    const path = `${state.user.id}/${Date.now()}-${avatarFile.name}`;
    const { error: uploadError } = await supabase.storage.from(AVATAR_BUCKET).upload(path, avatarFile, {
      cacheControl: '3600',
      upsert: true,
      contentType: avatarFile.type || 'image/jpeg',
    });
    if (uploadError) {
      // Message plus explicite pour diagnostiquer (bucket manquant, droits, etc.)
      return setProfileMessage(`Échec du téléversement : ${uploadError.message}`, true);
    }
    const { data: publicData } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
    avatarUrl = publicData?.publicUrl || avatarUrl;
  }

  // Mise à jour du mot de passe si renseigné
  if (newPassword) {
    if (newPassword.length < 6) {
      return setProfileMessage('Mot de passe : 6 caractères minimum.', true);
    }
    const { error: pwError } = await supabase.auth.updateUser({ password: newPassword });
    if (pwError) {
      return setProfileMessage(`Échec de mise à jour du mot de passe : ${pwError.message}`, true);
    }
  }

  // Mise à jour du profil (avatar)
  const { error: profileError } = await supabase.from('profiles').upsert({
    id: state.user.id,
    username: state.profile?.username || 'Utilisateur',
    badge_count: state.profile?.badge_count ?? 0,
    avatar_url: avatarUrl,
  });
  if (profileError) {
    return setProfileMessage(`Échec de mise à jour du profil : ${profileError.message}`, true);
  }

  // Mise à jour du state + UI
  if (state.profile) {
    state.profile.avatar_url = avatarUrl;
  }
  updateAvatar(avatarUrl);
  els.profileAvatar.value = '';
  els.profilePassword.value = '';
  setProfileMessage('Profil mis à jour.', false);
  // Ferme le panneau profil après enregistrement réussi
  if (els.profilePanel) {
    els.profilePanel.classList.add('hidden');
  }
  await fetchCommunity(); // rafraîchit l’onglet communauté pour afficher l’avatar
}

function setProfileMessage(text, isError = false) {
  if (!els.profileMessage) return;
  els.profileMessage.textContent = text;
  els.profileMessage.classList.toggle('error', isError);
}

function updateAvatar(url) {
  const finalUrl = url || './icons/logobl.png';
  if (els.avatarImg) {
    els.avatarImg.src = finalUrl;
    els.avatarImg.style.objectFit = 'cover';
    els.avatarImg.style.borderRadius = '50%';
  }
  if (els.avatarPreviewImg) {
    els.avatarPreviewImg.src = finalUrl;
  }
}

// Affichage profil communauté (modal)
function showCommunityProfile(data) {
  if (!els.communityProfileModal) return;
  els.communityProfileAvatar.src = data.avatar || './icons/logobl.png';
  
  // Mettre à jour le nom d'utilisateur (le texte dans le span)
  const usernameText = data.username || 'Utilisateur';
  const usernameSpan = els.communityProfileUsername.querySelector('span:last-child');
  if (usernameSpan) {
    usernameSpan.textContent = usernameText;
  }
  
  const rankMeta = getRankMeta(data.skillPoints || 0);
  applyRankToElement(els.communityProfileUsername, rankMeta);
  
  // Mettre à jour l'indicateur de confidentialité
  const isPrivate = data.isPrivate === 'true' || data.isPrivate === true;
  const indicator = document.getElementById('community-profile-privacy-indicator');
  if (indicator) {
    indicator.textContent = isPrivate ? 'compte privé' : 'compte publique';
    indicator.style.display = 'inline-block'; // S'assurer qu'il est visible
  }
  
  if (els.communityProfileRank) {
    // Utiliser le rang stocké ou calculer depuis les points
    const displayRank = data.rank || rankMeta.name;
    els.communityProfileRank.textContent = formatRankText(displayRank);
    applyRankColor(els.communityProfileRank, rankMeta);
  }
  els.communityProfileBadges.textContent = `${data.badges || 0} badge(s)`;
  els.communityProfileMystery.textContent = `${data.skills || 0} skill(s)`;
  renderCommunityProfileBadges([], isPrivate);
  els.communityProfileModal.classList.remove('hidden');
  if (data.userId) {
    fetchCommunityUserStats(data.userId, isPrivate);
  }
}

function hideCommunityProfile() {
  if (!els.communityProfileModal) return;
  els.communityProfileModal.classList.add('hidden');
}

// Fermer modal communauté
document.addEventListener('click', (e) => {
  if (e.target === els.communityProfileModal) {
    hideCommunityProfile();
  }
});
document.addEventListener('DOMContentLoaded', () => {
  if (els.communityProfileClose) {
    els.communityProfileClose.addEventListener('click', hideCommunityProfile);
  }
});

// Stats supplémentaires pour un profil communauté
async function fetchCommunityUserStats(userId, isPrivate = false) {
  try {
    const rows = await fetchPublicUserBadges(userId);
    if (!rows || !rows.length) {
      renderCommunityProfileBadges([], isPrivate);
      return;
    }
    let unlocked = rows.filter(r => r.success !== false);
    
    // Calculer les points de skills et créer un Set des badges débloqués
    // (nécessaire pour vérifier les conditions des badges fantômes)
    let totalSkills = 0;
    const badgesWithLevels = new Set();
    const userBadgeIds = new Set();
    
    unlocked.forEach(row => {
      if (row.badge_id) {
        userBadgeIds.add(row.badge_id);
        if (row.level) {
          totalSkills += getSkillPointsForBadge(row.badge_id, row.level);
          badgesWithLevels.add(row.badge_id);
        }
      }
    });
    
    // Ajouter les points pour les badges débloqués sans niveau
    unlocked.forEach(row => {
      if (row.badge_id && !badgesWithLevels.has(row.badge_id)) {
        const badge = state.badges.find(b => b.id === row.badge_id);
        if (badge) {
          totalSkills += calculatePointsForBadgeWithoutLevel(badge, row.badge_id, row.user_answer);
        }
      }
    });
    
    // Filtrer les badges fantômes qui ne remplissent plus leurs conditions
    // (badges fantômes qui ont été rebloqués)
    unlocked = unlocked.filter(row => {
      if (!row.badge_id) return false;
      const badge = state.badges.find(b => b.id === row.badge_id);
      if (!badge || !isGhostBadge(badge)) return true; // Garder les badges non-fantômes
      
      // Vérifier si le badge fantôme devrait toujours être débloqué
      const shouldBeUnlocked = checkGhostBadgeConditionsForUser(badge, userBadgeIds, totalSkills);
      return shouldBeUnlocked;
    });
    
    // Recalculer les points et le nombre de badges après filtrage
    totalSkills = 0;
    badgesWithLevels.clear();
    const filteredBadgeIds = new Set();
    
    unlocked.forEach(row => {
      if (row.badge_id) {
        filteredBadgeIds.add(row.badge_id);
        if (row.level) {
          totalSkills += getSkillPointsForBadge(row.badge_id, row.level);
          badgesWithLevels.add(row.badge_id);
        }
      }
    });
    
    unlocked.forEach(row => {
      if (row.badge_id && !badgesWithLevels.has(row.badge_id)) {
        const badge = state.badges.find(b => b.id === row.badge_id);
        if (badge) {
          totalSkills += calculatePointsForBadgeWithoutLevel(badge, row.badge_id, row.user_answer);
        }
      }
    });
    
    const badgeCount = unlocked.length;
    els.communityProfileBadges.textContent = `${badgeCount} badge(s)`;
    els.communityProfileMystery.textContent = `${totalSkills} skill(s)`;
    renderCommunityProfileBadges(unlocked, isPrivate);
  } catch (_) {
    renderCommunityProfileBadges([], isPrivate);
  }
}

async function fetchPublicUserBadges(userId) {
  // Essaye d’abord une vue publique, sinon retombe sur user_badges
  const sources = [
    { table: 'public_user_badges_min', fields: 'badge_id,level,success,user_answer' },
    { table: 'user_badges', fields: 'badge_id,level,success,user_answer' },
  ];
  for (const src of sources) {
    const { data, error } = await supabase
      .from(src.table)
      .select(src.fields)
      .eq('user_id', userId);
    if (!error) return data ?? [];
  }
  return [];
}

// Rendre les badges du profil communautaire comme dans "Mes badges"
function renderCommunityProfileBadges(unlockedBadges, isPrivate = false) {
  if (!els.communityProfileBadgesList) return;
  
  // Créer des Maps et Sets pour les badges de l'utilisateur communautaire
  const communityUserBadges = new Set();
  const communityUserBadgeLevels = new Map();
  const communityUserBadgeAnswers = new Map();
  const communityWasEverUnlocked = new Set();
  
  if (unlockedBadges && unlockedBadges.length > 0) {
    unlockedBadges.forEach(row => {
      if (row.badge_id) {
        communityUserBadges.add(row.badge_id);
        if (row.level) {
          communityUserBadgeLevels.set(row.badge_id, row.level);
        }
        if (row.user_answer) {
          communityUserBadgeAnswers.set(row.badge_id, row.user_answer);
        }
        // Si le badge est débloqué (success !== false), il a été débloqué au moins une fois
        if (row.success !== false) {
          communityWasEverUnlocked.add(row.badge_id);
        }
      }
    });
  }
  
  // Filtrer les badges fantômes
  const visibleBadges = state.badges.slice();
  if (!visibleBadges.length) {
    els.communityProfileBadgesList.innerHTML = '<p class="muted">Aucun badge pour le moment.</p>';
    return;
  }

  els.communityProfileBadgesList.classList.remove('list-mode');
  els.communityProfileBadgesList.classList.add('my-badges-catalog');
  els.communityProfileBadgesList.innerHTML = '';
  
  // Regrouper par thème
  const themeName = (b) => (b.theme && String(b.theme).trim()) ? String(b.theme).trim() : 'Autres';
  const groups = new Map();
  visibleBadges.forEach(b => {
    const t = themeName(b);
    if (!groups.has(t)) groups.set(t, []);
    groups.get(t).push(b);
  });
  const themes = Array.from(groups.keys()).sort(compareThemesFixed);
  const sortById = (a, b) => String(a.id).localeCompare(String(b.id), 'fr', { numeric: true, sensitivity: 'base' });

  themes.forEach((t) => {
    const title = document.createElement('div');
    title.className = 'section-subtitle theme-title';
    const hasAnyUnlockedInTheme = (groups.get(t) || []).some(b => communityUserBadges.has(b.id));
    if (!hasAnyUnlockedInTheme) {
      title.classList.add('theme-locked');
      title.textContent = '?????';
      title.dataset.theme = t;
    } else {
      title.textContent = t;
    }
    els.communityProfileBadgesList.appendChild(title);

    groups.get(t).sort(sortById).forEach(badge => {
      const unlocked = communityUserBadges.has(badge.id);
      const levelLabel = communityUserBadgeLevels.get(badge.id);
      const config = parseConfig(badge.answer);
      const userAnswer = communityUserBadgeAnswers.get(badge.id);
      const hasAnswer = userAnswer !== undefined && userAnswer !== null;
      const wasEverUnlocked = communityWasEverUnlocked.has(badge.id);
      const isBlocked = !unlocked && hasAnswer;
      const isReblocked = isBlocked && wasEverUnlocked;
      const isBlockedNeverUnlocked = isBlocked && !wasEverUnlocked;

      const card = document.createElement('article');
      card.className = `card-badge clickable compact all-badge-card my-catalog-card${unlocked ? '' : ' locked'}${isBlocked ? ' blocked' : ''}${isReblocked ? ' reblocked' : ''}`;

      const safeEmoji = unlocked || isReblocked ? getBadgeEmoji(badge) : '❓';
      const safeTitle = unlocked || isReblocked ? stripEmojis(badge.name || '') : '?????';

      let statusLabel;
      let statusClass;
      
      if (unlocked) {
        statusLabel = formatLevelTag(unlocked, levelLabel, config);
        statusClass = isMysteryLevel(levelLabel) ? 'mystery' : 'success';
      } else if (isReblocked) {
        statusLabel = 'Rebloqué';
        statusClass = 'reblocked';
      } else if (isBlocked) {
        statusLabel = 'Bloqué';
        statusClass = 'blocked';
      } else {
        statusLabel = 'À débloquer';
        statusClass = 'locked';
      }
      const isExpert = unlocked && isMysteryLevel(levelLabel);
      
      if (isExpert) {
        card.classList.add('expert-badge');
      }

      const formattedAnswer = unlocked && userAnswer ? formatUserAnswer(badge, userAnswer) : null;
      const ghostText = unlocked && isGhostBadge(badge) ? (config?.ghostDisplayText || 'Débloqué automatiquement') : null;
      const displayText = formattedAnswer || ghostText || (isBlocked && userAnswer ? formatUserAnswer(badge, userAnswer) : null) || (unlocked ? '' : 'Badge non débloqué');

      card.innerHTML = `
        <div class="row level-row">
          <span class="tag ${statusClass}">${statusLabel}</span>
        </div>
        <div class="badge-compact">
          <div class="badge-emoji">${safeEmoji}</div>
          <div class="badge-title">${safeTitle}</div>
        </div>
        <div class="all-badge-details hidden">
          <p class="muted">${displayText || ''}</p>
        </div>
      `;

      const details = card.querySelector('.all-badge-details');
      card.addEventListener('click', (e) => {
        const tag = e.target.tagName.toLowerCase();
        if (tag === 'input' || tag === 'button' || e.target.closest('form')) return;
        
        // Fermer tous les autres badges
        const allCards = els.communityProfileBadgesList.querySelectorAll('.my-catalog-card');
        allCards.forEach(otherCard => {
          if (otherCard !== card) {
            const otherDetails = otherCard.querySelector('.all-badge-details');
            if (otherDetails) {
              otherDetails.classList.add('hidden');
              otherCard.classList.remove('expanded');
            }
          }
        });
        
        // Ouvrir/fermer le badge cliqué
        details.classList.toggle('hidden');
        card.classList.toggle('expanded');
      });

      els.communityProfileBadgesList.appendChild(card);
    });
  });
}

function renderCommunityBadgeGridMessage(msg) {
  if (!els.communityProfileBadgesList) return;
  els.communityProfileBadgesList.innerHTML = `<p class="muted grid-full-center">${msg}</p>`;
}

function toggleViews(authenticated) {
  els.authView.classList.toggle('hidden', authenticated);
  els.appView.classList.toggle('hidden', !authenticated);
}

function toggleAdminLink(show) {
  if (!els.adminLink) return;
  if (show) {
    els.adminLink.classList.remove('hidden');
  } else {
    els.adminLink.classList.add('hidden');
  }
}

function isAdminUser(user) {
  if (!user || !user.id) return false;
  return Array.isArray(ADMIN_USER_IDS) && ADMIN_USER_IDS.includes(user.id);
}

function setMessage(text, isError = false) {
  els.authMessage.textContent = text;
  els.authMessage.classList.toggle('error', isError);
}

async function updateCounters(syncProfile = false) {
  // Calculer d'abord les points pour tous les badges (nécessaire pour vérifier les conditions des badges fantômes)
  let tempSkillPoints = 0;
  state.userBadgeLevels.forEach((lvl, badgeId) => {
    tempSkillPoints += getSkillPointsForBadge(badgeId, lvl);
  });
  state.userBadges.forEach(badgeId => {
    if (!state.userBadgeLevels.has(badgeId)) {
      const badge = getBadgeById(badgeId);
      if (badge) {
        const userAnswer = state.userBadgeAnswers.get(badgeId);
        tempSkillPoints += calculatePointsForBadgeWithoutLevel(badge, badgeId, userAnswer);
      }
    }
  });
  
  // Filtrer les badges fantômes rebloqués (sécurité supplémentaire)
  // Normalement syncGhostBadges() les supprime déjà, mais on vérifie quand même
  const validBadgeIds = new Set();
  state.userBadges.forEach(badgeId => {
    const badge = getBadgeById(badgeId);
    if (!badge) {
      validBadgeIds.add(badgeId);
      return;
    }
    
    // Si c'est un badge fantôme, vérifier qu'il devrait toujours être débloqué
    if (isGhostBadge(badge)) {
      const shouldBeUnlocked = checkGhostBadgeConditionsForUser(badge, state.userBadges, tempSkillPoints);
      if (shouldBeUnlocked) {
        validBadgeIds.add(badgeId);
      }
      // Sinon, on ne l'ajoute pas (il devrait être supprimé par syncGhostBadges)
    } else {
      // Badge normal, on le garde
      validBadgeIds.add(badgeId);
    }
  });
  
  // Recalculer les points en excluant les badges fantômes rebloqués
  const badgeCount = validBadgeIds.size;
  
  // Calculer le nombre total de badges :
  // - Tous les badges normaux (non-fantômes) comptent toujours
  // - Les badges fantômes ne comptent que s'ils sont débloqués
  let totalBadges = 0;
  const allBadges = state.badges || [];
  allBadges.forEach(badge => {
    if (!isGhostBadge(badge)) {
      // Badge normal : toujours compté
      totalBadges++;
    } else {
      // Badge fantôme : compté seulement s'il est débloqué
      if (validBadgeIds.has(badge.id)) {
        totalBadges++;
      }
    }
  });
  
  let totalSkillPoints = 0;
  
  // Compter les points pour les badges avec niveaux
  state.userBadgeLevels.forEach((lvl, badgeId) => {
    if (validBadgeIds.has(badgeId)) {
      totalSkillPoints += getSkillPointsForBadge(badgeId, lvl);
    }
  });
  
  // Compter les points pour les badges débloqués sans niveau (text, boolean, etc.)
  validBadgeIds.forEach(badgeId => {
    // Si le badge n'a pas de niveau défini, c'est un badge sans niveau
    if (!state.userBadgeLevels.has(badgeId)) {
      const badge = getBadgeById(badgeId);
      if (badge) {
            const userAnswer = state.userBadgeAnswers.get(badgeId);
        totalSkillPoints += calculatePointsForBadgeWithoutLevel(badge, badgeId, userAnswer);
      }
    }
  });
  
  if (els.badgeCount) {
    els.badgeCount.innerHTML = `${badgeCount} <span class="badge-total">/ ${totalBadges}</span>`;
  }
  if (els.skillCount) els.skillCount.textContent = `${totalSkillPoints}`;
  state.currentSkillPoints = totalSkillPoints;
  
  // Rang + style du pseudo
  const rankMeta = getRankMeta(totalSkillPoints);
  if (els.profileRank) {
    els.profileRank.textContent = formatRankText(rankMeta.name);
    applyRankColor(els.profileRank, rankMeta);
  }
  applyRankToElement(els.profileUsername, rankMeta);

  if (state.profile) {
    state.profile.badge_count = badgeCount;
    state.profile.skill_points = totalSkillPoints;
    state.profile.rank = rankMeta.name;
    if (syncProfile) {
      await supabase
        .from('profiles')
        .update({ badge_count: badgeCount, skill_points: totalSkillPoints, rank: rankMeta.name })
        .eq('id', state.user.id);
    }
  }
}

