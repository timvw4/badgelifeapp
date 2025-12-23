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
  isRetryBadge: false, // Flag pour indiquer si on rerépond à un badge bloqué
  retryBadgeId: null, // ID du badge en retry
  badgesFromWheel: new Set(), // IDs des badges qui proviennent de la roue
  connectionDays: [], // Array des dates de connexion de la semaine
  weekStartDate: null, // Date du lundi de la semaine en cours
  canClaimBonus: false, // Si les 3 jetons bonus sont disponibles (non réclamés)
  claimedDailyTokens: [], // Array des dates où les jetons journaliers ont été récupérés
  weekBonusClaimed: false, // Si le bonus hebdomadaire a été récupéré cette semaine
  badgeQuestionAnswered: false, // Flag pour indiquer si une réponse a été donnée au badge de la roue
  wheelBadgeIds: null, // Signature des badges dans la roue (pour éviter de remélanger inutilement)
  wheelOrder: [], // Ordre des éléments dans la roue
};

const els = {};

// Ordre fixe des thèmes (utilisé pour le catalogue "Mes badges")
// Tout thème inconnu sera affiché après ceux-ci (ordre alphabétique).
const THEME_ORDER = [
  'Sport',
  'Voyage',
  'Pays',
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

// Fonction pour ouvrir le drawer de profil
function openProfileDrawer() {
  if (!els.profilePanel || !els.profileOverlay) return;
  els.profilePanel.classList.remove('hidden');
  els.profileOverlay.classList.remove('hidden');
  if (state.profile) {
    if (els.profileName) els.profileName.value = state.profile.username || '';
    updateAvatar(state.profile.avatar_url);
  }
  if (els.profilePassword) els.profilePassword.value = '';
  if (els.profileMessage) els.profileMessage.textContent = ' ';
}

// Fonction pour fermer le drawer de profil
function closeProfileDrawer() {
  if (!els.profilePanel || !els.profileOverlay) return;
  els.profilePanel.classList.add('hidden');
  els.profileOverlay.classList.add('hidden');
  // Fermer l'infobulle si elle est ouverte
  if (els.profileNameTooltip) {
    els.profileNameTooltip.classList.add('hidden');
  }
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
  attachCommunitySearchListener();
  attachCommunityTabListeners();
  attachIdeaListeners();
  attachTokensTooltip();
  attachSpinButtonTooltip();
  attachCalendarListeners();
  setupPullToRefresh();
  lockOrientation();
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
  els.logoutBtn = document.getElementById('logout-btn');
  els.editProfileBtn = document.getElementById('edit-profile-btn');
  els.profilePrivacyBtn = document.getElementById('profile-privacy-btn');
  els.profilePrivacyIndicator = document.getElementById('profile-privacy-indicator');
  els.profilePanel = document.getElementById('profile-panel');
  els.profileForm = document.getElementById('profile-form');
  els.profileCloseBtn = document.getElementById('profile-close-btn');
  els.profileOverlay = document.getElementById('profile-overlay');
  els.profileName = document.getElementById('profile-name');
  els.profilePassword = document.getElementById('profile-password');
  els.profileAvatar = document.getElementById('profile-avatar');
  els.profileMessage = document.getElementById('profile-message');
  els.profileNameTooltip = document.getElementById('profile-name-tooltip');
  els.tabButtons = document.querySelectorAll('.tab-button[data-tab]');
  els.bottomNavItems = document.querySelectorAll('.bottom-nav-item[data-tab]');
  els.tabSections = {
    'my-badges': document.getElementById('my-badges'),
    'all-badges': document.getElementById('all-badges'),
    'community': document.getElementById('community'),
  };
  // Éléments du header profil dans la section Mon profil
  els.profileSectionAvatar = document.getElementById('profile-section-avatar');
  els.profileSectionUsername = document.getElementById('profile-section-username');
  els.profileSectionBadgeCount = document.getElementById('profile-section-badge-count');
  els.profileSectionSkillCount = document.getElementById('profile-section-skill-count');
  els.profileSectionRank = document.getElementById('profile-section-rank');
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
  els.blockedBadgesSection = document.getElementById('blocked-badges-section');
  els.blockedBadgesList = document.getElementById('blocked-badges-list');
  els.tokensTooltip = document.getElementById('tokens-tooltip');
  els.spinButtonTooltip = document.getElementById('spin-button-tooltip');
  // Éléments du calendrier
  els.calendarBtn = document.getElementById('calendar-btn');
  els.calendarBadge = document.getElementById('calendar-badge');
  // Bouton calendrier déplacé dans le header (utilise calendar-btn)
  // els.calendarBtnWheel = document.getElementById('calendar-btn-wheel');
  // els.calendarBadgeWheel = document.getElementById('calendar-badge-wheel');
  els.calendarDrawer = document.getElementById('calendar-drawer');
  els.calendarOverlay = document.getElementById('calendar-overlay');
  els.calendarCloseBtn = document.getElementById('calendar-close-btn');
  els.calendarWeek = document.getElementById('calendar-week');
  els.claimBonusBtn = document.getElementById('claim-bonus-btn');
}

const RANKS = [
  { min: 0, name: 'Minimaliste', color: '#9ca3af' },    // Gris neutre
  { min: 15, name: 'Simple', color: '#a8826d' },        // Brun clair
  { min: 30, name: 'Normale', color: '#6366f1' },       // Indigo
  { min: 60, name: 'Originale', color: '#14b8a6' },     // Teal
  { min: 100, name: 'Incroyable', color: '#f59e0b' },   // Ambre
  { min: 130, name: 'Rêve', color: null, isGold: true }, // Or (texture)
];

function getRankMeta(skillPoints) {
  const pts = Number(skillPoints) || 0;
  let current = RANKS[0];
  RANKS.forEach(r => {
    if (pts >= r.min) current = r;
  });
  return { ...current, points: pts };
}


function renderRankTooltip() {
  if (!els.rankTooltip) return;
  // On montre les seuils de skills nécessaires
  els.rankTooltip.innerHTML = `
    <div class="rank-tooltip-title">Type de vie</div>
    <div class="rank-tooltip-list">
      ${RANKS.map(r => {
        const rankStyle = r.isGold ? '' : `style="color: ${r.color}"`;
        const rankClass = r.isGold ? 'rank-tooltip-rank rank-gold' : 'rank-tooltip-rank';
        return `
        <div class="rank-tooltip-row">
          <span class="${rankClass}" ${rankStyle}>${r.name}</span>
          <span class="muted">${r.min}+ skills</span>
        </div>
      `;
      }).join('')}
    </div>
  `;
}

function bindRankTooltip() {
  if (!els.rankTooltip) return;
  renderRankTooltip();

  // Attacher le tooltip au bouton du header
  if (els.profileRank) {
    els.profileRank.addEventListener('click', (e) => {
      e.stopPropagation();
      els.rankTooltip.classList.toggle('hidden');
    });
  }

  // Attacher le tooltip au bouton de la section Mon profil
  if (els.profileSectionRank) {
    els.profileSectionRank.addEventListener('click', (e) => {
      e.stopPropagation();
      els.rankTooltip.classList.toggle('hidden');
    });
  }

  document.addEventListener('click', (e) => {
    if (els.rankTooltip.classList.contains('hidden')) return;
    const clickedInside = e.target === els.rankTooltip || 
                         els.rankTooltip.contains(e.target) || 
                         e.target === els.profileRank ||
                         e.target === els.profileSectionRank;
    if (!clickedInside) els.rankTooltip.classList.add('hidden');
  });
}

// Attache l'événement pour afficher/masquer l'infobulle des jetons
function attachTokensTooltip() {
  if (!els.tokensCounter || !els.tokensTooltip) return;
  
  els.tokensCounter.addEventListener('click', (e) => {
    e.stopPropagation();
    els.tokensTooltip.classList.toggle('hidden');
  });
  
  // Fermer l'infobulle si on clique ailleurs
  document.addEventListener('click', (e) => {
    if (els.tokensTooltip && !els.tokensTooltip.classList.contains('hidden')) {
      const clickedInside = e.target === els.tokensCounter || 
                           els.tokensCounter.contains(e.target) ||
                           e.target === els.tokensTooltip ||
                           els.tokensTooltip.contains(e.target);
      if (!clickedInside) {
        els.tokensTooltip.classList.add('hidden');
      }
    }
  });
}

// Attache l'événement pour afficher/masquer l'infobulle du bouton tourner la roue
function attachSpinButtonTooltip() {
  if (!els.spinButton || !els.spinButtonTooltip) {
    console.log('attachSpinButtonTooltip - éléments non trouvés');
    console.log('spinButton:', els.spinButton);
    console.log('spinButtonTooltip:', els.spinButtonTooltip);
    return;
  }
  
  // Éviter les duplications : vérifier si les listeners sont déjà attachés
  if (els.spinButton.hasAttribute('data-tooltip-attached')) {
    return;
  }
  
  console.log('attachSpinButtonTooltip - attachement de l\'événement');
  
  // Trouver le wrapper parent (comme pour tokens-counter)
  const wrapper = els.spinButton.parentElement;
  if (!wrapper) {
    console.error('Wrapper parent non trouvé pour spin-button');
    return;
  }
  
  console.log('Wrapper trouvé:', wrapper);
  console.log('Wrapper classes:', wrapper.className);
  
  // S'assurer que le wrapper est cliquable
  wrapper.style.cursor = 'pointer';
  wrapper.style.pointerEvents = 'auto';
  
  // Créer les handlers une seule fois pour pouvoir les supprimer si nécessaire
  const handleButtonClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    // État bloqué : pas de jetons - afficher l'infobulle
    if ((state.tokens || 0) < 1) {
      if (els.spinButtonTooltip) {
        els.spinButtonTooltip.classList.remove('hidden');
      }
      return;
    }
    
    // État débloqué : avec jetons - cacher l'infobulle et lancer la roue
    if (els.spinButtonTooltip) {
      els.spinButtonTooltip.classList.add('hidden');
    }
    if (!state.isWheelSpinning) {
      handleSpinWheel();
    }
  };
  
  // Attacher l'événement directement sur le bouton pour gérer les deux états
  els.spinButton.addEventListener('click', handleButtonClick);
  
  // Utiliser la délégation d'événements sur le wrapper pour capturer les clics quand le bouton est disabled
  // Cela fonctionne même si le bouton est disabled
  const handleWrapperClick = (e) => {
    // Vérifier si le clic est sur le wrapper ou le bouton
    const clickedOnWrapper = wrapper.contains(e.target) || e.target === wrapper || e.target === els.spinButton;
    
    if (clickedOnWrapper) {
      // État bloqué : pas de jetons - afficher l'infobulle
      if ((state.tokens || 0) < 1) {
        e.preventDefault();
        e.stopPropagation();
        
        if (els.spinButtonTooltip) {
          els.spinButtonTooltip.classList.remove('hidden');
        }
      } else {
        // Si l'utilisateur a des jetons, cacher l'infobulle
        if (els.spinButtonTooltip) {
          els.spinButtonTooltip.classList.add('hidden');
        }
      }
    }
  };
  
  // Fermer l'infobulle si on clique ailleurs
  const handleCloseTooltip = (e) => {
    if (els.spinButtonTooltip && !els.spinButtonTooltip.classList.contains('hidden')) {
      const clickedInside = e.target === els.spinButton || 
                           els.spinButton.contains(e.target) ||
                           e.target === els.spinButtonTooltip ||
                           els.spinButtonTooltip.contains(e.target) ||
                           wrapper.contains(e.target);
      if (!clickedInside) {
        els.spinButtonTooltip.classList.add('hidden');
      }
    }
  };
  
  // Supprimer les anciens listeners s'ils existent (pour éviter les duplications)
  if (els.spinButton._tooltipHandlers) {
    const oldHandlers = els.spinButton._tooltipHandlers;
    document.removeEventListener('click', oldHandlers.wrapperClick, true);
    document.removeEventListener('mousedown', oldHandlers.wrapperClick, true);
    document.removeEventListener('touchstart', oldHandlers.wrapperClick, true);
    document.removeEventListener('click', oldHandlers.closeTooltip);
    if (oldHandlers.buttonClick) {
      els.spinButton.removeEventListener('click', oldHandlers.buttonClick);
    }
  }
  
  // Attacher sur le document avec capture pour intercepter quand le bouton est disabled
  document.addEventListener('click', handleWrapperClick, true);
  document.addEventListener('mousedown', handleWrapperClick, true);
  document.addEventListener('touchstart', handleWrapperClick, true);
  document.addEventListener('click', handleCloseTooltip);
  
  // Stocker les handlers pour pouvoir les supprimer si nécessaire
  els.spinButton._tooltipHandlers = {
    buttonClick: handleButtonClick,
    wrapperClick: handleWrapperClick,
    closeTooltip: handleCloseTooltip
  };
  
  // Marquer que les listeners sont attachés
  els.spinButton.setAttribute('data-tooltip-attached', 'true');
  
  console.log('attachSpinButtonTooltip - événements attachés sur document');
}

// Attache les événements pour le calendrier
function attachCalendarListeners() {
  // Bouton pour ouvrir le calendrier (dans le header)
  if (els.calendarBtn) {
    els.calendarBtn.addEventListener('click', () => {
      openCalendarDrawer();
    });
  }
  
  // Bouton pour fermer le calendrier
  if (els.calendarCloseBtn) {
    els.calendarCloseBtn.addEventListener('click', () => {
      closeCalendarDrawer();
  });
  }
  
  // Overlay pour fermer le calendrier
  if (els.calendarOverlay) {
    els.calendarOverlay.addEventListener('click', () => {
      closeCalendarDrawer();
    });
  }
  
  // Bouton pour réclamer le bonus
  if (els.claimBonusBtn) {
    els.claimBonusBtn.addEventListener('click', () => {
      handleClaimBonus();
    });
  }
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
    setMessage(''); // Effacer le message de connexion
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
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const currentWeekStart = getWeekStartDate(today);
      const currentWeekStartStr = currentWeekStart.toISOString().split('T')[0];
      
      await supabase.from('profiles').upsert({ 
        id: userId, 
        username, 
        badge_count: 0, 
        skill_points: 0, 
        rank: 'Minimaliste',
        tokens: 3,
        last_token_date: null,
        connection_days: [],
        claimed_daily_tokens: [],
        week_start_date: currentWeekStartStr,
        week_bonus_available: false,
        week_bonus_claimed: false
      });
    }
    state.session = data.session;
    state.user = data.user;
    toggleAdminLink(isAdminUser(state.user));
    setMessage(''); // Effacer le message de création
    await loadAppData();
    setupRealtimeSubscription(); // Démarrer l'écoute Realtime après l'inscription
    
    // Afficher l'infobulle pour les 3 jetons d'inscription
    showSignupTokensNotification();
  });

  els.logoutBtn.addEventListener('click', async () => {
    await supabase.auth.signOut();
    resetState();
    toggleAdminLink(false);
    toggleViews(false);
    // S'assurer que le message s'affiche dans la vue de connexion
    setMessage('Déconnecté. Connecte-toi pour continuer.');
    // Forcer le reflow pour s'assurer que les changements de classe sont appliqués
    void els.authView.offsetHeight;
  });
}

function attachNavListeners() {
  // Anciens boutons d'onglets (si présents)
  els.tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      els.tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      showTab(tab);
    });
  });
  
  // Nouveaux boutons de la barre de navigation en bas
  els.bottomNavItems.forEach(btn => {
    btn.addEventListener('click', () => {
      els.bottomNavItems.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      showTab(tab);
    });
  });
}

function showTab(tab) {
  Object.entries(els.tabSections).forEach(([key, section]) => {
    section.classList.toggle('hidden', key !== tab);
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
  // Ne garder que le point de couleur, pas le texte
  els.profilePrivacyIndicator.textContent = '';
  els.profilePrivacyIndicator.style.background = isPrivate ? '#ef4444' : '#22c55e';
  els.profilePrivacyIndicator.style.display = 'inline-block'; // S'assurer qu'il est visible
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
  state.tokens = 0;
  state.selectedBadgeFromWheel = null;
  state.isWheelSpinning = false;
  state.isRetryBadge = false;
  state.retryBadgeId = null;
  state.badgesFromWheel = new Set();
  state.selectedIsJoker = false;
  state.isModifyingBadge = false;
  state.jokerType = null;
  state.wheelBadgeIds = null;
  state.wheelOrder = [];
  // Vider les listes
  if (els.myBadgesList) els.myBadgesList.innerHTML = '';
  if (els.allBadgesList) els.allBadgesList.innerHTML = '';
  if (els.communityList) els.communityList.innerHTML = '';
  // Masquer le menu des réglages
  if (els.settingsMenu) els.settingsMenu.classList.add('hidden');
  // Masquer le panneau de profil
  if (els.profilePanel) closeProfileDrawer();
  // Masquer le modal de profil communauté
  if (els.communityProfileModal) els.communityProfileModal.classList.add('hidden');
  // Masquer le conteneur de question de badge
  if (els.badgeQuestionContainer) els.badgeQuestionContainer.classList.add('hidden');
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
  let { data, error } = await supabase.from('profiles').select('username, badge_count, avatar_url, skill_points, rank, is_private, tokens, last_token_date, connection_days, week_start_date, week_bonus_available, week_bonus_claimed, claimed_daily_tokens, badges_from_wheel').eq('id', state.user.id).single();
  
  // Si certaines colonnes n'existent pas, réessayer sans
  if (error && error.message && (error.message.includes('is_private') || error.message.includes('tokens') || error.message.includes('last_token_date') || error.message.includes('connection_days') || error.message.includes('week_start_date') || error.message.includes('week_bonus_available') || error.message.includes('week_bonus_claimed') || error.message.includes('claimed_daily_tokens') || error.message.includes('badges_from_wheel'))) {
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
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const currentWeekStart = getWeekStartDate(today);
    const currentWeekStartStr = currentWeekStart.toISOString().split('T')[0];
    
    const insertData = { id: state.user.id, username: 'Invité', badge_count: 0, avatar_url: null, skill_points: 0, rank: 'Minimaliste', tokens: 3 };
    try {
      await supabase.from('profiles').insert({ ...insertData, is_private: false });
      state.profile = { ...insertData, is_private: false, tokens: 3, last_token_date: null, connection_days: [], claimed_daily_tokens: [], week_start_date: currentWeekStartStr, week_bonus_available: false, week_bonus_claimed: false, badges_from_wheel: [] };
    } catch (e) {
      await supabase.from('profiles').insert(insertData);
      state.profile = { ...insertData, is_private: false, tokens: 3, last_token_date: null, connection_days: [], claimed_daily_tokens: [], week_start_date: currentWeekStartStr, week_bonus_available: false, week_bonus_claimed: false, badges_from_wheel: [] };
    }
  } else {
    state.profile = { 
      ...data, 
      is_private: data.is_private ?? false,
      tokens: data.tokens ?? 3,
      last_token_date: data.last_token_date || null,
      connection_days: data.connection_days || [],
      claimed_daily_tokens: data.claimed_daily_tokens || [],
      week_start_date: data.week_start_date || null,
      week_bonus_available: data.week_bonus_available ?? false,
      week_bonus_claimed: data.week_bonus_claimed ?? false,
      badges_from_wheel: data.badges_from_wheel || []
    };
  }
  state.tokens = state.profile.tokens || 0;
  
  // Charger les badges de la section retenter depuis la base de données
  if (Array.isArray(state.profile.badges_from_wheel)) {
    state.badgesFromWheel = new Set(state.profile.badges_from_wheel);
  } else {
    state.badgesFromWheel = new Set();
  }
  
  updatePrivacyButton();
  updatePrivacyIndicator();
  // Charger les jours de connexion
  await loadConnectionDays();
  // Vérifier et attribuer les jetons après avoir chargé le profil
  // Cette fonction est appelée à chaque chargement de page (même si l'utilisateur n'a pas besoin de se reconnecter)
  // Elle vérifie automatiquement si last_token_date est différent d'aujourd'hui et attribue les jetons si nécessaire
  await checkAndGrantTokens();
}

// Sauvegarde les badges de la section retenter dans la base de données
async function saveBadgesFromWheel() {
  if (!state.user || !state.profile) return;
  
  // Convertir le Set en Array pour la base de données
  const badgesArray = Array.from(state.badgesFromWheel);
  
  // Mettre à jour dans Supabase
  const { error } = await supabase
    .from('profiles')
    .update({ badges_from_wheel: badgesArray })
    .eq('id', state.user.id);
  
  if (error) {
    console.error('Erreur lors de la sauvegarde des badges de la section retenter:', error);
  } else {
    // Mettre à jour le profil local
    state.profile.badges_from_wheel = badgesArray;
  }
}

// Enregistre la connexion du jour (sans attribuer de jetons automatiquement)
// Les jetons doivent maintenant être récupérés manuellement dans le calendrier
async function checkAndGrantTokens() {
  if (!state.user || !state.profile) return;
  
  // Mettre à jour le jour de connexion dans le calendrier
  // Cela marque que l'utilisateur s'est connecté aujourd'hui
  await checkAndUpdateConnectionDay();
  
  // Mettre à jour l'affichage des jetons
  updateTokensDisplay();
}

// Affiche une notification quand des jetons sont attribués
function showTokenRewardNotification(amount = 2, type = 'daily') {
  // Créer une infobulle temporaire
  const notification = document.createElement('div');
  notification.className = 'token-reward-notification';
  
  let message = '';
  if (type === 'bonus') {
    message = `+${amount} jeton${amount > 1 ? 's' : ''} bonus !`;
  } else {
    message = `+${amount} jeton${amount > 1 ? 's' : ''} d'expérience !`;
  }
  
  notification.innerHTML = `
    <div class="token-reward-content">
      <span class="token-emoji">🪙</span>
      <span>${message}</span>
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

// Crée une animation légère lors de la récupération de jetons sur une case du calendrier
function createTokenClaimAnimation(element, amount) {
  if (!element) return;
  
  // Animation de pulse et scale
  element.style.transition = 'all 0.3s ease-out';
  element.style.transform = 'scale(1.1)';
  element.style.boxShadow = '0 0 20px rgba(6, 182, 212, 0.5)';
  
  setTimeout(() => {
    element.style.transform = 'scale(1)';
    element.style.boxShadow = '';
    setTimeout(() => {
      element.style.transition = '';
    }, 300);
  }, 300);
  
  // Afficher un indicateur visuel temporaire
  const indicator = document.createElement('div');
  indicator.className = 'token-claim-indicator';
  indicator.textContent = `+${amount} 🪙`;
  indicator.style.position = 'absolute';
  indicator.style.top = '50%';
  indicator.style.left = '50%';
  indicator.style.transform = 'translate(-50%, -50%)';
  indicator.style.color = '#06b6d4';
  indicator.style.fontWeight = '700';
  indicator.style.fontSize = '18px';
  indicator.style.pointerEvents = 'none';
  indicator.style.zIndex = '1000';
  indicator.style.opacity = '0';
  indicator.style.transition = 'all 0.5s ease-out';
  
  element.style.position = 'relative';
  element.appendChild(indicator);
  
  // Animation d'apparition et disparition
  setTimeout(() => {
    indicator.style.opacity = '1';
    indicator.style.transform = 'translate(-50%, -80%)';
  }, 10);
  
  setTimeout(() => {
    indicator.style.opacity = '0';
    indicator.style.transform = 'translate(-50%, -120%)';
    setTimeout(() => {
      indicator.remove();
    }, 500);
  }, 1500);
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

// Met à jour l'affichage du compteur de jetons
function updateTokensDisplay() {
  if (!els.tokensCount) return;
  els.tokensCount.textContent = state.tokens || 0;
  
  // Activer/désactiver le bouton selon le nombre de jetons
  if (els.spinButton) {
    const hasTokens = (state.tokens || 0) >= 1;
    const shouldDisable = !hasTokens || state.isWheelSpinning;
    console.log('updateTokensDisplay - hasTokens:', hasTokens, 'shouldDisable:', shouldDisable);
    els.spinButton.disabled = shouldDisable;
    els.spinButton.textContent = state.isWheelSpinning 
      ? 'Roue en cours...' 
      : `Tourner la roue (1 jeton)`;
    
    // S'assurer que l'infobulle est cachée lors de la mise à jour de l'affichage
    // Elle ne s'affichera que lors d'un clic explicite sur le bouton
    if (els.spinButtonTooltip) {
      els.spinButtonTooltip.classList.add('hidden');
    }
    
    // Même si le bouton est désactivé, permettre le clic pour afficher l'infobulle
    if (!hasTokens) {
      els.spinButton.style.pointerEvents = 'auto';
      els.spinButton.style.cursor = 'pointer';
    } else {
      els.spinButton.style.pointerEvents = '';
      els.spinButton.style.cursor = '';
    }
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
        console.error('Erreur lors du chargement des badges:', retry.error);
        setMessage('Erreur lors du chargement des badges depuis Supabase. Vérifiez que la table "badges" existe et contient des données.', true);
      } else {
        data = retry.data;
      }
    }

    if (data) {
      console.log(`✅ ${data.length} badges chargés depuis Supabase`);
      state.badges = data;
      buildBadgeMaps();
      return;
    }
  }

  // Fallback local
  const localBadges = await loadLocalBadges();
  if (!localBadges.length && !useLocalOnly) {
    setMessage('Impossible de charger les badges. Vérifiez que la table "badges" existe dans Supabase et contient des données.', true);
  }
  state.badges = localBadges;
  buildBadgeMaps();
  console.log(`✅ ${localBadges.length} badges chargés (mode local)`);
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
    // Les éléments du header ont été supprimés, on met à jour uniquement ceux qui existent
    if (els.profileUsername) els.profileUsername.textContent = state.profile.username;
    if (els.profileName) els.profileName.value = state.profile.username;
    updateAvatar(state.profile.avatar_url);
    updateCounters(false);
  }
  renderAllBadges();
  renderMyBadges();
  renderBlockedBadges();
  // Mettre à jour la roue si elle est visible (ne pas interférer si elle tourne)
  if (!state.isWheelSpinning) {
    renderWheelBadges();
  }
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
    const order = ['Minimaliste', 'Simple', 'Normale', 'Originale', 'Incroyable', 'Rêve'];
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

// Affiche la roue avec les badges non débloqués (hors fantômes) + joker
function renderWheelBadges() {
  if (!els.wheelContainer || !els.wheelItems) {
    return;
  }
  
  // Filtrer les badges pour la roue :
  // - Non fantômes
  // - Non débloqués
  // - Soit sans réponse (nouveaux badges)
  // - Soit avec réponse mais pas dans badgesFromWheel (anciens comptes avec badges bloqués)
  const availableBadges = state.badges.filter(badge => {
    const unlocked = state.userBadges.has(badge.id);
    const userAnswer = state.userBadgeAnswers.get(badge.id);
    const hasAnswer = userAnswer !== undefined && userAnswer !== null;
    const isInRetrySection = state.badgesFromWheel.has(badge.id);
    
    // Exclure les badges fantômes et débloqués
    if (isGhostBadge(badge) || unlocked) return false;
    
    // Inclure les badges sans réponse (nouveaux)
    if (!hasAnswer) return true;
    
    // Inclure les badges bloqués (anciens comptes) SAUF s'ils sont déjà dans "Badges à retenter"
    if (hasAnswer && !isInRetrySection) return true;
    
    return false;
  });
  
  if (availableBadges.length === 0) {
    els.wheelContainer.innerHTML = '<p class="muted">Aucun badge disponible dans la roue. Vérifie la section "Badges à retenter" ci-dessous ! 👇</p>';
    state.wheelBadgeIds = null; // Réinitialiser l'ordre
    return;
  }
  
  // Créer un tableau avec les badges + joker
  const JOKER_EMOJI = '🃏';
  const JOKER_ID = 'joker';
  
  // Créer le tableau des éléments de la roue (badges + 1 joker)
  const wheelElements = [];
  availableBadges.forEach(badge => {
    wheelElements.push({ type: 'badge', badge, emoji: getBadgeEmoji(badge), id: badge.id });
  });
  // Ajouter un seul joker pour l'affichage
  wheelElements.push({ type: 'joker', emoji: JOKER_EMOJI, id: JOKER_ID });
  
  // Vérifier si les badges ont changé (pour savoir si on doit remélanger)
  const currentBadgeIds = availableBadges.map(b => b.id).sort().join(',');
  const needsReshuffle = !state.wheelBadgeIds || state.wheelBadgeIds !== currentBadgeIds;
  
  let shuffledElements;
  if (needsReshuffle) {
    // Les badges ont changé, on remélange
    shuffledElements = wheelElements.sort(() => Math.random() - 0.5);
    // Stocker l'ordre pour éviter de remélanger inutilement
    state.wheelBadgeIds = currentBadgeIds;
    state.wheelOrder = shuffledElements.map(e => e.id);
  } else {
    // Même badges, on garde le même ordre
    const orderMap = new Map(state.wheelOrder.map((id, index) => [id, index]));
    shuffledElements = wheelElements.sort((a, b) => {
      const aIndex = orderMap.get(a.id) ?? 999;
      const bIndex = orderMap.get(b.id) ?? 999;
      return aIndex - bIndex;
    });
  }
  
  // Vider la roue
  els.wheelItems.innerHTML = '';
  
  // Répéter les éléments plusieurs fois pour créer un effet de boucle
  const REPEAT_COUNT = Math.max(5, Math.ceil(300 / shuffledElements.length));
  
  // Créer les éléments de la roue en boucle
  for (let i = 0; i < REPEAT_COUNT; i++) {
    shuffledElements.forEach(element => {
      const item = document.createElement('div');
      item.className = 'wheel-item';
      if (element.type === 'joker') {
        item.classList.add('wheel-item-joker');
      }
      item.dataset.badgeId = element.id;
      item.dataset.type = element.type;
      item.textContent = element.emoji;
      els.wheelItems.appendChild(item);
    });
  }
  
  // Mettre à jour l'affichage des jetons
  updateTokensDisplay();
  
  // Réattacher l'infobulle du bouton spin (nécessaire car les éléments peuvent être recréés)
  // Mettre à jour les références après le rendu
  els.spinButton = document.getElementById('spin-button');
  els.spinButtonTooltip = document.getElementById('spin-button-tooltip');
  
  if (els.spinButton && els.spinButtonTooltip) {
    attachSpinButtonTooltip();
  }
  
  // Attacher l'événement au formulaire de réponse
  if (els.badgeAnswerForm && !els.badgeAnswerForm.hasAttribute('data-listener-attached')) {
    els.badgeAnswerForm.addEventListener('submit', handleBadgeAnswerFromWheel);
    els.badgeAnswerForm.setAttribute('data-listener-attached', 'true');
  }
}

// Fait tourner la roue et sélectionne un badge aléatoirement
async function handleSpinWheel() {
  if (state.isWheelSpinning) {
    return;
  }
  
  // Vérifier si l'utilisateur a des jetons
  if ((state.tokens || 0) < 1) {
    return;
  }
  
  // Filtrer les badges disponibles pour la roue :
  // - Non fantômes
  // - Non débloqués
  // - Soit sans réponse (nouveaux badges)
  // - Soit avec réponse mais pas dans badgesFromWheel (anciens comptes avec badges bloqués)
  const availableBadges = state.badges.filter(badge => {
    const unlocked = state.userBadges.has(badge.id);
    const userAnswer = state.userBadgeAnswers.get(badge.id);
    const hasAnswer = userAnswer !== undefined && userAnswer !== null;
    const isInRetrySection = state.badgesFromWheel.has(badge.id);
    
    // Exclure les badges fantômes et débloqués
    if (isGhostBadge(badge) || unlocked) return false;
    
    // Inclure les badges sans réponse (nouveaux)
    if (!hasAnswer) return true;
    
    // Inclure les badges bloqués (anciens comptes) SAUF s'ils sont déjà dans "Badges à retenter"
    if (hasAnswer && !isInRetrySection) return true;
    
    return false;
  });
  
  if (availableBadges.length === 0) {
    alert('Tous les badges sont débloqués ! 🎉');
    return;
  }
  
  // Marquer immédiatement que la roue tourne pour éviter les doubles clics
  state.isWheelSpinning = true;
  updateTokensDisplay();
  
  // Consommer un jeton
  const newTokens = (state.tokens || 0) - 1;
  
  // Mettre à jour l'état local immédiatement (optimiste)
  state.tokens = newTokens;
  if (state.profile) {
    state.profile.tokens = newTokens;
  }
  updateTokensDisplay();
  
  // Mettre à jour dans Supabase
  const { error } = await supabase
    .from('profiles')
    .update({ tokens: newTokens })
    .eq('id', state.user.id);
  
  if (error) {
    console.error('Erreur lors de la consommation du jeton:', error);
    state.tokens = (state.tokens || 0) + 1;
    if (state.profile) {
      state.profile.tokens = state.tokens;
    }
    state.isWheelSpinning = false;
    updateTokensDisplay();
    alert('Erreur lors de la mise à jour des jetons. Veuillez réessayer.');
    return;
  }
  
  // Sélection avec exactement 10% de chance pour le joker
  const JOKER_ID = 'joker';
  const JOKER_CHANCE = 0.10; // 10% de chance
  
  // D'abord, déterminer si c'est le joker (10% de chance)
  const jokerRoll = Math.random();
  const isJoker = jokerRoll < JOKER_CHANCE;
  
  let selectedElement;
  if (isJoker) {
    // Joker sélectionné
    selectedElement = { type: 'joker', id: JOKER_ID };
  } else {
    // Sélectionner un badge aléatoirement parmi les badges disponibles
    const randomBadgeIndex = Math.floor(Math.random() * availableBadges.length);
    const badge = availableBadges[randomBadgeIndex];
    selectedElement = { type: 'badge', badge, id: badge.id };
  }
  
  // Stocker le type de sélection
  state.selectedBadgeFromWheel = isJoker ? null : selectedElement.badge;
  state.selectedIsJoker = isJoker;
  
  // Animation de la roue
  const wheelItems = els.wheelItems.querySelectorAll('.wheel-item');
  const itemHeight = 60;
  const jokerCountForDisplay = 1; // Un seul joker affiché dans la roue
  const totalElementsPerSet = availableBadges.length + jokerCountForDisplay;
  const singleSetHeight = totalElementsPerSet * itemHeight;
  
  // Trouver le premier élément correspondant dans la première moitié de la roue
  let targetIndex = -1;
  const firstHalfItems = Math.floor(wheelItems.length / 2);
  for (let i = 0; i < firstHalfItems; i++) {
    if (isJoker && wheelItems[i].dataset.type === 'joker') {
      targetIndex = i;
      break;
    } else if (!isJoker && wheelItems[i].dataset.badgeId === selectedElement.id) {
      targetIndex = i;
      break;
    }
  }
  
  // Si on ne trouve pas dans la première moitié, prendre le premier trouvé
  if (targetIndex === -1) {
    for (let i = 0; i < wheelItems.length; i++) {
      if (isJoker && wheelItems[i].dataset.type === 'joker') {
        targetIndex = i;
        break;
      } else if (!isJoker && wheelItems[i].dataset.badgeId === selectedElement.id) {
        targetIndex = i;
        break;
      }
    }
  }
  
  // Calculer la position finale
  const wheelHeight = 300;
  const indicatorCenter = wheelHeight / 2;
  const itemCenterOffset = itemHeight / 2;
  const targetItemCenter = targetIndex * itemHeight + itemCenterOffset;
  const minDistance = 2 * singleSetHeight;
  const finalPosition = -(minDistance + targetItemCenter - indicatorCenter);
  
  // Animation
  els.wheelItems.style.transition = 'none';
  els.wheelItems.style.transform = 'translateY(0)';
  void els.wheelItems.offsetHeight;
  els.wheelItems.style.transition = 'transform 3s cubic-bezier(0.17, 0.67, 0.12, 0.99)';
  els.wheelItems.style.transform = `translateY(${finalPosition}px)`;
  
  // Après l'animation
  setTimeout(async () => {
    state.isWheelSpinning = false;
    if (els.spinButtonTooltip) {
      els.spinButtonTooltip.classList.add('hidden');
    }
    updateTokensDisplay();
    
    if (isJoker) {
      // Joker tiré : 20% Malus, 30% Bonus modif, 50% Bonus jetons
      const jokerRoll = Math.random();
      if (jokerRoll < 0.20) {
        // Malus (20%) - Perte d'un badge
        handleJokerMalus();
      } else if (jokerRoll < 0.50) {
        // Bonus modification (30%) - Modifier une réponse
        handleJokerBonus();
      } else {
        // Bonus jetons (50%) - Recevoir 3 jetons gratuits
        handleJokerBonusTokens();
      }
    } else {
      // Badge normal
      state.badgesFromWheel.add(selectedElement.id);
      await saveBadgesFromWheel();
      showBadgeQuestion(selectedElement.badge);
    }
  }, 3000);
}

// Gère le Joker Malus : l'utilisateur perd un badge débloqué aléatoirement
async function handleJokerMalus() {
  state.jokerType = 'malus';
  
  // Récupérer les badges débloqués (non fantômes)
  const unlockedBadges = state.badges.filter(badge => 
    state.userBadges.has(badge.id) && !isGhostBadge(badge)
  );
  
  if (unlockedBadges.length === 0) {
    // Pas de badges à perdre - Chanceux !
    showJokerCard('malus-lucky');
    return;
  }
  
  // Sélectionner un badge aléatoire à perdre
  const randomIndex = Math.floor(Math.random() * unlockedBadges.length);
  const badgeToLose = unlockedBadges[randomIndex];
  
  // Afficher la carte Joker Malus avec la mini-roulette
  showJokerMalusRoulette(unlockedBadges, badgeToLose);
}

// Affiche la mini-roulette pour le Joker Malus
function showJokerMalusRoulette(unlockedBadges, badgeToLose) {
  if (!els.badgeQuestionContainer) return;
  
  state.badgeQuestionAnswered = true; // Permettre la fermeture après l'animation
  
  const card = els.badgeQuestionContainer.querySelector('.card');
  if (!card) return;
  
  // Ajouter la classe d'animation
  card.classList.add('joker-card-animate');
  
  // Créer la mini-roulette HTML
  const badgesHtml = unlockedBadges.map(b => 
    `<div class="mini-wheel-item" data-badge-id="${b.id}">${getBadgeEmoji(b)}</div>`
  ).join('');
  
  card.innerHTML = `
    <h3 style="text-align: center; font-size: 60px; margin: 10px 0;">🃏</h3>
    <p class="joker-title joker-malus-title" style="text-align: center; font-size: 24px; font-weight: bold; color: var(--danger);">Badge Joker - Malus</p>
    <p style="text-align: center; margin: 15px 0;">Tu perds un badge que tu as déjà débloqué...</p>
    <div class="mini-wheel-container">
      <div class="mini-wheel-indicator"></div>
      <div class="mini-wheel-items">
        ${badgesHtml.repeat(5)}
      </div>
    </div>
    <p id="joker-malus-result" class="joker-result" style="text-align: center; margin-top: 20px; font-size: 18px; display: none;"></p>
  `;
  
  els.badgeQuestionContainer.classList.remove('hidden');
  
  // Animer la mini-roulette
  const miniWheelItems = card.querySelector('.mini-wheel-items');
  const itemHeight = 50;
  const containerHeight = 150; // Hauteur du conteneur .mini-wheel-container
  const targetIndex = unlockedBadges.findIndex(b => b.id === badgeToLose.id);
  const minDistance = unlockedBadges.length * itemHeight * 3;
  // Calculer l'offset pour centrer le badge dans l'indicateur
  const centerOffset = (containerHeight - itemHeight) / 2; // = 50px
  const finalPosition = -(minDistance + targetIndex * itemHeight) + centerOffset;
  
  setTimeout(() => {
    miniWheelItems.style.transition = 'transform 2s cubic-bezier(0.17, 0.67, 0.12, 0.99)';
    miniWheelItems.style.transform = `translateY(${finalPosition}px)`;
  }, 100);
  
  // Après l'animation, marquer le badge comme perdu
  setTimeout(async () => {
    const resultEl = card.querySelector('#joker-malus-result');
    if (resultEl) {
      resultEl.textContent = `Tu as perdu le badge ${getBadgeEmoji(badgeToLose)} ${stripEmojis(badgeToLose.name)} !`;
      resultEl.style.display = 'block';
    }
    
    // Mettre à jour la base de données : marquer le badge comme bloqué (success: false)
    const { error } = await supabase.from('user_badges').upsert({
      user_id: state.user.id,
      badge_id: badgeToLose.id,
      success: false,
      level: null,
      user_answer: state.userBadgeAnswers.get(badgeToLose.id) || null,
      was_ever_unlocked: true
    });
    
    if (!error) {
      // Mettre à jour l'état local
      state.userBadges.delete(badgeToLose.id);
      state.userBadgeLevels.delete(badgeToLose.id);
      
      // Re-rendre les badges
      await updateCounters(false);
      renderWheelBadges();
      renderMyBadges();
    }
    
    // Fermer automatiquement après 3 secondes
    setTimeout(() => {
      closeBadgeQuestion();
    }, 3000);
  }, 2100);
}

// Affiche la carte Joker (pour le cas chanceux ou le bonus)
function showJokerCard(type) {
  if (!els.badgeQuestionContainer) return;
  
  state.badgeQuestionAnswered = true;
  
  const card = els.badgeQuestionContainer.querySelector('.card');
  if (!card) return;
  
  // Ajouter la classe d'animation
  card.classList.add('joker-card-animate');
  
  if (type === 'malus-lucky') {
    card.innerHTML = `
      <h3 style="text-align: center; font-size: 60px; margin: 10px 0;">🃏</h3>
      <p class="joker-title joker-malus-title" style="text-align: center; font-size: 24px; font-weight: bold; color: var(--danger);">Badge Joker - Malus</p>
      <p style="text-align: center; margin: 20px 0; font-size: 18px; color: var(--success);">
        🍀 Tu n'as aucun badge à perdre, chanceux !
      </p>
    `;
    els.badgeQuestionContainer.classList.remove('hidden');
    
    setTimeout(() => {
      closeBadgeQuestion();
    }, 3000);
  }
}

// Gère le Joker Bonus : l'utilisateur peut modifier la réponse d'un badge
function handleJokerBonus() {
  state.jokerType = 'bonus';
  
  if (!els.badgeQuestionContainer) return;
  
  state.badgeQuestionAnswered = true;
  
  const card = els.badgeQuestionContainer.querySelector('.card');
  if (!card) return;
  
  // Ajouter la classe d'animation
  card.classList.add('joker-card-animate');
  
  card.innerHTML = `
    <h3 style="text-align: center; font-size: 60px; margin: 10px 0;">🃏</h3>
    <p class="joker-title joker-bonus-title" style="text-align: center; font-size: 24px; font-weight: bold; color: var(--success);">Badge Joker</p>
    <p style="text-align: center; margin: 20px 0; font-size: 16px;">
      Tu peux choisir un badge pour modifier sa réponse !
    </p>
    <div class="joker-buttons" style="display: flex; gap: 15px; justify-content: center; margin-top: 20px;">
      <button id="joker-bonus-accept" class="primary">Choisir (2 jetons)</button>
      <button id="joker-bonus-decline" class="ghost">Non merci</button>
    </div>
    <p id="joker-bonus-error" class="error" style="text-align: center; margin-top: 10px; display: none;"></p>
  `;
  
  els.badgeQuestionContainer.classList.remove('hidden');
  
  // Attacher les événements
  const acceptBtn = card.querySelector('#joker-bonus-accept');
  const declineBtn = card.querySelector('#joker-bonus-decline');
  const errorEl = card.querySelector('#joker-bonus-error');
  
  acceptBtn.addEventListener('click', async () => {
    // Vérifier si l'utilisateur a assez de jetons
    if ((state.tokens || 0) < 2) {
      errorEl.textContent = 'Tu n\'as pas assez de jetons (2 requis).';
      errorEl.style.display = 'block';
      return;
    }
    
    // Consommer 2 jetons
    const newTokens = (state.tokens || 0) - 2;
    state.tokens = newTokens;
    if (state.profile) {
      state.profile.tokens = newTokens;
    }
    
    await supabase
      .from('profiles')
      .update({ tokens: newTokens })
      .eq('id', state.user.id);
    
    updateTokensDisplay();
    
    // Activer le mode modification
    state.isModifyingBadge = true;
    
    // Fermer la carte joker
    closeBadgeQuestion();
    
    // Basculer vers l'onglet "Mes badges"
    showTab('my-badges');
    
    // Afficher un message d'instruction
    renderMyBadges();
  });
  
  declineBtn.addEventListener('click', () => {
    closeBadgeQuestion();
  });
}

// Gère le Joker Bonus Jetons : l'utilisateur reçoit 3 jetons gratuits
async function handleJokerBonusTokens() {
  state.jokerType = 'bonus-tokens';
  
  if (!els.badgeQuestionContainer) return;
  
  state.badgeQuestionAnswered = true;
  
  const card = els.badgeQuestionContainer.querySelector('.card');
  if (!card) return;
  
  // Ajouter la classe d'animation
  card.classList.add('joker-card-animate');
  
  card.innerHTML = `
    <h3 style="text-align: center; font-size: 60px; margin: 10px 0;">🃏</h3>
    <p class="joker-title joker-bonus-title" style="text-align: center; font-size: 24px; font-weight: bold; color: var(--success);">Badge Joker - Bonus</p>
    <p style="text-align: center; margin: 20px 0; font-size: 18px;">
      🎁 Tu reçois 3 jetons gratuits !
    </p>
    <div style="display: flex; justify-content: center; margin-top: 20px;">
      <button id="joker-tokens-btn" class="primary">Obtenir</button>
    </div>
  `;
  
  els.badgeQuestionContainer.classList.remove('hidden');
  
  // Attacher l'événement
  const obtainBtn = card.querySelector('#joker-tokens-btn');
  
  obtainBtn.addEventListener('click', async () => {
    // Ajouter 3 jetons
    const newTokens = (state.tokens || 0) + 3;
    state.tokens = newTokens;
    if (state.profile) {
      state.profile.tokens = newTokens;
    }
    
    // Mettre à jour dans Supabase
    await supabase
      .from('profiles')
      .update({ tokens: newTokens })
      .eq('id', state.user.id);
    
    updateTokensDisplay();
    
    // Fermer la carte
    closeBadgeQuestion();
    
    // Afficher la notification
    showTokenRewardNotification(3);
  });
}

// Affiche la question du badge sélectionné
function showBadgeQuestion(badge) {
  if (!els.badgeQuestionContainer) return;
  
  // Réinitialiser le flag de réponse
  state.badgeQuestionAnswered = false;
  
  // Recréer la structure HTML complète de la carte (au cas où elle a été remplacée par un message de succès/erreur)
  const card = els.badgeQuestionContainer.querySelector('.card');
  if (card) {
    card.innerHTML = `
      <h3 id="selected-badge-name"></h3>
      <p id="selected-badge-question" class="badge-question-text"></p>
      <form id="badge-answer-form" class="auth-form">
        <label for="badge-answer-input">Ta réponse</label>
        <textarea id="badge-answer-input" rows="3" placeholder="Écris ta réponse ici..."></textarea>
      <button type="submit" class="primary">Valider</button>
      </form>
      <p id="badge-answer-message" class="message"></p>
    `;
    
    // Réinitialiser les références aux éléments
    els.selectedBadgeName = document.getElementById('selected-badge-name');
    els.selectedBadgeQuestion = document.getElementById('selected-badge-question');
    els.badgeAnswerForm = document.getElementById('badge-answer-form');
    els.badgeAnswerInput = document.getElementById('badge-answer-input');
    els.badgeAnswerMessage = document.getElementById('badge-answer-message');
  }
  
  if (!els.selectedBadgeName || !els.selectedBadgeQuestion) return;
  
  // Afficher uniquement l'emoji, pas le nom
  // Mais garder le vrai emoji et nom dans les attributs title et data-*
  const emoji = getBadgeEmoji(badge);
  const title = stripEmojis(badge.name || '');
  els.selectedBadgeName.textContent = emoji;
  els.selectedBadgeName.setAttribute('title', `${emoji} ${title}`);
  els.selectedBadgeName.setAttribute('data-emoji', emoji);
  els.selectedBadgeName.setAttribute('data-title', title);
  els.selectedBadgeQuestion.textContent = badge.question || '';
  els.badgeAnswerMessage.textContent = '';
  els.badgeAnswerMessage.className = 'message';
  
  // Générer le formulaire selon le type de badge
  const config = parseConfig(badge.answer);
  let formContent = '';
  
    if (config?.type === 'boolean') {
    // Badge Oui/Non
      formContent = `
        <input type="hidden" name="answer" value="">
        <div class="bool-buttons">
          <button type="button" class="ghost bool-btn" data-bool="oui">Oui</button>
          <button type="button" class="ghost bool-btn" data-bool="non">Non</button>
        </div>
      `;
  } else if (config?.type === 'singleSelect' && Array.isArray(config.options)) {
    // Badge sélection unique
      const optionsMarkup = config.options.map(opt => `
        <option value="${opt.value}">${opt.label}</option>
      `).join('');
      formContent = `
        <select name="answer-single" class="select-multi">
          <option value="">Choisis une option</option>
          ${optionsMarkup}
        </select>
      `;
  } else if (config?.type === 'multiSelect' && Array.isArray(config.options)) {
    // Badge multi-sélection
      const optionsMarkup = config.options.map(opt => `
        <option value="${opt.value}">${opt.label}</option>
      `).join('');
      const size = Math.min(Math.max(config.options.length, 4), 9); // entre 4 et 9 lignes
      formContent = `
        <select name="answer-select" class="select-multi" multiple size="${size}">
          ${optionsMarkup}
        </select>
        <small class="muted">Tu peux sélectionner plusieurs options.</small>
    `;
  } else if (config?.type === 'range') {
    // Badge numérique - utiliser une zone de saisie de nombres
    formContent = `
      <input type="number" id="badge-answer-input" name="answer" min="0" step="${config.step || 1}" placeholder="Entre un nombre" class="number-input">
    `;
  } else {
    // Badge texte (par défaut)
    formContent = `
      <textarea id="badge-answer-input" name="answer" rows="3" placeholder="Écris ta réponse ici..."></textarea>
    `;
  }
  
  // Mettre à jour le formulaire
  els.badgeAnswerForm.innerHTML = `
    <label for="badge-answer-input">Ta réponse</label>
    ${formContent}
        <button type="submit" class="primary">Valider</button>
  `;
  
  // Réattacher l'événement submit du formulaire (nécessaire car innerHTML recrée les éléments)
  if (els.badgeAnswerForm) {
    // Supprimer l'ancien listener s'il existe
    if (els.badgeAnswerForm._submitHandler) {
      els.badgeAnswerForm.removeEventListener('submit', els.badgeAnswerForm._submitHandler);
    }
    // Créer et attacher le nouveau listener
    els.badgeAnswerForm._submitHandler = handleBadgeAnswerFromWheel;
    els.badgeAnswerForm.addEventListener('submit', els.badgeAnswerForm._submitHandler);
  }
  
  // Réattacher les événements pour les boutons boolean
  if (config?.type === 'boolean') {
    const hiddenInput = els.badgeAnswerForm.querySelector('input[name="answer"]');
    const boolBtns = els.badgeAnswerForm.querySelectorAll('.bool-btn');
    boolBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        if (hiddenInput) hiddenInput.value = btn.getAttribute('data-bool') || '';
        // Ne pas auto-submettre, laisser l'utilisateur cliquer sur "Valider"
        // Mettre en évidence le bouton sélectionné visuellement
        boolBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
  }
  
  // Afficher le conteneur
  els.badgeQuestionContainer.classList.remove('hidden');
  
  // Attacher le gestionnaire de clic pour fermer la carte en cliquant en dehors
  attachBadgeQuestionCloseHandler();
}

// Attache le gestionnaire de clic pour fermer la carte en cliquant en dehors
function attachBadgeQuestionCloseHandler() {
  // Supprimer l'ancien gestionnaire s'il existe
  if (els.badgeQuestionContainer._closeHandler) {
    els.badgeQuestionContainer.removeEventListener('click', els.badgeQuestionContainer._closeHandler);
  }
  
  // Créer un nouveau gestionnaire
  els.badgeQuestionContainer._closeHandler = (e) => {
    // Ne pas permettre la fermeture si aucune réponse n'a été donnée
    if (!state.badgeQuestionAnswered) {
      return;
    }
    
    // Si on clique sur le conteneur lui-même (pas sur la carte), fermer
    const card = els.badgeQuestionContainer.querySelector('.card');
    if (card && !card.contains(e.target) && e.target === els.badgeQuestionContainer) {
      closeBadgeQuestion();
    }
  };
  
  els.badgeQuestionContainer.addEventListener('click', els.badgeQuestionContainer._closeHandler);
}

// Ferme la carte du badge
function closeBadgeQuestion() {
  if (els.badgeQuestionContainer) {
    els.badgeQuestionContainer.classList.add('hidden');
  }
  // Note: La roue est mise à jour par handleBadgeAnswerFromWheel ou render()
  // Ne pas appeler renderWheelBadges() ici pour éviter les sauts visuels
}

// Gère la réponse au badge depuis la roue
async function handleBadgeAnswerFromWheel(e) {
  e.preventDefault();
  if (!state.selectedBadgeFromWheel) return;
  
  // Vérifier d'abord si une réponse valide a été fournie avant de marquer comme répondu
  // On va passer un flag pour indiquer qu'on veut vérifier la réponse
  const hadValidAnswer = await handleBadgeAnswer(e, state.selectedBadgeFromWheel, null, els.badgeAnswerMessage, null, true);
  
  // Si aucune réponse valide n'a été fournie, ne rien faire
  if (!hadValidAnswer) {
    return;
  }
  
  // Marquer qu'une réponse valide a été donnée (seulement maintenant)
  state.badgeQuestionAnswered = true;
  
  // Après la réponse, vérifier si le badge a été débloqué
  const wasUnlocked = state.userBadges.has(state.selectedBadgeFromWheel.id);
  
  if (wasUnlocked) {
    // S'assurer que le conteneur est visible
    if (els.badgeQuestionContainer) {
      els.badgeQuestionContainer.classList.remove('hidden');
    }
    
    // Vérifier si c'est un niveau Expert (mystère)
    const badgeLevel = state.userBadgeLevels.get(state.selectedBadgeFromWheel.id);
    const isExpertLevel = isMysteryLevel(badgeLevel);
    
    // Afficher uniquement l'emoji et un message de succès qui remplace le reste
    const card = els.badgeQuestionContainer?.querySelector('.card');
    if (card) {
      // Récupérer l'emoji depuis le badge ou depuis l'élément existant
      const emoji = els.selectedBadgeName?.textContent || getBadgeEmoji(state.selectedBadgeFromWheel);
      
      // Message différent pour les badges Expert
      const successMessage = isExpertLevel
        ? '🏆 Badge Expert débloqué ! Il est ajouté à ta collection.'
        : '🎉 Badge débloqué ! Il est ajouté à ta collection.';
      const messageColor = isExpertLevel ? '#a855f7' : '#10b981'; // Violet pour Expert, vert pour normal
      
    card.innerHTML = `
        <h3 id="selected-badge-name" style="text-align: center; font-size: 80px; line-height: 1; margin: 20px 0; padding: 0;">${emoji}</h3>
        <p class="badge-success-message" style="text-align: center; color: ${messageColor}; margin: 20px 0; font-size: 16px;">
          ${successMessage}
        </p>
      `;
      // Mettre à jour la référence à selectedBadgeName après avoir modifié le HTML
      els.selectedBadgeName = card.querySelector('#selected-badge-name');
      // Réattacher le gestionnaire de fermeture (maintenant la fermeture est autorisée car une réponse a été donnée)
      attachBadgeQuestionCloseHandler();
    }
    
    // Mettre à jour la roue et les badges IMMÉDIATEMENT (avant le délai)
    renderWheelBadges();
    renderMyBadges();
    renderBlockedBadges();
    
    // Masquer le conteneur après 3 secondes
    // L'utilisateur peut aussi cliquer ailleurs pour fermer (géré par attachBadgeQuestionCloseHandler)
    setTimeout(() => {
      closeBadgeQuestion();
    }, 3000);
  } else {
    // S'assurer que le badge est bien dans badgesFromWheel pour la section retenter
    if (state.selectedBadgeFromWheel && !state.badgesFromWheel.has(state.selectedBadgeFromWheel.id)) {
      state.badgesFromWheel.add(state.selectedBadgeFromWheel.id);
      await saveBadgesFromWheel();
    }
    
    // S'assurer que le conteneur est visible
    if (els.badgeQuestionContainer) {
      els.badgeQuestionContainer.classList.remove('hidden');
    }
    
    // Afficher uniquement l'emoji et un message d'erreur qui remplace le reste
    const card = els.badgeQuestionContainer?.querySelector('.card');
    if (card) {
      // Récupérer l'emoji depuis le badge ou depuis l'élément existant
      const emoji = els.selectedBadgeName?.textContent || getBadgeEmoji(state.selectedBadgeFromWheel);
      
      // Récupérer le message personnalisé depuis la config du badge
      const config = parseConfig(state.selectedBadgeFromWheel.answer);
      const customMessage = config?.blockedMessage;
      const errorMessage = customMessage || 'Ta réponse n\'a pas suffi pour débloquer ce badge. Tu peux rerépondre à ce badge juste en dessous.';
      
      card.innerHTML = `
        <h3 id="selected-badge-name" style="text-align: center; font-size: 80px; line-height: 1; margin: 20px 0; padding: 0;">${emoji}</h3>
        <p class="badge-error-message" style="text-align: center; color: var(--danger); margin: 20px 0; font-size: 16px;">
          ${errorMessage}
        </p>
      `;
      // Mettre à jour la référence à selectedBadgeName après avoir modifié le HTML
      els.selectedBadgeName = card.querySelector('#selected-badge-name');
      // Réattacher le gestionnaire de fermeture (maintenant la fermeture est autorisée car une réponse a été donnée)
      attachBadgeQuestionCloseHandler();
    }
    
    // Mettre à jour la roue et les badges IMMÉDIATEMENT
    renderWheelBadges();
    renderBlockedBadges();
  }
  
  // Réinitialiser le flag de retry
  state.isRetryBadge = false;
  state.retryBadgeId = null;
}

// Affiche les badges répondu mais non débloqués (bloqués) - uniquement ceux de la roue
function renderBlockedBadges() {
  if (!els.blockedBadgesList) return;
  
  // Filtrer les badges : répondu mais non débloqués ET provenant de la roue
  const blockedBadges = state.badges.filter(badge => {
    const unlocked = state.userBadges.has(badge.id);
    const userAnswer = state.userBadgeAnswers.get(badge.id);
    const hasAnswer = userAnswer !== undefined && userAnswer !== null;
    const fromWheel = state.badgesFromWheel.has(badge.id);
    // Afficher uniquement les badges qui ont une réponse, ne sont pas débloqués, et proviennent de la roue
    return !isGhostBadge(badge) && !unlocked && hasAnswer && fromWheel;
  });
  
  els.blockedBadgesList.innerHTML = '';
  
  // Toujours afficher la section (le titre reste visible)
  els.blockedBadgesSection.style.display = 'block';
  
  if (blockedBadges.length === 0) {
    // Afficher un message quand il n'y a pas de badges
    els.blockedBadgesList.innerHTML = '<p class="muted">Aucun badge à retenter pour le moment.</p>';
    return;
  }
  
  blockedBadges.forEach(badge => {
    const card = document.createElement('article');
    card.className = 'card-badge clickable compact all-badge-card blocked blocked-badge-card';
    card.dataset.badgeId = badge.id;
    
    const emoji = getBadgeEmoji(badge);
    const title = stripEmojis(badge.name || '');
    const userAnswer = state.userBadgeAnswers.get(badge.id);
    
    // Badge fermé par défaut - affiche l'emoji mais pas le nom
    // Mais garder le vrai emoji et nom dans les attributs title et data-*
    card.innerHTML = `
      <div class="blocked-badge-header">
      <div class="badge-compact">
          <div class="badge-emoji" title="${emoji}" data-emoji="${emoji}">${emoji}</div>
          <div class="badge-title" title="${emoji} ${title}" data-title="${title}" style="display: none;"></div>
      </div>
        <span class="tag blocked">Bloqué</span>
      </div>
      <div class="blocked-badge-details hidden">
        <div class="blocked-badge-answer">
          <p class="muted">Ta réponse précédente : ${formatUserAnswer(badge, userAnswer) || userAnswer}</p>
        </div>
        <button class="primary retry-badge-btn" data-badge-id="${badge.id}">
          Retenter (1 jeton)
        </button>
        <div class="blocked-badge-question-container hidden"></div>
      </div>
    `;
    
    // Attacher l'événement au clic sur la carte pour ouvrir/fermer
    card.addEventListener('click', (e) => {
      // Ne pas ouvrir si on clique sur le bouton
      if (e.target.closest('.retry-badge-btn')) return;
      
      const details = card.querySelector('.blocked-badge-details');
      const isHidden = details.classList.contains('hidden');
      
      // Fermer tous les autres badges
      els.blockedBadgesList.querySelectorAll('.blocked-badge-card').forEach(otherCard => {
        if (otherCard !== card) {
          const otherDetails = otherCard.querySelector('.blocked-badge-details');
          if (otherDetails) {
            otherDetails.classList.add('hidden');
            otherCard.classList.remove('expanded');
          }
        }
      });
      
      // Ouvrir/fermer le badge cliqué
      if (isHidden) {
        details.classList.remove('hidden');
        card.classList.add('expanded');
        // S'assurer que le badge est visible quand il est ouvert
        setTimeout(() => {
          card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 100);
      } else {
        details.classList.add('hidden');
        card.classList.remove('expanded');
      }
    });
    
    // Attacher l'événement au bouton retenter
    const retryBtn = card.querySelector('.retry-badge-btn');
    retryBtn.addEventListener('click', (e) => {
      e.stopPropagation(); // Empêcher l'ouverture/fermeture de la carte
      handleRetryBadge(badge);
    });
    
    els.blockedBadgesList.appendChild(card);
  });
}

// Gère le retry d'un badge bloqué
async function handleRetryBadge(badge) {
  if (state.isWheelSpinning) return;
  
  // Vérifier si l'utilisateur a des jetons
  if ((state.tokens || 0) < 1) {
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
  
  // Trouver la carte du badge dans la section retenter
  const card = els.blockedBadgesList.querySelector(`[data-badge-id="${badge.id}"]`);
  if (!card) return;
  
  // Ouvrir la carte si elle est fermée
  const details = card.querySelector('.blocked-badge-details');
  if (details && details.classList.contains('hidden')) {
    details.classList.remove('hidden');
    card.classList.add('expanded');
  }
  
  // Afficher la question du badge directement dans la carte
  showBadgeQuestionInCard(badge, card);
  
  // Marquer que c'est un retry pour ne pas consommer de jeton supplémentaire lors de la réponse
  state.isRetryBadge = true;
  state.retryBadgeId = badge.id;
}

// Affiche la question du badge directement dans la carte du badge bloqué
function showBadgeQuestionInCard(badge, card) {
  const questionContainer = card.querySelector('.blocked-badge-question-container');
  if (!questionContainer) return;
  
  // Afficher le conteneur
  questionContainer.classList.remove('hidden');
  
  // Cacher le bouton "Retenter" et la réponse précédente
  const retryBtn = card.querySelector('.retry-badge-btn');
  const answerDiv = card.querySelector('.blocked-badge-answer');
  if (retryBtn) retryBtn.style.display = 'none';
  if (answerDiv) answerDiv.style.display = 'none';
  
  // Afficher uniquement l'emoji, pas le nom
  const emoji = getBadgeEmoji(badge);
  const title = stripEmojis(badge.name || '');
  
  // Générer le formulaire selon le type de badge
  const config = parseConfig(badge.answer);
  let formContent = '';
  
  if (config?.type === 'boolean') {
    // Badge Oui/Non
    formContent = `
      <div class="badge-question-text">
        <p><strong>${emoji}</strong></p>
        <p>${badge.question || ''}</p>
      </div>
      <form class="badge-answer-form" data-badge-id="${badge.id}">
        <input type="hidden" name="answer" value="">
        <div class="bool-buttons">
          <button type="button" class="ghost bool-btn" data-bool="oui">Oui</button>
          <button type="button" class="ghost bool-btn" data-bool="non">Non</button>
        </div>
        <button type="submit" class="primary">Valider</button>
        <div class="message"></div>
        </form>
    `;
  } else if (config?.type === 'singleSelect' && Array.isArray(config.options)) {
    // Badge sélection unique
    const optionsMarkup = config.options.map(opt => `
      <option value="${opt.value}">${opt.label}</option>
    `).join('');
    formContent = `
      <div class="badge-question-text">
        <p><strong>${emoji}</strong></p>
        <p>${badge.question || ''}</p>
      </div>
      <form class="badge-answer-form" data-badge-id="${badge.id}">
        <select name="answer-single" class="select-multi">
          <option value="">Choisis une option</option>
          ${optionsMarkup}
        </select>
        <button type="submit" class="primary">Valider</button>
        <div class="message"></div>
      </form>
    `;
  } else if (config?.type === 'multiSelect' && Array.isArray(config.options)) {
    // Badge multi-sélection
    const optionsMarkup = config.options.map(opt => `
      <option value="${opt.value}">${opt.label}</option>
    `).join('');
    const size = Math.min(Math.max(config.options.length, 4), 9);
    formContent = `
      <div class="badge-question-text">
        <p><strong>${emoji}</strong></p>
        <p>${badge.question || ''}</p>
      </div>
      <form class="badge-answer-form" data-badge-id="${badge.id}">
        <select name="answer-select" class="select-multi" multiple size="${size}">
          ${optionsMarkup}
        </select>
        <small class="muted">Tu peux sélectionner plusieurs options.</small>
        <button type="submit" class="primary">Valider</button>
        <div class="message"></div>
      </form>
    `;
  } else if (config?.type === 'range') {
    // Badge numérique - utiliser une zone de saisie de nombres
    formContent = `
      <div class="badge-question-text">
        <p><strong>${emoji}</strong></p>
        <p>${badge.question || ''}</p>
      </div>
      <form class="badge-answer-form" data-badge-id="${badge.id}">
        <input type="number" name="answer" min="0" step="${config.step || 1}" placeholder="Entre un nombre" class="number-input">
        <button type="submit" class="primary">Valider</button>
        <div class="message"></div>
      </form>
    `;
  } else {
    // Badge texte (par défaut)
    formContent = `
      <div class="badge-question-text">
        <p><strong>${emoji}</strong></p>
        <p>${badge.question || ''}</p>
      </div>
      <form class="badge-answer-form" data-badge-id="${badge.id}">
        <textarea name="answer" rows="3" placeholder="Écris ta réponse ici..."></textarea>
        <button type="submit" class="primary">Valider</button>
        <div class="message"></div>
      </form>
    `;
  }
  
  questionContainer.innerHTML = formContent;
  
  // Attacher les événements pour les boutons booléens
  const boolButtons = questionContainer.querySelectorAll('.bool-btn');
  boolButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      // Retirer la classe active de tous les boutons
      boolButtons.forEach(b => b.classList.remove('active'));
      // Ajouter la classe active au bouton cliqué
      btn.classList.add('active');
      // Mettre à jour la valeur du champ caché
      const form = questionContainer.querySelector('.badge-answer-form');
      const hiddenInput = form.querySelector('input[type="hidden"]');
      if (hiddenInput) {
        hiddenInput.value = btn.dataset.bool === 'oui' ? 'true' : 'false';
      }
    });
  });
  
  // Attacher l'événement de soumission du formulaire
  const form = questionContainer.querySelector('.badge-answer-form');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const messageDiv = form.querySelector('.message');
      // Créer un objet event factice pour handleBadgeAnswer
      const fakeEvent = { target: form, preventDefault: () => {} };
      await handleBadgeAnswer(fakeEvent, badge, null, messageDiv, card);
    });
  }
  
  // Faire défiler la carte en vue
  setTimeout(() => {
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, 100);
}

// Gère la modification de réponse d'un badge (depuis le Joker Bonus)
function handleModifyBadgeAnswer(badge) {
  // Désactiver le mode modification
  state.isModifyingBadge = false;
  
  // Supprimer le bandeau d'instruction
  const banner = document.getElementById('modify-badge-banner');
  if (banner) {
    banner.remove();
  }
  
  // Sauvegarder l'ancien état du badge pour pouvoir le restaurer
  const oldLevel = state.userBadgeLevels.get(badge.id);
  const oldAnswer = state.userBadgeAnswers.get(badge.id);
  
  // Afficher le formulaire de réponse dans une modal
  if (!els.badgeQuestionContainer) return;
  
  state.badgeQuestionAnswered = false;
  
  const emoji = getBadgeEmoji(badge);
  const title = stripEmojis(badge.name || '');
  const config = parseConfig(badge.answer);
  
  const card = els.badgeQuestionContainer.querySelector('.card');
  if (!card) return;
  
  // Générer le formulaire selon le type de badge
  let formContent = '';
  
    if (config?.type === 'boolean') {
    formContent = `
      <input type="hidden" name="answer" value="">
      <div class="bool-buttons">
        <button type="button" class="ghost bool-btn" data-bool="oui">Oui</button>
        <button type="button" class="ghost bool-btn" data-bool="non">Non</button>
      </div>
    `;
  } else if (config?.type === 'singleSelect' && Array.isArray(config.options)) {
    const optionsMarkup = config.options.map(opt => `
      <option value="${opt.value}">${opt.label}</option>
    `).join('');
    formContent = `
      <select name="answer-single" class="select-multi">
        <option value="">Choisis une option</option>
        ${optionsMarkup}
      </select>
    `;
  } else if (config?.type === 'multiSelect' && Array.isArray(config.options)) {
    const optionsMarkup = config.options.map(opt => `
      <option value="${opt.value}">${opt.label}</option>
    `).join('');
    const size = Math.min(Math.max(config.options.length, 4), 9);
    formContent = `
      <select name="answer-select" class="select-multi" multiple size="${size}">
        ${optionsMarkup}
      </select>
      <small class="muted">Tu peux sélectionner plusieurs options.</small>
    `;
  } else if (config?.type === 'range') {
    formContent = `
      <input type="number" name="answer" min="0" step="${config.step || 1}" placeholder="Entre un nombre" class="number-input">
    `;
  } else {
    formContent = `
      <textarea name="answer" rows="3" placeholder="Écris ta réponse ici..."></textarea>
    `;
  }
  
  card.innerHTML = `
    <h3 style="text-align: center; font-size: 60px; margin: 10px 0;">${emoji}</h3>
    <p style="text-align: center; font-size: 18px; font-weight: bold;">${title}</p>
    <p class="badge-question-text" style="text-align: center; margin: 15px 0;">${badge.question || ''}</p>
    <p class="muted" style="text-align: center; font-size: 12px;">Réponse actuelle : ${oldAnswer || 'Aucune'}</p>
    <form id="modify-badge-form" class="auth-form" style="margin-top: 15px;">
      <label>Nouvelle réponse</label>
      ${formContent}
      <button type="submit" class="primary">Modifier</button>
    </form>
    <p id="modify-badge-message" class="message" style="text-align: center;"></p>
  `;
  
  els.badgeQuestionContainer.classList.remove('hidden');
  
  // Attacher les événements pour les boutons boolean
  if (config?.type === 'boolean') {
    const hiddenInput = card.querySelector('input[name="answer"]');
    const boolBtns = card.querySelectorAll('.bool-btn');
    boolBtns.forEach(btn => {
        btn.addEventListener('click', () => {
        if (hiddenInput) hiddenInput.value = btn.getAttribute('data-bool') || '';
        boolBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        });
      });
    }
  
  // Attacher le gestionnaire de soumission
  const form = card.querySelector('#modify-badge-form');
  const messageEl = card.querySelector('#modify-badge-message');
  
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Récupérer la réponse
    let newAnswer = '';
    if (config?.type === 'multiSelect') {
      const select = form.querySelector('select[name="answer-select"]');
      if (select) {
        newAnswer = Array.from(select.selectedOptions).map(o => o.value).join(', ');
      }
    } else if (config?.type === 'singleSelect') {
      const select = form.querySelector('select[name="answer-single"]');
      if (select) newAnswer = select.value;
    } else if (config?.type === 'boolean') {
      const hidden = form.querySelector('input[name="answer"]');
      if (hidden) newAnswer = hidden.value;
    } else if (config?.type === 'range') {
      const input = form.querySelector('input[type="number"]');
      if (input) newAnswer = input.value;
    } else {
      const textarea = form.querySelector('textarea[name="answer"]');
      if (textarea) newAnswer = textarea.value.trim();
    }
    
    if (!newAnswer) {
      messageEl.textContent = 'Entre une réponse.';
      messageEl.classList.add('error');
      return;
    }
    
    // Évaluer la nouvelle réponse
    const selectedOptions = config?.type === 'multiSelect' ? newAnswer.split(', ') : [];
    const result = evaluateBadgeAnswer(badge, newAnswer, selectedOptions);
    
    if (result.ok) {
      // Nouvelle réponse correcte
      const newLevel = result.level || null;
      
      // Comparer les niveaux pour voir si c'est une amélioration
      const levelOrder = ['Skill 1', 'Skill 2', 'Skill 3', 'Skill max', 'Expert'];
      const oldLevelIndex = oldLevel ? levelOrder.indexOf(oldLevel) : -1;
      const newLevelIndex = newLevel ? levelOrder.indexOf(newLevel) : -1;
      
      if (newLevelIndex > oldLevelIndex || !oldLevel) {
        // Amélioration ! Mettre à jour
        const { error } = await supabase.from('user_badges').upsert({
          user_id: state.user.id,
          badge_id: badge.id,
          success: true,
          level: newLevel,
          user_answer: newAnswer,
          was_ever_unlocked: true
        });
        
        if (!error) {
          state.userBadgeLevels.set(badge.id, newLevel);
          state.userBadgeAnswers.set(badge.id, newAnswer);
          messageEl.textContent = `🎉 Niveau amélioré : ${newLevel || 'Débloqué'} !`;
          messageEl.classList.remove('error');
          messageEl.classList.add('success');
        }
      } else {
        // Pas d'amélioration, garder l'ancien niveau
        messageEl.textContent = `Ta réponse est correcte mais n'améliore pas ton niveau actuel (${oldLevel}).`;
        messageEl.classList.remove('error');
      }
    } else {
      // Réponse incorrecte - garder l'ancien état
      messageEl.textContent = `Réponse incorrecte. Ton badge reste à ${oldLevel || 'débloqué'}.`;
      messageEl.classList.add('error');
    }
    
    state.badgeQuestionAnswered = true;
    attachBadgeQuestionCloseHandler();
    
    // Re-rendre les badges après un délai
    setTimeout(() => {
      closeBadgeQuestion();
      renderMyBadges();
    }, 2500);
  });
  
  // Attacher le gestionnaire de fermeture
  attachBadgeQuestionCloseHandler();
}

function renderMyBadges() {
  // On affiche uniquement les badges qui ont été répondu (débloqués, bloqués, ou rebloqués)
  // Les badges jamais répondu ne sont pas affichés
  if (!els.myBadgesList) {
    console.error('❌ els.myBadgesList n\'existe pas !');
    return;
  }
  
  const allBadges = state.badges.slice();
  console.log(`🔍 renderMyBadges: ${allBadges.length} badges au total`);
  
  if (!allBadges.length) {
    els.myBadgesList.innerHTML = '<p class="muted">Aucun badge pour le moment. Vérifiez que la table "badges" existe dans Supabase et contient des données.</p>';
    return;
  }
  
  // Si mode modification actif, afficher un message d'instruction
  if (state.isModifyingBadge) {
    // Afficher un bandeau d'instruction
    const existingBanner = document.getElementById('modify-badge-banner');
    if (!existingBanner) {
      const banner = document.createElement('div');
      banner.id = 'modify-badge-banner';
      banner.className = 'modify-badge-banner';
      banner.innerHTML = `
        <p>🃏 Clique sur un badge pour modifier ta réponse</p>
        <button id="cancel-modify-badge" class="ghost">Annuler</button>
      `;
      els.myBadgesList.parentElement.insertBefore(banner, els.myBadgesList);
      
      banner.querySelector('#cancel-modify-badge').addEventListener('click', () => {
        state.isModifyingBadge = false;
        banner.remove();
        renderMyBadges();
    });
    }
  } else {
    // Supprimer le bandeau s'il existe
    const existingBanner = document.getElementById('modify-badge-banner');
    if (existingBanner) {
      existingBanner.remove();
  }
}

  // Filtrer les badges : afficher tous les badges débloqués ET tous les badges qui ont été répondu
  const visibleBadges = allBadges.filter(badge => {
    const unlocked = state.userBadges.has(badge.id);
    const userAnswer = state.userBadgeAnswers.get(badge.id);
    const hasAnswer = userAnswer !== undefined && userAnswer !== null;
    const wasEverUnlocked = state.wasEverUnlocked.has(badge.id);
    const isBlocked = !unlocked && hasAnswer;
    const isReblocked = isBlocked && wasEverUnlocked;
    // Afficher si débloqué OU si une réponse a été donnée (même si bloqué)
    return unlocked || hasAnswer;
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
      
      // Ajouter une classe spéciale si le mode modification est actif
      if (state.isModifyingBadge && unlocked) {
        card.classList.add('modifiable');
      }
      
      card.addEventListener('click', (e) => {
        const tag = e.target.tagName.toLowerCase();
        if (tag === 'input' || tag === 'button' || e.target.closest('form')) return;
        
        // Si mode modification actif et badge débloqué, ouvrir le formulaire de modification
        if (state.isModifyingBadge && unlocked) {
          handleModifyBadgeAnswer(badge);
          return;
        }
        
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
    item.dataset.isPrivate = (profile.is_private === true || profile.is_private === 'true') ? 'true' : 'false';
    // Toujours calculer le rang depuis les skill points (pour avoir les nouveaux noms)
    const rankMeta = getRankMeta(profile.skill_points ?? 0);
    const displayRank = rankMeta.name;
    item.dataset.rank = displayRank;
    const rankText = formatRankText(displayRank);
    const rankStyle = rankMeta.isGold ? '' : `style="color: ${rankMeta.color} !important"`;
    const rankClass = rankMeta.isGold ? 'rank-gold' : 'muted';
    item.innerHTML = `
      <div class="community-profile-header">
        <img src="${avatarUrl}" alt="Avatar" class="logo small avatar">
        <div>
          <strong>${profile.username}</strong>
          <p class="${rankClass}" ${rankStyle}>${rankText}</p>
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

async function handleBadgeAnswer(event, badge, providedAnswer = null, feedbackElement = null, cardElement = null, returnValidationStatus = false) {
  event.preventDefault();
  const localMode = isLocalBadgesMode();
  if (!state.user && !localMode) {
    if (returnValidationStatus) return false;
    return setMessage('Connecte-toi pour gagner des badges.', true);
  }
  if (localMode && !state.user) {
    // User local par défaut pour stocker en localStorage
    state.user = { id: 'local-user', username: 'Local user' };
  }
  const form = event.target;
  const config = parseConfig(badge.answer);
  const isMultiSelect = config?.type === 'multiSelect';
  const isSingleSelect = config?.type === 'singleSelect';
  const isRange = config?.type === 'range';
  
  // Définir feedback au début pour qu'il soit accessible partout
  // Priorité : feedbackElement (depuis la carte) > els.badgeAnswerMessage (roue) > form.querySelector (formulaire)
  const feedback = feedbackElement || els.badgeAnswerMessage || (form ? form.querySelector('.message') : null);
  if (feedback) feedback.textContent = '';
  
  // Si une réponse est fournie (depuis la roue), l'utiliser directement
  let answer = providedAnswer;
  let rawAnswer = answer;
  let selectedOptions = [];
  
  if (!answer) {
  const selectInput = isMultiSelect ? form.querySelector('select[name="answer-select"]') : null;
  const checkboxInputs = isMultiSelect ? form.querySelectorAll('input[name="answer-option"]:checked') : null;
  const singleSelectInput = isSingleSelect ? form.querySelector('select[name="answer-single"]') : null;
    const rangeInput = isRange ? form.querySelector('input[type="number"]') : null;
    const answerInput = (isMultiSelect || isSingleSelect || isRange) ? null : form.querySelector('input[name="answer"], textarea[name="answer"]');
    const isBoolean = config?.type === 'boolean';
    const hiddenBooleanInput = isBoolean ? form.querySelector('input[type="hidden"][name="answer"]') : null;
    
    // ÉTAT 1 : Champ libre (aucune réponse fournie)
    // Vérifier que l'utilisateur a fourni une réponse AVANT de traiter les valeurs
    // Si aucune réponse n'est fournie, retourner immédiatement sans rien faire
    if (isMultiSelect) {
      const hasSelected = selectInput
        ? (selectInput.selectedOptions && selectInput.selectedOptions.length > 0)
        : (checkboxInputs && checkboxInputs.length > 0);
      if (!hasSelected) {
        if (returnValidationStatus) return false;
        return; // ÉTAT 1 : Champ libre - Ne rien faire si aucune option n'est sélectionnée
      }
    } else if (isSingleSelect) {
      if (!singleSelectInput || !singleSelectInput.value) {
        if (returnValidationStatus) return false;
        return; // ÉTAT 1 : Champ libre - Ne rien faire si aucune option n'est choisie
      }
    } else if (isRange) {
      if (!rangeInput || !rangeInput.value) {
        if (returnValidationStatus) return false;
        return; // ÉTAT 1 : Champ libre - Ne rien faire si aucune valeur n'est sélectionnée
      }
    } else if (isBoolean) {
      if (!hiddenBooleanInput || !hiddenBooleanInput.value) {
        if (returnValidationStatus) return false;
        return; // ÉTAT 1 : Champ libre - Ne rien faire si Oui ou Non n'est pas sélectionné
      }
    } else {
      // Badge texte
      if (!answerInput || !answerInput.value || !answerInput.value.trim()) {
        if (returnValidationStatus) return false;
        return; // ÉTAT 1 : Champ libre - Ne rien faire si la réponse est vide
      }
    }
    
    // Maintenant qu'on sait qu'une réponse existe, extraire les valeurs
    selectedOptions = isMultiSelect
    ? (
        selectInput
          ? Array.from(selectInput.selectedOptions || []).map(o => o.value)
          : Array.from(checkboxInputs || []).map(el => el.value)
      )
    : [];
    
    rawAnswer = isMultiSelect
    ? selectedOptions.join(', ')
      : (isSingleSelect ? (singleSelectInput?.value || '') 
        : (isRange ? (rangeInput ? String(rangeInput.value) : '') 
          : (isBoolean ? (hiddenBooleanInput?.value || '')
            : (answerInput?.value.trim() || ''))));
  }

  const result = evaluateBadgeAnswer(badge, rawAnswer, selectedOptions);
  if (!result.ok) {
    // ÉTAT 2 : Badge bloqué (répondu mais non débloqué)
    // On enregistre aussi l'échec avec niveau 0 (badge bloqué)
    const level0 = 'niv 0'; // Niveau 0 = badge bloqué = 0 point
    const isFromWheel = state.badgesFromWheel.has(badge.id);
    const isRetry = state.isRetryBadge && state.retryBadgeId === badge.id;
    
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
    
    // Gestion de badgesFromWheel :
    // - Si c'est un retry et que le badge échoue, le retirer de badgesFromWheel (retour dans la roue)
    // - Si c'est une première réponse depuis la roue et que ça échoue, garder dans badgesFromWheel (section retenter)
    if (isRetry) {
      // Retirer de badgesFromWheel pour qu'il retourne dans la roue
      state.badgesFromWheel.delete(badge.id);
      // Sauvegarder dans la base de données
      await saveBadgesFromWheel();
      // Afficher le message de retour dans la roue
      if (feedback) {
        feedback.textContent = 'Badge non débloqué, retourné dans la roue.';
        feedback.classList.add('error');
      }
      // Mettre à jour l'affichage
      // Si on est dans une carte, masquer le formulaire et réafficher le bouton retenter
      if (cardElement) {
        const questionContainer = cardElement.querySelector('.blocked-badge-question-container');
        const retryBtn = cardElement.querySelector('.retry-badge-btn');
        const answerDiv = cardElement.querySelector('.blocked-badge-answer');
        if (questionContainer) questionContainer.classList.add('hidden');
        if (retryBtn) retryBtn.style.display = 'block';
        if (answerDiv) answerDiv.style.display = 'block';
      }
      // Mettre à jour la roue et les badges bloqués IMMÉDIATEMENT
      renderWheelBadges();
      renderBlockedBadges();
    } else if (isFromWheel) {
      // Première réponse depuis la roue qui échoue : garder dans badgesFromWheel pour la section retenter
      // Sauvegarder dans la base de données pour s'assurer qu'il est bien stocké
      await saveBadgesFromWheel();
    }
    
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
    
    // Retourner true si on demande le statut de validation (même en cas d'échec, une réponse valide a été donnée)
    if (returnValidationStatus) {
      return true;
    }
    return;
  }

  // ÉTAT 3 : Badge validé (débloqué)
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
  
  // Si le badge provient de la roue et est débloqué, le retirer de badgesFromWheel
  if (state.badgesFromWheel.has(badge.id)) {
    state.badgesFromWheel.delete(badge.id);
    // Sauvegarder dans la base de données
    await saveBadgesFromWheel();
  }
  
  // Si on est dans une carte, masquer le formulaire et mettre à jour l'affichage
  if (cardElement) {
    const questionContainer = cardElement.querySelector('.blocked-badge-question-container');
    if (questionContainer) {
      questionContainer.classList.add('hidden');
      questionContainer.innerHTML = '';
    }
    // Afficher le message de succès dans la carte
    if (feedback) {
      feedback.textContent = result.message || '🎉 Badge débloqué !';
      feedback.classList.remove('error');
      feedback.classList.add('success');
    }
    // Mettre à jour la roue immédiatement
    renderWheelBadges();
    // Re-rendre les badges bloqués après un délai (pour laisser voir le message de succès)
    setTimeout(() => {
      renderBlockedBadges();
    }, 2000);
  }
  
  await updateCounters(false);
  // Synchroniser les badges fantômes après avoir débloqué / rebloqué un badge
  await syncGhostBadges();
  
  // Ne pas afficher de message ici si on vient de la roue (handleBadgeAnswerFromWheel gère l'affichage)
  // Seulement afficher pour les autres cas (badges normaux, pas depuis la roue)
  if (feedback && !cardElement && !returnValidationStatus) {
  feedback.textContent = result.message || 'Bravo, badge gagné !';
  feedback.classList.remove('error');
  }
  
  render();
  
  // Retourner true si on demande le statut de validation (pour la roue) - une réponse valide a été traitée
  if (returnValidationStatus) {
    return true;
  }
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

    // Règle "bloquer" valable pour TOUS les multi-select
    // Format admin : "valeur|bloquer" pour bloquer le badge
    if (config.optionSkills && typeof config.optionSkills === 'object') {
      for (const val of selectedOptions) {
        const key = String(val);
        const hasKey = Object.prototype.hasOwnProperty.call(config.optionSkills, key);
        if (!hasKey) continue;
        const lbl = (config.optionSkills[key] ?? '').toString().trim();
        // "bloquer" = le badge n'est pas débloqué, va dans "badges à retenter"
        if (lbl.toLowerCase() === 'bloquer') {
          return { ok: false, message: 'Ce choix ne permet pas de débloquer ce badge.' };
        }
      }
    }

    // Mode 1 (nouveau) : le niveau dépend des options cochées
    if (config.multiSkillMode === 'option' && config.optionSkills && typeof config.optionSkills === 'object') {
      // Si une option est configurée comme "bloquer", le badge n'est pas débloqué
      for (const val of selectedOptions) {
        const key = String(val);
        const hasKey = Object.prototype.hasOwnProperty.call(config.optionSkills, key);
        if (!hasKey) continue;
        const lbl = (config.optionSkills[key] ?? '').toString().trim();
        // "bloquer" = le badge n'est pas débloqué
        if (lbl.toLowerCase() === 'bloquer') return { ok: false, message: 'Ce choix ne permet pas de débloquer ce badge.' };
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
    // Vérifier si l'option bloque le badge
    if (config.optionSkills && typeof config.optionSkills === 'object') {
      const key = String(value);
      const hasKey = Object.prototype.hasOwnProperty.call(config.optionSkills, key);
      if (hasKey) {
        // "bloquer" = le badge n'est pas débloqué, va dans "badges à retenter"
        if (skillLabel.toLowerCase() === 'bloquer') {
        return { ok: false, message: 'Ce choix ne permet pas de débloquer ce badge.' };
      }
      }
      // Si l'option n'a pas de skill défini, on débloque quand même avec le skill par défaut
    }
    const storedLabel = skillLabel && skillLabel.toLowerCase() !== 'bloquer' 
      ? (isMysteryLevel(skillLabel) ? 'Expert' : skillLabel) 
      : null;
    return { ok: true, level: storedLabel, message: 'Bravo, badge débloqué !' };
  }

  if (config && config.type === 'range') {
    const value = Number(rawAnswer);
    if (Number.isNaN(value)) {
      return { ok: false, message: 'Merci de saisir un nombre.' };
    }
    
    // Si des levels sont définis, chercher le niveau correspondant
    if (Array.isArray(config.levels) && config.levels.length > 0) {
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
    
    // Si pas de levels définis, vérifier simplement que la valeur est dans la plage [min, max]
    const minVal = config.min ?? -Infinity;
    const maxVal = config.max ?? Infinity;
    if (value < minVal || value > maxVal) {
      return { ok: false, message: `La valeur doit être entre ${minVal} et ${maxVal}.` };
    }
    
    // Si une valeur attendue spécifique est définie, la vérifier
    if (config.expected !== undefined) {
      if (value === Number(config.expected)) {
        return { ok: true, level: null, message: 'Bravo, badge débloqué !' };
      }
      return { ok: false, message: 'Réponse incorrecte.' };
    }
    
    // Si aucune valeur attendue, accepter n'importe quelle valeur dans la plage
    return { ok: true, level: null, message: 'Bravo, badge débloqué !' };
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
    if (isHidden) {
      openProfileDrawer();
    } else {
      closeProfileDrawer();
    }
  });

  // Fermer avec la croix
  if (els.profileCloseBtn) {
    els.profileCloseBtn.addEventListener('click', closeProfileDrawer);
  }

  // Fermer en cliquant sur l'overlay
  if (els.profileOverlay) {
    els.profileOverlay.addEventListener('click', closeProfileDrawer);
  }

  // Afficher l'infobulle au clic sur le champ pseudo
  if (els.profileName && els.profileNameTooltip) {
    els.profileName.addEventListener('click', () => {
      els.profileNameTooltip.classList.remove('hidden');
      // Masquer l'infobulle après 3 secondes
      setTimeout(() => {
        if (els.profileNameTooltip) {
          els.profileNameTooltip.classList.add('hidden');
        }
      }, 3000);
    });

    // Masquer l'infobulle si on clique ailleurs
    document.addEventListener('click', (e) => {
      if (els.profileNameTooltip && !els.profileName.contains(e.target) && !els.profileNameTooltip.contains(e.target)) {
        els.profileNameTooltip.classList.add('hidden');
      }
    });
  }

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
    closeProfileDrawer();
  }
  await fetchCommunity(); // rafraîchit l’onglet communauté pour afficher l’avatar
}

function setProfileMessage(text, isError = false) {
  if (!els.profileMessage) return;
  els.profileMessage.textContent = text;
  els.profileMessage.classList.toggle('error', isError);
}

function updateAvatar(url, targetElement = null) {
  const finalUrl = url || './icons/logobl.png';
  if (targetElement) {
    targetElement.src = finalUrl;
    targetElement.style.objectFit = 'cover';
    targetElement.style.borderRadius = '50%';
  } else {
    if (els.avatarImg) {
      els.avatarImg.src = finalUrl;
      els.avatarImg.style.objectFit = 'cover';
      els.avatarImg.style.borderRadius = '50%';
    }
    if (els.avatarPreviewImg) {
      els.avatarPreviewImg.src = finalUrl;
    }
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
  
  // Mettre à jour l'indicateur de confidentialité
  const isPrivate = data.isPrivate === 'true' || data.isPrivate === true;
  const indicator = document.getElementById('community-profile-privacy-indicator');
  if (indicator) {
    // Ne garder que le point de couleur, pas le texte
    indicator.textContent = '';
    indicator.style.background = isPrivate ? '#ef4444' : '#22c55e';
    indicator.style.display = 'inline-block'; // S'assurer qu'il est visible
  }
  
  if (els.communityProfileRank) {
    // Toujours calculer le rang depuis les skill points (pour avoir les nouveaux noms)
    els.communityProfileRank.textContent = formatRankText(rankMeta.name);
    els.communityProfileRank.classList.remove('rank-gold');
    if (rankMeta.isGold) {
      els.communityProfileRank.classList.add('rank-gold');
      els.communityProfileRank.style.color = '';
    } else {
      els.communityProfileRank.style.color = rankMeta.color || 'inherit';
    }
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
  if (!els.authView || !els.appView) return;
  // Utiliser remove/add au lieu de toggle pour être plus explicite
  if (authenticated) {
    els.authView.classList.add('hidden');
    els.appView.classList.remove('hidden');
  } else {
    els.authView.classList.remove('hidden');
    els.appView.classList.add('hidden');
  }
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
  
  // Les éléments du header ont été supprimés, on met à jour uniquement ceux qui existent
  if (els.badgeCount) {
    els.badgeCount.innerHTML = `${badgeCount} <span class="badge-total">/ ${totalBadges}</span>`;
  }
  if (els.skillCount) els.skillCount.textContent = `${totalSkillPoints}`;
  state.currentSkillPoints = totalSkillPoints;
  
  // Rang (uniquement si l'élément existe, car le header a été supprimé)
  const rankMeta = getRankMeta(totalSkillPoints);
  if (els.profileRank) {
    els.profileRank.textContent = formatRankText(rankMeta.name);
    els.profileRank.classList.remove('rank-gold');
    if (rankMeta.isGold) {
      els.profileRank.classList.add('rank-gold');
      els.profileRank.style.color = '';
    } else {
      els.profileRank.style.color = rankMeta.color || 'inherit';
    }
  }

  // Mettre à jour les infos du profil dans la section "Mon profil"
  if (els.profileSectionUsername && state.profile) {
    els.profileSectionUsername.textContent = state.profile.username || 'Utilisateur';
  }
  if (els.profileSectionBadgeCount) {
    // Calculer le total de badges (même logique que dans updateCounters)
    let totalBadges = 0;
    const allBadges = state.badges || [];
    allBadges.forEach(badge => {
      if (!isGhostBadge(badge)) {
        // Badge normal : toujours compté
        totalBadges++;
      }
    });
    // Afficher le nombre de badges avec le total (ex: "5 / 43")
    els.profileSectionBadgeCount.innerHTML = `${badgeCount}<span class="badge-total"> / ${totalBadges}</span>`;
  }
  if (els.profileSectionSkillCount) {
    els.profileSectionSkillCount.textContent = totalSkillPoints;
  }
  if (els.profileSectionRank) {
    els.profileSectionRank.textContent = formatRankText(rankMeta.name);
    els.profileSectionRank.classList.remove('rank-gold');
    if (rankMeta.isGold) {
      els.profileSectionRank.classList.add('rank-gold');
      els.profileSectionRank.style.color = '';
    } else {
      els.profileSectionRank.style.color = rankMeta.color || 'inherit';
    }
  }
  if (els.profileSectionAvatar && state.profile) {
    updateAvatar(state.profile.avatar_url, els.profileSectionAvatar);
  }

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

// ========== SYSTÈME DE FIDÉLITÉ / CALENDRIER ==========

// Retourne le lundi de la semaine pour une date donnée
function getWeekStartDate(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0 = dimanche, 1 = lundi, etc.
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Ajuster pour que lundi = 1
  const monday = new Date(d.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  return monday;
}

// Charge les jours de connexion depuis le profil
async function loadConnectionDays() {
  if (!state.profile) return;
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const currentWeekStart = getWeekStartDate(today);
  const currentWeekStartStr = currentWeekStart.toISOString().split('T')[0];
  
  // Si on a une semaine enregistrée et que c'est une nouvelle semaine, réinitialiser
  if (state.profile.week_start_date) {
    const savedWeekStart = new Date(state.profile.week_start_date + 'T00:00:00');
    const savedWeekStartStr = savedWeekStart.toISOString().split('T')[0];
    
    if (savedWeekStartStr !== currentWeekStartStr) {
      // Nouvelle semaine : réinitialiser les jours de connexion ET les jetons récupérés
      state.connectionDays = [];
      state.claimedDailyTokens = [];
      state.weekBonusClaimed = false;
      state.weekStartDate = currentWeekStartStr;
      state.profile.connection_days = [];
      state.profile.claimed_daily_tokens = [];
      state.profile.week_bonus_claimed = false;
      state.profile.week_start_date = currentWeekStartStr;
      
      // Sauvegarder dans Supabase (les jetons non récupérés sont perdus)
      await supabase
        .from('profiles')
        .update({ 
          connection_days: [],
          claimed_daily_tokens: [],
          week_bonus_available: false,
          week_bonus_claimed: false,
          week_start_date: currentWeekStartStr
        })
        .eq('id', state.user.id);
    } else {
      // Même semaine : charger les jours existants
      state.connectionDays = Array.isArray(state.profile.connection_days) 
        ? state.profile.connection_days 
        : [];
      state.weekStartDate = state.profile.week_start_date || currentWeekStartStr;
    }
  } else {
    // Pas de semaine enregistrée : initialiser
    state.connectionDays = [];
    state.claimedDailyTokens = [];
    state.weekBonusClaimed = false;
    state.weekStartDate = currentWeekStartStr;
    state.profile.connection_days = [];
    state.profile.claimed_daily_tokens = [];
    state.profile.week_bonus_claimed = false;
    state.profile.week_start_date = currentWeekStartStr;
  }
  
  // Charger les jetons récupérés depuis le profil
  if (!state.profile.claimed_daily_tokens) {
    state.profile.claimed_daily_tokens = [];
  }
  state.claimedDailyTokens = Array.isArray(state.profile.claimed_daily_tokens)
    ? state.profile.claimed_daily_tokens
    : [];
  
  // Si la colonne n'existe pas dans la base, charger depuis localStorage comme backup
  if (state.claimedDailyTokens.length === 0 && state.user) {
    try {
      const stored = localStorage.getItem(`claimed_tokens_${state.user.id}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          state.claimedDailyTokens = parsed;
          state.profile.claimed_daily_tokens = parsed;
        }
      }
    } catch (e) {
      console.warn('Erreur lors du chargement depuis localStorage:', e);
    }
  }
  
  state.weekBonusClaimed = Boolean(state.profile.week_bonus_claimed);
  
  // Vérifier si le bonus est disponible (non réclamé)
  state.canClaimBonus = state.connectionDays.length === 7 && !state.weekBonusClaimed;
  
  console.log('loadConnectionDays - État chargé:', {
    connectionDays: state.connectionDays,
    claimedDailyTokens: state.claimedDailyTokens,
    weekBonusClaimed: state.weekBonusClaimed,
    canClaimBonus: state.canClaimBonus
  });
  
  // Rendre le calendrier
  renderCalendar();
  updateCalendarBadge();
}

// Vérifie et met à jour le jour de connexion
async function checkAndUpdateConnectionDay() {
  if (!state.user || !state.profile) return;
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split('T')[0];
  const currentWeekStart = getWeekStartDate(today);
  const currentWeekStartStr = currentWeekStart.toISOString().split('T')[0];
  
  // Vérifier si on est dans une nouvelle semaine
  if (state.weekStartDate !== currentWeekStartStr) {
    // Nouvelle semaine : réinitialiser
    state.connectionDays = [];
    state.claimedDailyTokens = [];
    state.weekBonusClaimed = false;
    state.weekStartDate = currentWeekStartStr;
    state.profile.connection_days = [];
    state.profile.claimed_daily_tokens = [];
    state.profile.week_bonus_claimed = false;
    state.profile.week_start_date = currentWeekStartStr;
  }
  
  // Ajouter la date d'aujourd'hui si pas déjà présente
  if (!state.connectionDays.includes(todayStr)) {
    state.connectionDays.push(todayStr);
    state.profile.connection_days = [...state.connectionDays];
    
    // Vérifier si tous les 7 jours sont connectés
    if (state.connectionDays.length === 7) {
      // Tous les jours sont connectés : rendre le bonus disponible
      state.canClaimBonus = true;
      state.profile.week_bonus_available = true;
    }
    
    // Sauvegarder dans Supabase
    await supabase
      .from('profiles')
      .update({ 
        connection_days: state.connectionDays,
        week_start_date: currentWeekStartStr,
        week_bonus_available: state.profile.week_bonus_available
      })
      .eq('id', state.user.id);
    
    // Rendre le calendrier
    renderCalendar();
    updateCalendarBadge();
  }
}

// Rend le calendrier des 7 jours
function renderCalendar() {
  if (!els.calendarWeek) return;
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split('T')[0];
  const currentWeekStart = getWeekStartDate(today);
  
  const dayNames = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  const days = [];
  
  // Vérifier si tous les jours sont connectés pour le bonus hebdomadaire
  const allDaysConnected = state.connectionDays.length === 7;
  const isSunday = (dayIndex) => dayIndex === 6; // Dimanche est le 7ème jour (index 6)
  
  // Générer les 7 jours de la semaine (lundi à dimanche)
  for (let i = 0; i < 7; i++) {
    const day = new Date(currentWeekStart);
    day.setDate(currentWeekStart.getDate() + i);
    const dayStr = day.toISOString().split('T')[0];
    const isConnected = state.connectionDays.includes(dayStr);
    const isClaimed = state.claimedDailyTokens.includes(dayStr);
    const isToday = dayStr === todayStr;
    
    // Déterminer l'état du jour
    let dayState = 'not-available'; // Par défaut : non disponible
    let clickable = false;
    let tokenInfo = '';
    
    if (isConnected) {
      if (isClaimed) {
        dayState = 'claimed'; // Déjà récupéré
        clickable = false;
        tokenInfo = '✓ Récupéré';
      } else {
        dayState = 'available'; // Disponible pour récupération
        clickable = true;
        tokenInfo = '🪙 +2';
      }
    } else {
      dayState = 'not-available'; // Pas de connexion ce jour
      clickable = false;
      tokenInfo = '';
    }
    
    // Pour le dimanche : vérifier le bonus hebdomadaire (priorité sur les jetons journaliers)
    if (isSunday(i) && allDaysConnected) {
      if (state.weekBonusClaimed) {
        dayState = 'bonus-claimed';
        clickable = false;
        tokenInfo = '✓ Bonus récupéré';
      } else {
        // Bonus disponible (remplace les jetons journaliers du dimanche)
        dayState = 'bonus-available';
        clickable = true;
        tokenInfo = '🪙 +3 bonus';
      }
    }
    
    days.push({
      name: dayNames[i],
      date: day.getDate(),
      dateStr: dayStr,
      connected: isConnected,
      state: dayState,
      clickable: clickable,
      tokenInfo: tokenInfo,
      isToday: isToday
    });
  }
  
  // Générer le HTML avec les états et les clics
  els.calendarWeek.innerHTML = days.map(day => `
    <div class="calendar-day ${day.state} ${day.clickable ? 'clickable' : ''} ${day.isToday ? 'today' : ''}" 
         ${day.clickable ? `data-day="${day.dateStr}"` : ''}>
      <span class="calendar-day-name">${day.name}</span>
      <span class="calendar-day-date">${day.date}</span>
      <span class="calendar-day-icon">${day.connected ? '✓' : '✗'}</span>
      ${day.tokenInfo ? `<span class="calendar-day-tokens">${day.tokenInfo}</span>` : ''}
    </div>
  `).join('');
  
  // Utiliser la délégation d'événements pour éviter les problèmes de duplication
  // Supprimer l'ancien gestionnaire d'événements s'il existe
  if (els.calendarWeek._clickHandler) {
    els.calendarWeek.removeEventListener('click', els.calendarWeek._clickHandler);
  }
  
  // Créer un nouveau gestionnaire d'événements
  els.calendarWeek._clickHandler = (e) => {
    const dayEl = e.target.closest('.calendar-day.clickable');
    if (!dayEl) return;
    
    e.stopPropagation();
    const dayStr = dayEl.getAttribute('data-day');
    console.log('Clic sur jour:', dayStr);
    
    if (dayStr) {
      const dayData = days.find(d => d.dateStr === dayStr);
      console.log('Données du jour:', dayData);
      if (dayData) {
        if (dayData.state === 'bonus-available') {
          console.log('Récupération du bonus hebdomadaire');
          handleClaimBonus();
        } else if (dayData.state === 'available') {
          console.log('Récupération des jetons journaliers pour:', dayStr);
          claimDailyTokens(dayStr);
        }
      }
    }
  };
  
  // Attacher le gestionnaire d'événements au conteneur
  els.calendarWeek.addEventListener('click', els.calendarWeek._clickHandler);
  
  // Cacher le bouton bonus (maintenant intégré dans la case du dimanche)
  if (els.claimBonusBtn) {
    els.claimBonusBtn.classList.add('hidden');
  }
}

// Récupère les jetons journaliers pour un jour spécifique
async function claimDailyTokens(dayStr) {
  console.log('claimDailyTokens appelé pour:', dayStr);
  console.log('State:', { 
    user: !!state.user, 
    profile: !!state.profile,
    connectionDays: state.connectionDays,
    claimedDailyTokens: state.claimedDailyTokens,
    tokens: state.tokens
  });
  
  if (!state.user || !state.profile) {
    console.warn('Utilisateur ou profil non disponible');
    return;
  }
  
  // Vérifier que le jour est disponible (connecté et pas déjà récupéré)
  if (!state.connectionDays || !state.connectionDays.includes(dayStr)) {
    console.warn('Jour non connecté, impossible de récupérer les jetons. Jour:', dayStr, 'Jours connectés:', state.connectionDays);
    return;
  }
  
  if (!state.claimedDailyTokens) {
    state.claimedDailyTokens = [];
  }
  
  if (state.claimedDailyTokens.includes(dayStr)) {
    console.warn('Jetons déjà récupérés pour ce jour');
    return;
  }
  
  // Ajouter 2 jetons
  const newTokens = (state.tokens || 0) + 2;
  
  // Mettre à jour les jetons récupérés
  const updatedClaimed = [...state.claimedDailyTokens, dayStr];
  
  console.log('Mise à jour des jetons:', { newTokens, updatedClaimed });
  
  // Mettre à jour dans Supabase
  const { error } = await supabase
    .from('profiles')
    .update({ 
      tokens: newTokens,
      claimed_daily_tokens: updatedClaimed
    })
    .eq('id', state.user.id);
  
  if (error) {
    console.error('Erreur lors de la réclamation des jetons journaliers:', error);
    // Si la colonne n'existe pas, essayer sans
    if (error.message && error.message.includes('claimed_daily_tokens')) {
      console.warn('Colonne claimed_daily_tokens absente dans la base de données. Veuillez exécuter le script SQL add_tokens_columns.sql pour ajouter cette colonne.');
      console.warn('En attendant, les jetons sont mis à jour mais les données de récupération sont stockées localement uniquement.');
      
      // Mettre à jour uniquement les jetons (sans la colonne claimed_daily_tokens)
      const { error: retryError } = await supabase
        .from('profiles')
        .update({ tokens: newTokens })
        .eq('id', state.user.id);
      
      if (!retryError) {
        // Mettre à jour localement même si la colonne n'existe pas
        state.tokens = newTokens;
        state.profile.tokens = newTokens;
        state.claimedDailyTokens = updatedClaimed;
        if (!state.profile.claimed_daily_tokens) {
          state.profile.claimed_daily_tokens = [];
        }
        state.profile.claimed_daily_tokens = updatedClaimed;
        
        // Stocker aussi dans localStorage comme backup (si la colonne n'existe pas)
        try {
          localStorage.setItem(`claimed_tokens_${state.user.id}`, JSON.stringify(updatedClaimed));
          console.log('Jetons sauvegardés dans localStorage comme backup');
        } catch (e) {
          console.warn('Impossible de stocker dans localStorage:', e);
        }
        
        // Animation sur la case du calendrier
        const dayEl = els.calendarWeek?.querySelector(`[data-day="${dayStr}"]`);
        if (dayEl) {
          createTokenClaimAnimation(dayEl, 2);
        }
        
        // Mettre à jour l'affichage
        updateTokensDisplay();
        renderCalendar();
        updateCalendarBadge();
        showTokenRewardNotification(2);
      } else {
        console.error('Erreur lors de la mise à jour des jetons:', retryError);
      }
    }
    return;
  }
  
  // Succès
  console.log('Jetons récupérés avec succès');
  state.tokens = newTokens;
  state.profile.tokens = newTokens;
  state.claimedDailyTokens = updatedClaimed;
  state.profile.claimed_daily_tokens = updatedClaimed;
  
  // Animation sur la case du calendrier
  const dayEl = els.calendarWeek?.querySelector(`[data-day="${dayStr}"]`);
  if (dayEl) {
    createTokenClaimAnimation(dayEl, 2);
  }
  
  // Mettre à jour l'affichage
  updateTokensDisplay();
  renderCalendar(); // Re-rendre pour mettre à jour l'état
  updateCalendarBadge(); // Mettre à jour la pastille du bouton calendrier
  
  // Afficher une notification
  showTokenRewardNotification(2);
}

// Gère la réclamation du bonus de 3 jetons (depuis la case du dimanche)
async function handleClaimBonus() {
  if (!state.user || !state.profile) return;
  
  // Vérifier que tous les jours sont connectés
  if (state.connectionDays.length !== 7) {
    console.warn('Tous les jours doivent être connectés pour récupérer le bonus');
    return;
  }
  
  // Vérifier que le bonus n'a pas déjà été récupéré
  if (state.weekBonusClaimed) {
    console.warn('Bonus déjà récupéré cette semaine');
    return;
  }
  
  // Trouver la date du dimanche de la semaine
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const currentWeekStart = getWeekStartDate(today);
  const sunday = new Date(currentWeekStart);
  sunday.setDate(currentWeekStart.getDate() + 6); // Dimanche est le 7ème jour
  const sundayStr = sunday.toISOString().split('T')[0];
  
  // Ajouter 3 jetons
  const newTokens = (state.tokens || 0) + 3;
  
  // Marquer le bonus comme récupéré et ajouter le dimanche aux jetons récupérés
  const updatedClaimed = [...state.claimedDailyTokens, sundayStr];
  
  // Mettre à jour dans Supabase
  const { error } = await supabase
    .from('profiles')
    .update({ 
      tokens: newTokens,
      week_bonus_available: false,
      week_bonus_claimed: true,
      claimed_daily_tokens: updatedClaimed
    })
    .eq('id', state.user.id);
  
  if (!error) {
    state.tokens = newTokens;
    state.profile.tokens = newTokens;
    state.canClaimBonus = false;
    state.weekBonusClaimed = true;
    state.profile.week_bonus_available = false;
    state.profile.week_bonus_claimed = true;
    state.claimedDailyTokens = updatedClaimed;
    state.profile.claimed_daily_tokens = updatedClaimed;
    
    // Animation sur la case du dimanche
    const sundayEl = els.calendarWeek?.querySelector(`[data-day="${sundayStr}"]`);
    if (sundayEl) {
      createTokenClaimAnimation(sundayEl, 3);
      createConfettiAnimation(sundayEl);
    }
    
    // Mettre à jour l'affichage
    updateTokensDisplay();
    updateCalendarBadge();
    renderCalendar(); // Re-rendre pour mettre à jour l'état
    
    // Afficher une notification
    showTokenRewardNotification(3, 'bonus');
  } else {
    console.error('Erreur lors de la réclamation du bonus:', error);
  }
}

// Crée une animation de confettis discrète sur un élément
function createConfettiAnimation(element) {
  if (!element) return;
  
  const rect = element.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  
  // Couleurs discrètes (violet clair et variations)
  const colors = [
    'rgba(139, 92, 246, 0.8)', // Violet clair
    'rgba(168, 85, 247, 0.8)', // Violet moyen
    'rgba(196, 181, 253, 0.8)', // Violet très clair
    'rgba(6, 182, 212, 0.6)', // Cyan discret
  ];
  
  // Créer 12 confettis discrets
  const confettiCount = 12;
  
  for (let i = 0; i < confettiCount; i++) {
    const confetti = document.createElement('div');
    confetti.className = 'confetti-particle';
    
    // Taille petite et discrète (4-6px)
    const size = Math.random() * 2 + 4;
    confetti.style.width = `${size}px`;
    confetti.style.height = `${size}px`;
    confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    confetti.style.position = 'fixed';
    confetti.style.left = `${centerX}px`;
    confetti.style.top = `${centerY}px`;
    confetti.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
    confetti.style.pointerEvents = 'none';
    confetti.style.zIndex = '10000';
    
    // Direction aléatoire
    const angle = (Math.PI * 2 * i) / confettiCount + (Math.random() - 0.5) * 0.5;
    const velocity = 30 + Math.random() * 20; // Vitesse modérée
    const distanceX = Math.cos(angle) * velocity;
    const distanceY = Math.sin(angle) * velocity;
    
    // Rotation aléatoire
    const rotation = Math.random() * 360;
    const rotationSpeed = (Math.random() - 0.5) * 360;
    
    document.body.appendChild(confetti);
    
    // Animation avec requestAnimationFrame pour fluidité
    let startTime = null;
    const duration = 1000; // 1 seconde
    
    function animate(timestamp) {
      if (!startTime) startTime = timestamp;
      const progress = (timestamp - startTime) / duration;
      
      if (progress < 1) {
        const easeOut = 1 - Math.pow(1 - progress, 3); // Easing doux
        const offsetX = distanceX * easeOut;
        const offsetY = distanceY * easeOut + (progress * progress * 50); // Légère gravité
        const currentRotation = rotation + rotationSpeed * progress;
        const currentOpacity = 1 - progress;
        
        confetti.style.transform = `translate(${offsetX}px, ${offsetY}px) rotate(${currentRotation}deg)`;
        confetti.style.opacity = currentOpacity;
        
        requestAnimationFrame(animate);
      } else {
        confetti.remove();
      }
    }
    
    requestAnimationFrame(animate);
  }
}

// Met à jour la pastille sur le bouton calendrier
function updateCalendarBadge() {
  // Mettre à jour le badge du bouton calendrier (dans le header)
  if (els.calendarBadge) {
    // Compter les jours avec des jetons disponibles mais non récupérés
    let availableTokensCount = 0;
    
    if (state.connectionDays && state.claimedDailyTokens) {
      // Compter les jours connectés mais non récupérés
      availableTokensCount = state.connectionDays.filter(dayStr => 
        !state.claimedDailyTokens.includes(dayStr)
      ).length;
    }
    
    // Ajouter 1 si le bonus hebdomadaire est disponible
    if (state.canClaimBonus && !state.weekBonusClaimed) {
      availableTokensCount += 1;
    }
    
    // Afficher la pastille s'il y a des jetons disponibles
    if (availableTokensCount > 0) {
      els.calendarBadge.textContent = availableTokensCount;
      els.calendarBadge.classList.remove('hidden');
    } else {
      els.calendarBadge.classList.add('hidden');
    }
  }
}

// Ouvre le panneau latéral du calendrier
function openCalendarDrawer() {
  if (!els.calendarDrawer || !els.calendarOverlay) return;
  
  els.calendarDrawer.classList.remove('hidden');
  els.calendarOverlay.classList.remove('hidden');
  
  // Rendre le calendrier pour s'assurer qu'il est à jour
  renderCalendar();
}

// Ferme le panneau latéral du calendrier
function closeCalendarDrawer() {
  if (!els.calendarDrawer || !els.calendarOverlay) return;
  
  els.calendarDrawer.classList.add('hidden');
  els.calendarOverlay.classList.add('hidden');
}

// Verrouiller l'orientation en mode portrait sur mobile
function lockOrientation() {
  // Utiliser l'API Screen Orientation si disponible
  if (screen.orientation && screen.orientation.lock) {
    screen.orientation.lock('portrait').catch(() => {
      // L'API peut échouer si elle n'est pas supportée ou si l'utilisateur l'a désactivée
      console.log('Lock orientation non disponible');
    });
  }
  
  // Écouter les changements d'orientation et afficher un message si nécessaire
  window.addEventListener('orientationchange', () => {
    if (window.orientation === 90 || window.orientation === -90) {
      // Mode paysage détecté
      console.log('Mode paysage détecté - veuillez tourner en mode portrait');
    }
  });
}

// Configuration du pull-to-refresh pour mobile
function setupPullToRefresh() {
  const pullToRefreshEl = document.getElementById('pull-to-refresh');
  if (!pullToRefreshEl || !els.appView) return;
  
  let startY = 0;
  let currentY = 0;
  let isPulling = false;
  let isRefreshing = false;
  const threshold = 80; // Distance en pixels pour déclencher le refresh
  
  const handleTouchStart = (e) => {
    // Ne fonctionne que si on est en haut de la page et pas en train de rafraîchir
    if (isRefreshing || window.scrollY > 10) return;
    
    startY = e.touches[0].clientY;
    isPulling = false;
  };
  
  const handleTouchMove = (e) => {
    if (isRefreshing) return;
    
    currentY = e.touches[0].clientY;
    const deltaY = currentY - startY;
    
    // Ne fonctionne que si on tire vers le bas depuis le haut
    if (deltaY > 0 && window.scrollY === 0) {
      isPulling = true;
      e.preventDefault();
      
      const pullDistance = Math.min(deltaY, threshold * 1.5);
      const progress = Math.min(pullDistance / threshold, 1);
      
      // Afficher l'indicateur
      pullToRefreshEl.classList.remove('hidden');
      pullToRefreshEl.style.transform = `translateX(-50%) translateY(${pullDistance - 100}px)`;
      pullToRefreshEl.style.opacity = progress;
      
      // Rotation du spinner basée sur la progression
      const spinner = pullToRefreshEl.querySelector('.pull-to-refresh-spinner');
      if (spinner) {
        spinner.style.transform = `rotate(${progress * 360}deg)`;
      }
      
      // Changer le texte si on dépasse le seuil
      const textEl = pullToRefreshEl.querySelector('.pull-to-refresh-text');
      if (textEl) {
        if (progress >= 1) {
          textEl.textContent = 'Relâcher pour actualiser';
        } else {
          textEl.textContent = 'Tirer pour actualiser';
        }
      }
    } else if (isPulling && deltaY <= 0) {
      // Réinitialiser si on remonte
      resetPullToRefresh();
    }
  };
  
  const handleTouchEnd = async (e) => {
    if (isRefreshing || !isPulling) {
      resetPullToRefresh();
      return;
    }
    
    const deltaY = currentY - startY;
    
    if (deltaY >= threshold) {
      // Déclencher le refresh
      isRefreshing = true;
      const textEl = pullToRefreshEl.querySelector('.pull-to-refresh-text');
      if (textEl) {
        textEl.textContent = 'Actualisation...';
      }
      
      // Animer le spinner
      const spinner = pullToRefreshEl.querySelector('.pull-to-refresh-spinner');
      if (spinner) {
        spinner.classList.add('spinning');
      }
      
      // Recharger les données
      try {
        await loadAppData();
      } catch (error) {
        console.error('Erreur lors du rafraîchissement:', error);
      }
      
      // Attendre un peu puis cacher l'indicateur
      setTimeout(() => {
        resetPullToRefresh();
        isRefreshing = false;
      }, 500);
    } else {
      resetPullToRefresh();
    }
  };
  
  const resetPullToRefresh = () => {
    isPulling = false;
    pullToRefreshEl.style.transform = '';
    pullToRefreshEl.style.opacity = '';
    pullToRefreshEl.classList.add('hidden');
    
    const spinner = pullToRefreshEl.querySelector('.pull-to-refresh-spinner');
    if (spinner) {
      spinner.style.transform = '';
      spinner.classList.remove('spinning');
    }
    
    const textEl = pullToRefreshEl.querySelector('.pull-to-refresh-text');
    if (textEl) {
      textEl.textContent = 'Tirer pour actualiser';
    }
  };
  
  // Ajouter les event listeners
  els.appView.addEventListener('touchstart', handleTouchStart, { passive: true });
  els.appView.addEventListener('touchmove', handleTouchMove, { passive: false });
  els.appView.addEventListener('touchend', handleTouchEnd, { passive: true });
}

