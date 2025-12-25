// App front-end de BadgeLife
// Utilise Supabase (base de données + auth) et une UI 100% front.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, ADMIN_USER_IDS } from './config.js';
import { isMysteryLevel } from './badgeCalculations.js';
import { parseBadgeAnswer, parseConfig, safeSupabaseSelect, pseudoToEmail, isAdminUser } from './utils.js';

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
  themesEnabled: false,
  selectedThemes: null, // null => aucun thème sélectionné (pas de filtre). Set non-vide => filtre.
  currentSkillPoints: 0, // calculé dans updateCounters
  realtimeChannel: null, // Canal Supabase Realtime
  failedBadgeId: null, // ID du badge qui vient d'échouer (pour afficher le message)
  tokens: 0, // Nombre de jetons de l'utilisateur
  selectedBadgeFromWheel: null, // Badge sélectionné par la roue
  selectedThemeFromWheel: null, // Thème sélectionné par la roue
  isWheelSpinning: false, // État de la roue (en train de tourner ou non)
  connectionDays: [], // Array des dates de connexion de la semaine
  weekStartDate: null, // Date du lundi de la semaine en cours
  canClaimBonus: false, // Si les 3 jetons bonus sont disponibles (non réclamés)
  claimedDailyTokens: [], // Array des dates où les jetons journaliers ont été récupérés
  weekBonusClaimed: false, // Si le bonus hebdomadaire a été récupéré cette semaine
  badgeQuestionAnswered: false, // Flag pour indiquer si une réponse a été donnée au badge de la roue
  wheelBadgeIds: null, // Signature des badges dans la roue (pour éviter de remélanger inutilement) - DEPRECATED, utiliser wheelThemeIds
  wheelThemeIds: null, // Signature des thèmes dans la roue (pour éviter de remélanger inutilement)
  wheelOrder: [], // Ordre des éléments dans la roue
  isClaimingTokens: false, // Verrou pour empêcher les appels multiples simultanés à claimDailyTokens
  claimingDay: null, // Jour en cours de réclamation (pour éviter les doubles clics)
  modifyBadgeCost: null, // Coût en jetons de la modification en cours (2 pour joker, 5 pour section amélioration)
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

// Fonction utilitaire pour obtenir les thèmes ayant au moins un badge non débloqué
function getAvailableThemes() {
  const themeName = (b) => (b.theme && String(b.theme).trim()) ? String(b.theme).trim() : 'Autres';
  
  // Grouper les badges par thème
  const themeGroups = new Map();
  state.badges.forEach(badge => {
    // Exclure les badges fantômes et débloqués
    if (isGhostBadge(badge) || state.userBadges.has(badge.id)) {
      return;
    }
    
    const theme = themeName(badge);
    if (!themeGroups.has(theme)) {
      themeGroups.set(theme, []);
    }
    themeGroups.get(theme).push(badge);
  });
  
  // Retourner uniquement les thèmes qui ont au moins un badge non débloqué
  const availableThemes = Array.from(themeGroups.keys())
    .filter(theme => themeGroups.get(theme).length > 0)
    .sort(compareThemesFixed);
  
  return availableThemes;
}

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
  
  // Attacher l'événement au bouton "Améliore un badge"
  if (els.improveBadgeBtn) {
    els.improveBadgeBtn.addEventListener('click', handleImproveBadgeFromWheel);
  }
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
  els.badgeProgressGauge = document.getElementById('badge-progress-gauge');
  els.gaugeFill = document.getElementById('gauge-fill');
  els.gaugeCount = document.getElementById('gauge-count');
  els.badgeQuestionContainer = document.getElementById('badge-question-container');
  els.selectedBadgeName = document.getElementById('selected-badge-name');
  els.selectedBadgeQuestion = document.getElementById('selected-badge-question');
  els.badgeAnswerForm = document.getElementById('badge-answer-form');
  els.badgeAnswerInput = document.getElementById('badge-answer-input');
  els.badgeAnswerMessage = document.getElementById('badge-answer-message');
  els.modifyBadgeOverlay = document.getElementById('modify-badge-overlay');
  els.tokensTooltip = document.getElementById('tokens-tooltip');
  els.spinButtonTooltip = document.getElementById('spin-button-tooltip');
  els.improveBadgeBtn = document.getElementById('improve-badge-btn');
  // Éléments du calendrier
  els.calendarBtn = document.getElementById('calendar-btn');
  els.calendarBadge = document.getElementById('calendar-badge');
  els.wheelBadge = document.getElementById('wheel-badge');
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
    if (!els.rankTooltip) return;
    if (els.rankTooltip.classList.contains('hidden')) return;
    const clickedInside = e.target === els.rankTooltip || 
                         els.rankTooltip.contains(e.target) || 
                         e.target === els.profileRank ||
                         e.target === els.profileSectionRank ||
                         (els.profileRank && els.profileRank.contains(e.target)) ||
                         (els.profileSectionRank && els.profileSectionRank.contains(e.target));
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
    return;
  }
  
  // Éviter les duplications : vérifier si les listeners sont déjà attachés
  if (els.spinButton.hasAttribute('data-tooltip-attached')) {
    return;
  }
  
  // Trouver le wrapper parent (comme pour tokens-counter)
  const wrapper = els.spinButton.parentElement;
  if (!wrapper) {
    return;
  }
  
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
  
  // Fermer le calendrier si un onglet est sélectionné
  closeCalendarDrawer();
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
  // Utiliser safeSupabaseSelect pour gérer automatiquement les colonnes optionnelles
  const { data, error } = await safeSupabaseSelect(
    supabase,
    'profiles',
    'username, badge_count, avatar_url, skill_points, rank, is_private, tokens, last_token_date, connection_days, week_start_date, week_bonus_available, week_bonus_claimed, claimed_daily_tokens',
    'username, badge_count, avatar_url, skill_points, rank',
    (query) => query.eq('id', state.user.id).single()
  );
  
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
      state.profile = { ...insertData, is_private: false, tokens: 3, last_token_date: null, connection_days: [], claimed_daily_tokens: [], week_start_date: currentWeekStartStr, week_bonus_available: false, week_bonus_claimed: false };
    } catch (e) {
      await supabase.from('profiles').insert(insertData);
      state.profile = { ...insertData, is_private: false, tokens: 3, last_token_date: null, connection_days: [], claimed_daily_tokens: [], week_start_date: currentWeekStartStr, week_bonus_available: false, week_bonus_claimed: false };
    }
  } else {
    // DEBUG : Afficher les données brutes reçues de Supabase
    console.log('=== fetchProfile - Données brutes de Supabase ===');
    console.log('data.claimed_daily_tokens:', data.claimed_daily_tokens);
    console.log('data.connection_days:', data.connection_days);
    console.log('data.week_start_date:', data.week_start_date);
    console.log('Type de claimed_daily_tokens:', typeof data.claimed_daily_tokens);
    console.log('Est un tableau?', Array.isArray(data.claimed_daily_tokens));
    console.log('================================================');
    
    state.profile = { 
      ...data, 
      is_private: data.is_private ?? false,
      tokens: data.tokens ?? 3,
      last_token_date: data.last_token_date || null,
      connection_days: data.connection_days || [],
      claimed_daily_tokens: data.claimed_daily_tokens || [],
      week_start_date: data.week_start_date || null,
      week_bonus_available: data.week_bonus_available ?? false,
      week_bonus_claimed: data.week_bonus_claimed ?? false
    };
    
    // DEBUG : Afficher ce qui est stocké dans state.profile
    console.log('=== fetchProfile - Données stockées dans state.profile ===');
    console.log('state.profile.claimed_daily_tokens:', state.profile.claimed_daily_tokens);
    console.log('state.profile.connection_days:', state.profile.connection_days);
    console.log('==========================================================');
  }
  state.tokens = state.profile.tokens || 0;
  
  updatePrivacyButton();
  updatePrivacyIndicator();
  
  // IMPORTANT : L'ordre de chargement est critique pour éviter les doubles réclamations
  // 1. Charger les jours de connexion et les jetons réclamés depuis Supabase
  //    Cela initialise state.connectionDays et state.claimedDailyTokens avec les données de la base
  await loadConnectionDays();
  
  // 2. Vérifier et mettre à jour le jour de connexion après avoir chargé les données
  //    Cette fonction est appelée à chaque chargement de page (même si l'utilisateur n'a pas besoin de se reconnecter)
  //    Elle vérifie automatiquement si last_token_date est différent d'aujourd'hui et attribue les jetons si nécessaire
  //    Le calendrier est rendu après que toutes les données soient chargées, garantissant que les vérifications
  //    dans claimDailyTokens() fonctionnent correctement même après un refresh de page
  await checkAndGrantTokens();
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

// Affiche une notification quand un badge est retourné dans la roue
// Affiche une notification "Jetons insuffisants"
function showInsufficientTokensNotification() {
  // Créer une infobulle temporaire
  const notification = document.createElement('div');
  notification.className = 'token-reward-notification insufficient-tokens-notification';
  
  notification.innerHTML = `
    <div class="token-reward-content">
      <span class="token-emoji">⚠️</span>
      <span>Jetons insuffisants</span>
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

// Affiche une infobulle "Badge débloqué !" pour les badges non-débloqués
function showBadgeUnlockedNotification() {
  // Créer une infobulle temporaire
  const notification = document.createElement('div');
  notification.className = 'badge-unlocked-notification';
  
  notification.innerHTML = `
    <div class="badge-unlocked-content">
      <span class="badge-emoji-large">🎉</span>
      <span>Badge débloqué !</span>
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

// Scroll vers un badge dans la section "Mon profil"
function scrollToBadgeInProfile(badgeId) {
  // Basculer vers l'onglet "Mon profil" si on n'y est pas déjà
  const currentTab = document.querySelector('.tab-content:not(.hidden)');
  if (!currentTab || currentTab.id !== 'my-badges') {
    showTab('my-badges');
  }
  
  // Attendre que le rendu soit terminé
  setTimeout(() => {
    // Re-rendre les badges pour s'assurer que le badge est affiché
    renderMyBadges();
    
    // Attendre un peu plus pour que le DOM soit mis à jour
    setTimeout(() => {
      // Trouver la carte du badge dans "Mon profil"
      const badgeCard = els.myBadgesList?.querySelector(`[data-badge-id="${badgeId}"]`);
      
      if (badgeCard) {
        // Ajouter un effet visuel temporaire (highlight)
        badgeCard.classList.add('badge-just-unlocked');
        
        // Scroller vers le badge avec un offset pour la navigation en bas
        const offset = 100; // Espace pour la barre de navigation
        const cardPosition = badgeCard.getBoundingClientRect().top + window.pageYOffset;
        const offsetPosition = cardPosition - offset;
        
        window.scrollTo({
          top: offsetPosition,
          behavior: 'smooth'
        });
        
        // Retirer l'effet visuel après 3 secondes
        setTimeout(() => {
          badgeCard.classList.remove('badge-just-unlocked');
        }, 3000);
      }
    }, 100);
  }, 100);
}

// Affiche une notification pour les 3 jetons d'inscription
function showSignupTokensNotification() {
  // Créer une infobulle temporaire
  const notification = document.createElement('div');
  notification.className = 'token-reward-notification';
  notification.innerHTML = `
    <div class="token-reward-content">
      <span class="token-emoji">🪙</span>
      <span>Bienvenue ! Tu as reçu 3 jetons pour t'être inscrit !</span>
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
    els.spinButton.disabled = shouldDisable;
    els.spinButton.textContent = state.isWheelSpinning 
      ? 'Roue en cours...' 
      : `Tourne la roue (1 jeton)`;
    
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
  
  // Mettre à jour la pastille sur le bouton de l'onglet roue
  updateWheelBadge();
}

async function fetchBadges() {
  // On récupère en priorité depuis Supabase.
  // Si on définit window.USE_LOCAL_BADGES = true, ou si Supabase échoue,
  // on charge un fichier local badges.json (plus simple à éditer dans le code).
  const selectWithEmoji = 'id,name,description,question,answer,emoji,low_skill,theme';
  const selectFallback = 'id,name,description,question,answer,theme';
  const useLocalOnly = typeof window !== 'undefined' && window.USE_LOCAL_BADGES === true;

  if (!useLocalOnly) {
    const { data, error } = await safeSupabaseSelect(
      supabase,
      'badges',
      selectWithEmoji,
      selectFallback
    );

    if (error) {
      console.error('Erreur lors du chargement des badges:', error);
      setMessage('Erreur lors du chargement des badges depuis Supabase. Vérifiez que la table "badges" existe et contient des données.', true);
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
    setMessage('Impossible de charger les badges. Vérifiez que la table "badges" existe dans Supabase et contient des données.', true);
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
  // Utiliser safeSupabaseSelect pour gérer automatiquement la colonne is_private optionnelle
  const { data, error } = await safeSupabaseSelect(
    supabase,
    'profiles',
    'id,username,badge_count,avatar_url,skill_points,rank,is_private',
    'id,username,badge_count,avatar_url,skill_points,rank',
    (query) => query.order('badge_count', { ascending: false }).limit(50)
  );
  
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
  if (!els.wheelContainer) {
    return;
  }
  
  // Vérifier si wheelItems existe, sinon le recréer (peut arriver si la roue était vide)
  if (!els.wheelItems) {
    // Chercher si wheel existe déjà
    let wheelEl = els.wheelContainer.querySelector('#wheel');
    if (!wheelEl) {
      // Recréer la structure complète de la roue
      wheelEl = document.createElement('div');
      wheelEl.id = 'wheel';
      wheelEl.className = 'wheel';
      els.wheelContainer.innerHTML = '';
      els.wheelContainer.appendChild(wheelEl);
    }
    // Créer wheelItems s'il n'existe pas
    els.wheelItems = document.createElement('div');
    els.wheelItems.id = 'wheel-items';
    els.wheelItems.className = 'wheel-items';
    wheelEl.appendChild(els.wheelItems);
    
    // Recréer l'indicateur s'il n'existe pas
    let indicatorEl = els.wheelContainer.querySelector('#wheel-indicator');
    if (!indicatorEl) {
      indicatorEl = document.createElement('div');
      indicatorEl.id = 'wheel-indicator';
      indicatorEl.className = 'wheel-indicator';
      els.wheelContainer.appendChild(indicatorEl);
    }
    
    // Recréer le wrapper du bouton spin s'il n'existe pas
    let spinWrapper = els.wheelContainer.querySelector('.spin-button-wrapper');
    if (!spinWrapper) {
      spinWrapper = document.createElement('div');
      spinWrapper.className = 'spin-button-wrapper';
      const spinButton = document.createElement('button');
      spinButton.id = 'spin-button';
      spinButton.className = 'primary spin-button';
      spinButton.disabled = true;
      spinButton.textContent = 'Tourne la roue (1 jeton)';
      spinWrapper.appendChild(spinButton);
      els.wheelContainer.appendChild(spinWrapper);
      // Mettre à jour la référence
      els.spinButton = spinButton;
    }
  }
  
  // Obtenir les thèmes disponibles (ayant au moins un badge non débloqué)
  const availableThemes = getAvailableThemes();
  
  if (availableThemes.length === 0) {
    // Cacher la roue et afficher un message, mais garder la structure pour pouvoir la recréer facilement
    const wheelEl = els.wheelContainer.querySelector('#wheel');
    const indicatorEl = els.wheelContainer.querySelector('#wheel-indicator');
    const spinWrapper = els.wheelContainer.querySelector('.spin-button-wrapper');
    
    if (wheelEl) wheelEl.style.display = 'none';
    if (indicatorEl) indicatorEl.style.display = 'none';
    if (spinWrapper) spinWrapper.style.display = 'none';
    
    // Afficher le message seulement s'il n'existe pas déjà
    let messageEl = els.wheelContainer.querySelector('.wheel-empty-message');
    if (!messageEl) {
      messageEl = document.createElement('p');
      messageEl.className = 'muted wheel-empty-message';
      messageEl.textContent = 'Tous les badges sont débloqués ! 🎉';
      els.wheelContainer.appendChild(messageEl);
    }
    
    state.wheelThemeIds = null; // Réinitialiser l'ordre
    return;
  }
  
  // Cacher le message et réafficher la roue
  const messageEl = els.wheelContainer.querySelector('.wheel-empty-message');
  if (messageEl) {
    messageEl.remove();
  }
  const wheelEl = els.wheelContainer.querySelector('#wheel');
  const indicatorEl = els.wheelContainer.querySelector('#wheel-indicator');
  const spinWrapper = els.wheelContainer.querySelector('.spin-button-wrapper');
  if (wheelEl) wheelEl.style.display = '';
  if (indicatorEl) indicatorEl.style.display = '';
  if (spinWrapper) spinWrapper.style.display = '';
  
  // Créer un tableau avec les thèmes + joker
  const JOKER_EMOJI = '🃏';
  const JOKER_ID = 'joker';
  
  // Créer le tableau des éléments de la roue (thèmes + 1 joker)
  const wheelElements = [];
  availableThemes.forEach(theme => {
    // Afficher le nom complet du thème (le CSS gérera le troncage avec ellipsis)
    wheelElements.push({ type: 'theme', theme, emoji: theme, id: `theme-${theme}` });
  });
  // Ajouter un seul joker pour l'affichage (garde son emoji 🃏)
  wheelElements.push({ type: 'joker', emoji: JOKER_EMOJI, id: JOKER_ID });
  
  // Vérifier si les thèmes ont changé (pour savoir si on doit remélanger)
  const currentThemeIds = availableThemes.sort().join(',');
  const needsReshuffle = !state.wheelThemeIds || state.wheelThemeIds !== currentThemeIds;
  
  let shuffledElements;
  if (needsReshuffle) {
    // Les thèmes ont changé, on remélange
    shuffledElements = wheelElements.sort(() => Math.random() - 0.5);
    // Stocker l'ordre pour éviter de remélanger inutilement
    state.wheelThemeIds = currentThemeIds;
    state.wheelOrder = shuffledElements.map(e => e.id);
  } else {
    // Même thèmes, on garde le même ordre
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
      } else if (element.type === 'theme') {
        // Ajouter une classe pour les thèmes
        item.classList.add('wheel-item-theme');
      }
      item.dataset.themeId = element.type === 'theme' ? element.theme : undefined;
      item.dataset.type = element.type;
      item.dataset.id = element.id;
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
  
  // Obtenir les thèmes disponibles pour la roue
  const availableThemes = getAvailableThemes();
  
  if (availableThemes.length === 0) {
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
    // Sélectionner un thème aléatoirement parmi les thèmes disponibles
    const randomThemeIndex = Math.floor(Math.random() * availableThemes.length);
    const theme = availableThemes[randomThemeIndex];
    selectedElement = { type: 'theme', theme, id: `theme-${theme}` };
  }
  
  // Stocker le type de sélection
  state.selectedThemeFromWheel = isJoker ? null : selectedElement.theme;
  state.selectedIsJoker = isJoker;
  
  // Animation de la roue
  const wheelItems = els.wheelItems.querySelectorAll('.wheel-item');
  const itemHeight = 60;
  const jokerCountForDisplay = 1; // Un seul joker affiché dans la roue
  const totalElementsPerSet = availableThemes.length + jokerCountForDisplay;
  const singleSetHeight = totalElementsPerSet * itemHeight;
  
  // Trouver le premier élément correspondant dans la première moitié de la roue
  let targetIndex = -1;
  const firstHalfItems = Math.floor(wheelItems.length / 2);
  for (let i = 0; i < firstHalfItems; i++) {
    if (isJoker && wheelItems[i].dataset.type === 'joker') {
      targetIndex = i;
      break;
    } else if (!isJoker && wheelItems[i].dataset.id === selectedElement.id) {
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
      } else if (!isJoker && wheelItems[i].dataset.id === selectedElement.id) {
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
      // Thème sélectionné
      handleThemeSelected(selectedElement.theme);
    }
  }, 3000);
}

// Gère la sélection d'un thème depuis la roue
function handleThemeSelected(themeName) {
  if (!els.badgeQuestionContainer) return;
  
  const themeNameFunc = (b) => (b.theme && String(b.theme).trim()) ? String(b.theme).trim() : 'Autres';
  
  // Filtrer les badges du thème qui ne sont pas débloqués et ne sont pas fantômes
  const themeBadges = state.badges.filter(badge => {
    const unlocked = state.userBadges.has(badge.id);
    const badgeTheme = themeNameFunc(badge);
    
    // Exclure les badges fantômes, débloqués et ceux qui ne sont pas du bon thème
    if (isGhostBadge(badge) || unlocked || badgeTheme !== themeName) {
      return false;
    }
    
    return true;
  });
  
  if (themeBadges.length === 0) {
    // Ne devrait pas arriver normalement, mais gérer le cas
    alert('Aucun badge disponible dans ce thème.');
    renderWheelBadges(); // Mettre à jour la roue
    return;
  }
  
  // Choisir un badge aléatoirement parmi les badges disponibles
  const randomIndex = Math.floor(Math.random() * themeBadges.length);
  const selectedBadge = themeBadges[randomIndex];
  
  // Stocker le badge sélectionné
  state.selectedBadgeFromWheel = selectedBadge;
  
  // Afficher le modal avec le nom du thème en titre
  const card = els.badgeQuestionContainer.querySelector('.card');
  if (!card) return;
  
  // Réinitialiser le flag de réponse
  state.badgeQuestionAnswered = false;
  
  // Recréer la structure HTML complète de la carte
  card.innerHTML = `
    <h3 id="selected-theme-name" style="text-align: center; font-size: 24px; font-weight: 700; margin-bottom: 10px;">${themeName}</h3>
    <h3 id="selected-badge-name" style="text-align: center; font-size: 60px; margin: 10px 0; color: #9ca3af;">?</h3>
    <p id="selected-badge-question" class="badge-question-text" style="text-align: center; margin: 15px 0;"></p>
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
  
  if (!els.selectedBadgeName || !els.selectedBadgeQuestion) return;
  
  // Afficher "?" au lieu de l'emoji dans le formulaire
  // Mais garder le vrai emoji et nom dans les attributs title et data-*
  const emoji = getBadgeEmoji(selectedBadge);
  const title = stripEmojis(selectedBadge.name || '');
  els.selectedBadgeName.textContent = '?';
  els.selectedBadgeName.setAttribute('title', `${emoji} ${title}`);
  els.selectedBadgeName.setAttribute('data-emoji', emoji);
  els.selectedBadgeName.setAttribute('data-title', title);
  // Ajouter un style pour rendre le "?" gris
  els.selectedBadgeName.style.color = '#9ca3af';
  els.selectedBadgeQuestion.textContent = selectedBadge.question || '';
  els.badgeAnswerMessage.textContent = '';
  els.badgeAnswerMessage.className = 'message';
  
  // Générer le formulaire selon le type de badge
  const config = parseConfig(selectedBadge.answer);
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

// Gère l'amélioration de badge depuis la section "Améliore tes badges" (coûte 5 jetons)
async function handleImproveBadgeFromWheel() {
  // Vérifier si l'utilisateur a assez de jetons
  if ((state.tokens || 0) < 5) {
    alert('Tu n\'as pas assez de jetons (5 requis).');
    return;
  }
  
  // Consommer 5 jetons
  const newTokens = (state.tokens || 0) - 5;
  state.tokens = newTokens;
  if (state.profile) {
    state.profile.tokens = newTokens;
  }
  
  const { error } = await supabase
    .from('profiles')
    .update({ tokens: newTokens })
    .eq('id', state.user.id);
  
  if (error) {
    console.error('Erreur lors de la consommation des jetons:', error);
    state.tokens = (state.tokens || 0) + 5;
    if (state.profile) {
      state.profile.tokens = state.tokens;
    }
    alert('Erreur lors de la mise à jour des jetons. Veuillez réessayer.');
    return;
  }
  
  updateTokensDisplay();
  
  // Stocker le coût de la modification (5 jetons pour section amélioration)
  state.modifyBadgeCost = 5;
  
  // Activer le mode modification
  state.isModifyingBadge = true;
  
  // Basculer vers l'onglet "Mes badges"
  showTab('my-badges');
  
  // Scroll automatique vers le haut de la section "Ma collection"
  setTimeout(() => {
    const myBadgesSection = document.getElementById('my-badges');
    if (myBadgesSection) {
      myBadgesSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, 100);
  
  // Afficher un message d'instruction
  renderMyBadges();
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
    
    // Stocker le coût de la modification (2 jetons pour joker)
    state.modifyBadgeCost = 2;
    
    // Activer le mode modification
    state.isModifyingBadge = true;
    
    // Fermer la carte joker
    closeBadgeQuestion();
    
    // Basculer vers l'onglet "Mes badges"
    showTab('my-badges');
    
    // Scroll automatique vers le haut de la section "Ma collection"
    setTimeout(() => {
      const myBadgesSection = document.getElementById('my-badges');
      if (myBadgesSection) {
        myBadgesSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 100);
    
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
  
  // Afficher "?" au lieu de l'emoji dans le formulaire
  // Mais garder le vrai emoji et nom dans les attributs title et data-*
  const emoji = getBadgeEmoji(badge);
  const title = stripEmojis(badge.name || '');
  els.selectedBadgeName.textContent = '?';
  els.selectedBadgeName.setAttribute('title', `${emoji} ${title}`);
  els.selectedBadgeName.setAttribute('data-emoji', emoji);
  els.selectedBadgeName.setAttribute('data-title', title);
  // Ajouter un style pour rendre le "?" gris
  els.selectedBadgeName.style.color = '#9ca3af';
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
      // Récupérer le vrai emoji du badge
      const realEmoji = getBadgeEmoji(state.selectedBadgeFromWheel);
      
      // Récupérer le nom du badge (sans emoji)
      const badgeName = stripEmojis(state.selectedBadgeFromWheel.name || '');
      
      // Formater le message selon le niveau
      const config = parseConfig(state.selectedBadgeFromWheel.answer);
      let successMessage = '';
      const messageColor = isExpertLevel ? '#a855f7' : '#10b981'; // Violet pour Expert, vert pour normal
      
      // Vérifier si le badge a plusieurs niveaux
      const totalLevels = getLevelCount(config);
      const hasMultipleLevels = totalLevels > 1;
      
      if (badgeLevel && hasMultipleLevels && !isExpertLevel) {
        // Badge avec plusieurs niveaux : afficher le numéro du skill
        const levelPosition = getLevelPosition(badgeLevel, config);
        if (levelPosition !== null && levelPosition > 0) {
          successMessage = `🎉 Badge débloqué !\n\nTu as obtenu le niveau ${levelPosition} de ce badge. Il est maintenant ajouté à ta collection.`;
        } else {
          // Si on ne peut pas déterminer la position, afficher le message simple
          successMessage = '🎉 Badge débloqué !\n\nIl est maintenant ajouté à ta collection.';
        }
      } else {
        // Badge sans niveau, avec un seul niveau, ou Expert : message simple
        successMessage = '🎉 Badge débloqué !\n\nIl est maintenant ajouté à ta collection.';
      }
      
      // Afficher d'abord le "?" puis animer vers l'emoji réel
      card.innerHTML = `
        <div style="display: flex; justify-content: center; align-items: center; width: 100%;">
          <h3 id="selected-badge-name" class="badge-emoji-reveal" style="text-align: center; font-size: 80px; line-height: 1; margin: 20px 0; padding: 0; color: #9ca3af;">?</h3>
        </div>
        <div style="display: flex; justify-content: center; align-items: center; width: 100%;">
          <h4 class="badge-name-reveal" style="text-align: center; font-size: 24px; font-weight: 600; margin: 10px 0 20px 0; color: var(--text); opacity: 0;" id="badge-name-reveal">${badgeName}</h4>
        </div>
        <p class="badge-success-message" style="text-align: center; color: ${messageColor}; margin: 20px 0; font-size: 16px; opacity: 0;" id="badge-message-reveal">
          ${successMessage}
        </p>
        <div style="display: flex; justify-content: center; margin-top: 20px; opacity: 0;" id="badge-button-reveal">
          <button class="primary" id="view-badge-button" style="padding: 12px 24px; font-size: 16px;">
            Voir dans ma collection
          </button>
        </div>
      `;
      
      // Mettre à jour la référence à selectedBadgeName après avoir modifié le HTML
      els.selectedBadgeName = card.querySelector('#selected-badge-name');
      
      // Animer la transformation du "?" vers l'emoji réel
      setTimeout(() => {
        if (els.selectedBadgeName) {
          els.selectedBadgeName.textContent = realEmoji;
          els.selectedBadgeName.style.color = 'inherit'; // Retirer la couleur grise
          els.selectedBadgeName.classList.add('badge-emoji-revealed');
          
          // Afficher le nom, le message et le bouton avec un léger délai
          setTimeout(() => {
            const nameEl = card.querySelector('#badge-name-reveal');
            const messageEl = card.querySelector('#badge-message-reveal');
            const buttonEl = card.querySelector('#badge-button-reveal');
            const viewButton = card.querySelector('#view-badge-button');
            
            if (nameEl) {
              nameEl.classList.add('badge-name-revealed');
              nameEl.style.opacity = '1';
            }
            if (messageEl) {
              messageEl.style.transition = 'opacity 0.5s ease-in';
              messageEl.style.opacity = '1';
            }
            if (buttonEl) {
              buttonEl.style.transition = 'opacity 0.5s ease-in';
              buttonEl.style.opacity = '1';
            }
            
            // Attacher l'événement au bouton pour rediriger vers le badge
            if (viewButton) {
              viewButton.addEventListener('click', () => {
                scrollToBadgeInProfile(state.selectedBadgeFromWheel.id);
              });
            }
          }, 500);
        }
      }, 100);
      
      // Réattacher le gestionnaire de fermeture (maintenant la fermeture est autorisée car une réponse a été donnée)
      attachBadgeQuestionCloseHandler();
    }
    
    // Vérifier si tous les badges du thème sont maintenant débloqués
    const themeNameFunc = (b) => (b.theme && String(b.theme).trim()) ? String(b.theme).trim() : 'Autres';
    const badgeTheme = themeNameFunc(state.selectedBadgeFromWheel);
    
    // Filtrer les badges du thème qui ne sont pas débloqués et ne sont pas fantômes
    const themeBadges = state.badges.filter(badge => {
      const unlocked = state.userBadges.has(badge.id);
      const badgeThemeName = themeNameFunc(badge);
      
      // Exclure les badges fantômes, débloqués et ceux qui ne sont pas du bon thème
      if (isGhostBadge(badge) || unlocked || badgeThemeName !== badgeTheme) {
        return false;
      }
      
      return true;
    });
    
    // Si tous les badges du thème sont débloqués, retirer le thème de la roue
    const allThemeBadgesUnlocked = themeBadges.length === 0;
    
    // Mettre à jour la roue et les badges IMMÉDIATEMENT (avant le délai)
    renderWheelBadges();
    renderMyBadges();
    
    // Le message reste affiché jusqu'à ce que l'utilisateur clique sur le bouton ou ferme manuellement
    // L'utilisateur peut aussi cliquer ailleurs pour fermer (géré par attachBadgeQuestionCloseHandler)
  } else {
    // S'assurer que le conteneur est visible
    if (els.badgeQuestionContainer) {
      els.badgeQuestionContainer.classList.remove('hidden');
    }
    
    // Afficher uniquement un message d'erreur (sans emoji)
    const card = els.badgeQuestionContainer?.querySelector('.card');
    if (card) {
      // Récupérer le message personnalisé depuis la config du badge
      const config = parseConfig(state.selectedBadgeFromWheel.answer);
      const customMessage = config?.blockedMessage;
      const errorMessage = customMessage || 'Ta réponse n\'a pas suffi pour débloquer ce badge. Le badge retourne dans la roue, tu peux réessayer !';
      
      card.innerHTML = `
        <p class="badge-error-message" style="text-align: center; color: white; margin: 20px 0; font-size: 18px; line-height: 1.5;">
          ${errorMessage}
        </p>
      `;
      // Mettre à jour la référence à selectedBadgeName après avoir modifié le HTML
      els.selectedBadgeName = card.querySelector('#selected-badge-name');
      // Réattacher le gestionnaire de fermeture (maintenant la fermeture est autorisée car une réponse a été donnée)
      attachBadgeQuestionCloseHandler();
    }
    
    // Mettre à jour la roue IMMÉDIATEMENT (le badge retourne dans la roue)
    renderWheelBadges();
  }
}


// Gère la modification de réponse d'un badge (depuis le Joker Bonus)
function handleModifyBadgeAnswer(badge) {
  // NE PAS désactiver le mode modification ici
  // Le mode doit rester actif jusqu'à ce que l'utilisateur soumette réellement le formulaire
  // ou annule avec remboursement
  
  // Ne pas supprimer le bandeau d'instruction - il doit rester visible
  // const banner = document.getElementById('modify-badge-banner');
  // if (banner) {
  //   banner.remove();
  // }
  
  // Sauvegarder l'ancien état du badge pour pouvoir le restaurer
  const oldLevel = state.userBadgeLevels.get(badge.id);
  const oldAnswer = state.userBadgeAnswers.get(badge.id);
  
  // Afficher le formulaire de réponse dans l'overlay global
  if (!els.modifyBadgeOverlay) return;
  
  state.badgeQuestionAnswered = false;
  
  const emoji = getBadgeEmoji(badge);
  const title = stripEmojis(badge.name || '');
  const config = parseConfig(badge.answer);
  
  const modal = els.modifyBadgeOverlay.querySelector('.modify-badge-modal .card');
  if (!modal) return;
  
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
  
  modal.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
      <h3 style="margin: 0; font-size: 20px;">Modifier le badge</h3>
      <button id="modify-badge-close" class="ghost icon-btn" aria-label="Fermer" style="width: 32px; height: 32px; padding: 0; font-size: 20px;">✕</button>
    </div>
    <div style="text-align: center; margin-bottom: 20px;">
      <div style="font-size: 60px; margin: 10px 0;">${emoji}</div>
      <p style="font-size: 18px; font-weight: bold; margin: 10px 0;">${title}</p>
      <p class="badge-question-text" style="margin: 15px 0;">${badge.question || ''}</p>
      <p class="muted" style="font-size: 12px; margin-top: 10px;">Réponse actuelle : ${oldAnswer || 'Aucune'}</p>
    </div>
    <form id="modify-badge-form" class="auth-form" style="margin-top: 15px;">
      <label>Nouvelle réponse</label>
      ${formContent}
      <button type="submit" class="primary">Modifier</button>
    </form>
    <p id="modify-badge-message" class="message" style="text-align: center;"></p>
  `;
  
  els.modifyBadgeOverlay.classList.remove('hidden');
  
  // Attacher les événements pour les boutons boolean
  if (config?.type === 'boolean') {
    const hiddenInput = modal.querySelector('input[name="answer"]');
    const boolBtns = modal.querySelectorAll('.bool-btn');
    boolBtns.forEach(btn => {
        btn.addEventListener('click', () => {
        if (hiddenInput) hiddenInput.value = btn.getAttribute('data-bool') || '';
        boolBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        });
      });
    }
  
  // Attacher le gestionnaire de fermeture
  const closeBtn = modal.querySelector('#modify-badge-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', async () => {
      await closeModifyBadgeOverlay();
    });
  }
  
  // Attacher le gestionnaire de clic sur l'overlay (fermer à tout moment)
  const overlayClickHandler = async (e) => {
    if (e.target === els.modifyBadgeOverlay) {
      // Permettre la fermeture à tout moment (le remboursement sera géré dans closeModifyBadgeOverlay)
      await closeModifyBadgeOverlay();
      els.modifyBadgeOverlay.removeEventListener('click', overlayClickHandler);
    }
  };
  els.modifyBadgeOverlay.addEventListener('click', overlayClickHandler);
  
  // Attacher le gestionnaire de soumission
  const form = modal.querySelector('#modify-badge-form');
  const messageEl = modal.querySelector('#modify-badge-message');
  
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
    
    // Vérifier si c'est une réponse "non" pour les badges boolean (AVANT l'évaluation)
    // Si c'est "non", ne pas sauvegarder même si c'est correct
    const falseLabels = config?.falseLabels ?? ['non', 'no', 'n'];
    const isBooleanNo = config?.type === 'boolean' && 
                        falseLabels.map(l => l.toLowerCase().trim()).includes(newAnswer.toLowerCase().trim());
    
    // Évaluer la nouvelle réponse
    const selectedOptions = config?.type === 'multiSelect' ? newAnswer.split(', ') : [];
    const result = evaluateBadgeAnswer(badge, newAnswer, selectedOptions);
    
    if (result.ok) {
      // Nouvelle réponse correcte
      const newLevel = result.level || null;
      
      // Comparer les niveaux pour voir si c'est une amélioration, même niveau, ou baisse
      const levelOrder = ['Skill 1', 'Skill 2', 'Skill 3', 'Skill max', 'Expert'];
      const oldLevelIndex = oldLevel ? levelOrder.indexOf(oldLevel) : -1;
      const newLevelIndex = newLevel ? levelOrder.indexOf(newLevel) : -1;
      
      // Si réponse "non" ou niveau baissé : ne pas sauvegarder
      if (isBooleanNo || (oldLevel && newLevelIndex < oldLevelIndex)) {
        messageEl.textContent = 'Ton badge garde son niveau.';
        messageEl.classList.remove('error');
        messageEl.classList.remove('success');
        
        // Désactiver le mode modification (enlever la possibilité d'améliorer un autre badge)
        state.isModifyingBadge = false;
        state.modifyBadgeCost = null;
        
        // Supprimer le bandeau d'instruction
        const banner = document.getElementById('modify-badge-banner');
        if (banner) {
          banner.remove();
        }
        
        // Fermer l'overlay après un délai
        state.badgeQuestionAnswered = true;
        setTimeout(() => {
          closeModifyBadgeOverlay();
          renderMyBadges();
        }, 2500);
      } else if (newLevelIndex > oldLevelIndex || !oldLevel) {
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
          // Mettre à jour l'état local avec la nouvelle réponse et le nouveau niveau
          state.userBadgeLevels.set(badge.id, newLevel);
          state.userBadgeAnswers.set(badge.id, newAnswer);
          
          // Message avec le format exact du niveau
          const levelDisplay = newLevel || 'Débloqué';
          messageEl.textContent = `Tu as amélioré ce badge au niv ${levelDisplay}.`;
          messageEl.classList.remove('error');
          messageEl.classList.add('success');
          
          // Désactiver le mode modification après une modification réussie
          state.isModifyingBadge = false;
          state.modifyBadgeCost = null;
          
          // Supprimer le bandeau d'instruction
          const banner = document.getElementById('modify-badge-banner');
          if (banner) {
            banner.remove();
          }
          
          // Mettre à jour l'affichage du profil pour montrer la nouvelle réponse
          state.badgeQuestionAnswered = true;
          setTimeout(() => {
            closeModifyBadgeOverlay();
            renderMyBadges();
          }, 2500);
        }
      } else if (newLevelIndex === oldLevelIndex) {
        // Même niveau : remplacer la réponse
        const { error } = await supabase.from('user_badges').upsert({
          user_id: state.user.id,
          badge_id: badge.id,
          success: true,
          level: newLevel,
          user_answer: newAnswer,
          was_ever_unlocked: true
        });
        
        if (!error) {
          // Mettre à jour l'état local avec la nouvelle réponse (même niveau)
          state.userBadgeLevels.set(badge.id, newLevel);
          state.userBadgeAnswers.set(badge.id, newAnswer);
          
          // Message indiquant que la réponse a été remplacée
          messageEl.textContent = 'Réponse remplacée. Ton badge garde son niveau';
          messageEl.classList.remove('error');
          messageEl.classList.add('success');
          
          // Désactiver le mode modification après le remplacement
          state.isModifyingBadge = false;
          state.modifyBadgeCost = null;
          
          // Supprimer le bandeau d'instruction
          const banner = document.getElementById('modify-badge-banner');
          if (banner) {
            banner.remove();
          }
          
          // Mettre à jour l'affichage du profil pour montrer la nouvelle réponse
          state.badgeQuestionAnswered = true;
          setTimeout(() => {
            closeModifyBadgeOverlay();
            renderMyBadges();
          }, 2500);
        }
      }
    } else {
      // Réponse incorrecte - supprimer le badge de la collection
      // Préserver was_ever_unlocked si le badge a déjà été débloqué avant
      const wasEverUnlocked = state.wasEverUnlocked.has(badge.id);
      
      // Mettre à jour Supabase : marquer le badge comme bloqué (success: false)
      const { error } = await supabase.from('user_badges').upsert({
        user_id: state.user.id,
        badge_id: badge.id,
        success: false,
        level: null,
        user_answer: null,
        was_ever_unlocked: wasEverUnlocked
      });
      
      if (!error) {
        // Supprimer le badge de la collection
        state.userBadges.delete(badge.id);
        state.userBadgeLevels.delete(badge.id);
        state.userBadgeAnswers.delete(badge.id);
        state.attemptedBadges.add(badge.id);
        
        messageEl.textContent = 'Réponse incorrecte. Le badge est retiré de ta collection et peut être redébloqué dans la roue.';
        messageEl.classList.add('error');
        
        // Désactiver le mode modification
        state.isModifyingBadge = false;
        state.modifyBadgeCost = null;
        
        // Supprimer le bandeau d'instruction
        const banner = document.getElementById('modify-badge-banner');
        if (banner) {
          banner.remove();
        }
        
        // Mettre à jour la roue pour que le badge soit disponible
        renderWheelBadges();
        
        // Mettre à jour l'affichage de la collection pour retirer le badge
        state.badgeQuestionAnswered = true;
        setTimeout(() => {
          closeModifyBadgeOverlay();
          renderMyBadges();
        }, 2500);
      } else {
        messageEl.textContent = 'Erreur lors de la mise à jour. Veuillez réessayer.';
        messageEl.classList.add('error');
      }
    }
  });
}

// Rembourse les jetons dépensés pour la modification de badge
async function refundModifyBadgeTokens() {
  if (!state.modifyBadgeCost || state.modifyBadgeCost <= 0) {
    return; // Pas de coût à rembourser
  }
  
  const refundAmount = state.modifyBadgeCost;
  
  // Ajouter les jetons remboursés
  const newTokens = (state.tokens || 0) + refundAmount;
  state.tokens = newTokens;
  if (state.profile) {
    state.profile.tokens = newTokens;
  }
  
  // Mettre à jour dans Supabase
  const { error } = await supabase
    .from('profiles')
    .update({ tokens: newTokens })
    .eq('id', state.user.id);
  
  if (error) {
    console.error('Erreur lors du remboursement des jetons:', error);
    // Annuler le remboursement local en cas d'erreur
    state.tokens = (state.tokens || 0) - refundAmount;
    if (state.profile) {
      state.profile.tokens = state.tokens;
    }
  } else {
    // Réinitialiser le coût
    state.modifyBadgeCost = null;
    updateTokensDisplay();
  }
}

// Ferme l'overlay de modification de badge
async function closeModifyBadgeOverlay() {
  if (els.modifyBadgeOverlay) {
    els.modifyBadgeOverlay.classList.add('hidden');
    const modal = els.modifyBadgeOverlay.querySelector('.modify-badge-modal .card');
    if (modal) {
      modal.innerHTML = '';
    }
  }
  
  // Si le mode modification est toujours actif et qu'aucune modification n'a été effectuée, rembourser
  if (state.isModifyingBadge && !state.badgeQuestionAnswered && state.modifyBadgeCost) {
    await refundModifyBadgeTokens();
  }
  
  state.badgeQuestionAnswered = false;
}

function renderMyBadges() {
  // On affiche uniquement les badges débloqués
  if (!els.myBadgesList) {
    console.error('❌ els.myBadgesList n\'existe pas !');
    return;
  }
  
  const allBadges = state.badges.slice();
  
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
        <p>Clique sur un badge pour modifier ta réponse</p>
        <button id="cancel-modify-badge" class="ghost">Annuler</button>
      `;
      els.myBadgesList.parentElement.insertBefore(banner, els.myBadgesList);
      
      banner.querySelector('#cancel-modify-badge').addEventListener('click', async () => {
        // Rembourser les jetons avant de désactiver le mode
        await refundModifyBadgeTokens();
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

  // Filtrer les badges : afficher uniquement les badges débloqués
  const visibleBadges = allBadges.filter(badge => {
    const unlocked = state.userBadges.has(badge.id);
    // Afficher uniquement si débloqué
    return unlocked;
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
    title.textContent = t;
    els.myBadgesList.appendChild(title);

    themeBadges.sort(sortById).forEach(badge => {
      const unlocked = state.userBadges.has(badge.id);
      // Ne traiter que les badges débloqués
      if (!unlocked) return;
      
      const levelLabel = state.userBadgeLevels.get(badge.id);
      const config = parseConfig(badge.answer);
      const isGhost = isGhostBadge(badge);
      const userAnswer = state.userBadgeAnswers.get(badge.id);

      const card = document.createElement('article');
      card.className = 'card-badge clickable compact all-badge-card my-catalog-card';
      card.dataset.badgeId = badge.id; // Ajouter un identifiant pour pouvoir scroller vers le badge

      // Afficher les badges débloqués normalement
      const safeEmoji = getBadgeEmoji(badge);
      const safeTitle = stripEmojis(badge.name || '');

      // Déterminer le label : afficher le niveau
      const statusLabel = formatLevelTag(unlocked, levelLabel, config);
      const statusClass = isMysteryLevel(levelLabel) ? 'mystery' : 'success';
      const isExpert = isMysteryLevel(levelLabel);
      
      if (isExpert) {
        card.classList.add('expert-badge');
      }

      const formattedAnswer = userAnswer ? formatUserAnswer(badge, userAnswer) : null;
      const ghostText = isGhost ? (config?.ghostDisplayText || 'Débloqué automatiquement') : null;
      const displayText = formattedAnswer || ghostText || '';

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
      if (state.isModifyingBadge) {
        card.classList.add('modifiable');
      }
      
      card.addEventListener('click', (e) => {
        const tag = e.target.tagName.toLowerCase();
        if (tag === 'input' || tag === 'button' || e.target.closest('form')) return;
        
        // Si mode modification actif, ouvrir le formulaire de modification
        if (state.isModifyingBadge) {
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
  
  // Vérifier explicitement que result.ok est false avant de traiter comme un échec
  // Cela évite les problèmes de timing ou de logique incorrecte
  if (!result || !result.ok) {
    // ÉTAT 2 : Badge bloqué (répondu mais non débloqué)
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
    
    // Le badge retourne automatiquement dans la roue (il n'est plus débloqué)
    // Mettre à jour la roue immédiatement pour que le badge soit disponible
    renderWheelBadges();
    
    // Si on est dans une carte (section "Badges non-débloqués"), la supprimer immédiatement
    if (cardElement) {
      // Ajouter une animation de disparition avant de supprimer
      cardElement.style.transition = 'opacity 0.3s ease-out, transform 0.3s ease-out';
      cardElement.style.opacity = '0';
      cardElement.style.transform = 'scale(0.95)';
      setTimeout(() => {
        cardElement.remove();
      }, 300);
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
  // IMPORTANT : Mettre à jour le state AVANT tout rendu pour garantir que le badge est marqué comme débloqué
  state.userBadges.add(badge.id);
  state.wasEverUnlocked.add(badge.id); // Marquer comme ayant été débloqué au moins une fois
  if (result.level) state.userBadgeLevels.set(badge.id, result.level);
  state.userBadgeAnswers.set(badge.id, rawAnswer);
  state.attemptedBadges.add(badge.id);
  
  // Si on est dans une carte (section "Badges non-débloqués"), masquer le formulaire et mettre à jour l'affichage
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
    // Afficher une infobulle "Badge débloqué !" pour les badges non-débloqués
    showBadgeUnlockedNotification();
    
    // Supprimer la carte immédiatement avec animation
    cardElement.style.transition = 'opacity 0.3s ease-out, transform 0.3s ease-out';
    cardElement.style.opacity = '0';
    cardElement.style.transform = 'scale(0.95)';
    setTimeout(() => {
      cardElement.remove();
    }, 300);
    
    // Mettre à jour la roue IMMÉDIATEMENT
    // Le badge ne devrait pas apparaître dans la roue car il est débloqué (filtré par renderWheelBadges)
    // Le state.userBadges a été mis à jour AVANT, donc le filtre fonctionnera correctement
    renderWheelBadges();
    
    // Basculer vers l'onglet "Mon profil" et scroller vers le badge débloqué IMMÉDIATEMENT
    // Ne pas attendre, car le badge est débloqué et ne doit PAS aller dans la roue
    scrollToBadgeInProfile(badge.id);
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

// isMysteryLevel est maintenant importé du module badgeCalculations.js

// Convertit un nombre en chiffres romains
function toRoman(num) {
  if (num <= 0) return '';
  if (num >= 1000) return 'M' + toRoman(num - 1000);
  if (num >= 900) return 'CM' + toRoman(num - 900);
  if (num >= 500) return 'D' + toRoman(num - 500);
  if (num >= 400) return 'CD' + toRoman(num - 400);
  if (num >= 100) return 'C' + toRoman(num - 100);
  if (num >= 90) return 'XC' + toRoman(num - 90);
  if (num >= 50) return 'L' + toRoman(num - 50);
  if (num >= 40) return 'XL' + toRoman(num - 40);
  if (num >= 10) return 'X' + toRoman(num - 10);
  if (num >= 9) return 'IX' + toRoman(num - 9);
  if (num >= 5) return 'V' + toRoman(num - 5);
  if (num >= 4) return 'IV' + toRoman(num - 4);
  if (num >= 1) return 'I' + toRoman(num - 1);
  return '';
}

function formatLevelTag(unlocked, levelLabel, config) {
  if (!unlocked) {
    // Mode Pokédex : si le badge est bloqué, on masque l'indicateur exact
    return 'À débloquer';
  }
  
  // Niveau 0 = badge bloqué
  if (levelLabel) {
    const labelLower = String(levelLabel).toLowerCase();
    if (labelLower === 'niv 0' || labelLower === 'skill 0' || labelLower === 'niveau 0') {
      return 'Bloqué · niveau 0';
    }
  }
  
  if (isMysteryLevel(levelLabel)) return 'niveau Expert';
  const pos = getLevelPosition(levelLabel, config);
  if (pos !== null && pos > 0) {
    // Convertir la position en chiffres romains
    const romanNum = toRoman(pos);
    return `niveau ${romanNum}`;
  }
  
  // Si on ne peut pas déterminer la position, afficher "Débloqué"
  return 'Débloqué';
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

// parseConfig est maintenant importé du module utils.js

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
        // "bloquer" = le badge n'est pas débloqué, retourne dans la roue
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
        // "bloquer" = le badge n'est pas débloqué, retourne dans la roue
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
  
  // Filtrer les badges : afficher uniquement les badges débloqués
  const allBadges = state.badges.slice();
  const visibleBadges = allBadges.filter(badge => {
    const unlocked = communityUserBadges.has(badge.id);
    // Afficher uniquement si débloqué
    return unlocked;
  });
  
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
    const themeBadges = groups.get(t) || [];
    // Filtrer pour ne garder que les badges débloqués
    const unlockedThemeBadges = themeBadges.filter(b => communityUserBadges.has(b.id));
    if (unlockedThemeBadges.length === 0) return;
    
    const title = document.createElement('div');
    title.className = 'section-subtitle theme-title';
    title.textContent = t;
    els.communityProfileBadgesList.appendChild(title);

    themeBadges.sort(sortById).forEach(badge => {
      const unlocked = communityUserBadges.has(badge.id);
      // Ne traiter que les badges débloqués
      if (!unlocked) return;
      
      const levelLabel = communityUserBadgeLevels.get(badge.id);
      const config = parseConfig(badge.answer);
      const userAnswer = communityUserBadgeAnswers.get(badge.id);

      const card = document.createElement('article');
      card.className = 'card-badge clickable compact all-badge-card my-catalog-card';

      const safeEmoji = getBadgeEmoji(badge);
      const safeTitle = stripEmojis(badge.name || '');

      const statusLabel = formatLevelTag(unlocked, levelLabel, config);
      const statusClass = isMysteryLevel(levelLabel) ? 'mystery' : 'success';
      const isExpert = isMysteryLevel(levelLabel);
      
      if (isExpert) {
        card.classList.add('expert-badge');
      }

      const formattedAnswer = userAnswer ? formatUserAnswer(badge, userAnswer) : null;
      const ghostText = isGhostBadge(badge) ? (config?.ghostDisplayText || 'Débloqué automatiquement') : null;
      const displayText = formattedAnswer || ghostText || '';

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

function setMessage(text, isError = false) {
  els.authMessage.textContent = text;
  els.authMessage.classList.toggle('error', isError);
}

// Met à jour la jauge de progression des badges
function updateBadgeProgressGauge(unlockedCount, totalCount) {
  if (!els.gaugeFill || !els.gaugeCount) return;
  
  const percentage = totalCount > 0 ? (unlockedCount / totalCount) * 100 : 0;
  els.gaugeFill.style.height = `${percentage}%`;
  els.gaugeCount.textContent = `${unlockedCount}`;
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
  
  // Mettre à jour la jauge de progression des badges
  updateBadgeProgressGauge(badgeCount, totalBadges);
  
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
    // S'assurer que le bouton est visible
    els.profileSectionRank.style.display = '';
    els.profileSectionRank.classList.remove('hidden');
    
    // Mettre à jour le texte du rang
    els.profileSectionRank.textContent = formatRankText(rankMeta.name);
    
    // Appliquer les styles selon le type de rang
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

// Fonction utilitaire pour filtrer les dates d'un tableau pour ne garder que celles de la semaine actuelle
// Évite la duplication de code dans plusieurs fonctions
function filterDatesByCurrentWeek(dateArray, currentWeekStartStr) {
  if (!Array.isArray(dateArray)) return [];
  return dateArray.filter(dateStr => {
    try {
      const date = new Date(dateStr + 'T00:00:00');
      const dateWeekStart = getWeekStartDate(date);
      const dateWeekStartStr = dateWeekStart.toISOString().split('T')[0];
      return dateWeekStartStr === currentWeekStartStr;
    } catch (e) {
      return false;
    }
  });
}

// Fonction utilitaire pour vérifier si une date est dans la semaine actuelle
// Utilise filterDatesByCurrentWeek() pour éviter la duplication de code
function isDateInCurrentWeek(dateStr, currentWeekStartStr) {
  const filtered = filterDatesByCurrentWeek([dateStr], currentWeekStartStr);
  return filtered.length > 0;
}

// Fonction utilitaire pour vérifier si un jour a déjà été réclamé
// Vérifie à la fois dans le state local ET dans le profil pour éviter les problèmes de synchronisation
function isDayClaimed(dayStr, currentWeekStartStr) {
  const claimedInState = filterDatesByCurrentWeek(
    state.claimedDailyTokens || [],
    currentWeekStartStr
  ).includes(dayStr);
  
  const claimedInProfile = filterDatesByCurrentWeek(
    Array.isArray(state.profile?.claimed_daily_tokens) 
      ? state.profile.claimed_daily_tokens 
      : [],
    currentWeekStartStr
  ).includes(dayStr);
  
  return claimedInState || claimedInProfile;
}

// Réinitialise les données de la semaine (appelée lors d'un changement de semaine)
async function resetWeekData(currentWeekStartStr) {
  state.connectionDays = [];
  state.claimedDailyTokens = [];
  state.weekBonusClaimed = false;
  state.weekStartDate = currentWeekStartStr;
  
  if (state.profile) {
    state.profile.connection_days = [];
    state.profile.claimed_daily_tokens = [];
    state.profile.week_bonus_claimed = false;
    state.profile.week_start_date = currentWeekStartStr;
  }
  
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
}

// Charge les jours de connexion depuis le profil
async function loadConnectionDays() {
  if (!state.profile) {
    console.warn('loadConnectionDays: state.profile n\'est pas défini');
    return;
  }
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const currentWeekStart = getWeekStartDate(today);
  const currentWeekStartStr = currentWeekStart.toISOString().split('T')[0];
  
  // DEBUG : Vérifier les données AVANT le traitement
  console.log('=== loadConnectionDays - AVANT traitement ===');
  console.log('state.profile.week_start_date:', state.profile.week_start_date);
  console.log('state.profile.connection_days:', state.profile.connection_days);
  console.log('state.profile.claimed_daily_tokens:', state.profile.claimed_daily_tokens);
  console.log('currentWeekStartStr:', currentWeekStartStr);
  
  // Si on a une semaine enregistrée et que c'est une nouvelle semaine, réinitialiser
  if (state.profile.week_start_date) {
    const savedWeekStart = new Date(state.profile.week_start_date + 'T00:00:00');
    const savedWeekStartStr = savedWeekStart.toISOString().split('T')[0];
    
    console.log('savedWeekStartStr:', savedWeekStartStr);
    console.log('currentWeekStartStr:', currentWeekStartStr);
    console.log('Nouvelle semaine?', savedWeekStartStr !== currentWeekStartStr);
    
    if (savedWeekStartStr !== currentWeekStartStr) {
      // Nouvelle semaine : réinitialiser les jours de connexion ET les jetons récupérés
      console.log('⚠️ NOUVELLE SEMAINE DÉTECTÉE - Réinitialisation');
      // IMPORTANT : Ne PAS appeler resetWeekData() ici car il efface les données dans Supabase
      // Au lieu de cela, réinitialiser seulement localement et mettre à jour week_start_date
      // NE PAS écraser state.profile.claimed_daily_tokens car il contient les données de Supabase
      // qui seront filtrées plus tard pour ne garder que celles de la semaine actuelle
      state.connectionDays = [];
      state.claimedDailyTokens = []; // Vide localement, sera rempli par le filtrage plus bas
      state.weekBonusClaimed = false;
      state.weekStartDate = currentWeekStartStr;
      
      // Mettre à jour le profil local (mais NE PAS écraser claimed_daily_tokens)
      if (state.profile) {
        state.profile.connection_days = []; // Réinitialiser localement seulement
        // NE PAS écraser state.profile.claimed_daily_tokens ici !
        // Il contient les données de Supabase qui seront filtrées plus bas
        state.profile.week_bonus_claimed = false;
        state.profile.week_start_date = currentWeekStartStr;
        state.profile.week_bonus_available = false;
      }
      
      // Sauvegarder dans Supabase SEULEMENT la nouvelle semaine, sans effacer les anciennes données
      // (les anciennes données seront automatiquement filtrées par loadConnectionDays)
      try {
        await supabase
          .from('profiles')
          .update({ 
            week_start_date: currentWeekStartStr,
            week_bonus_available: false,
            week_bonus_claimed: false
            // NE PAS mettre à jour connection_days et claimed_daily_tokens ici
            // car ils seront mis à jour par checkAndUpdateConnectionDay() et claimDailyTokens()
          })
          .eq('id', state.user.id);
      } catch (error) {
        console.error('Erreur lors de la mise à jour de la semaine:', error);
      }
    } else {
      // Même semaine : charger les jours existants
      console.log('✅ MÊME SEMAINE - Chargement des données existantes');
      state.connectionDays = Array.isArray(state.profile.connection_days) 
        ? state.profile.connection_days 
        : [];
      state.weekStartDate = state.profile.week_start_date || currentWeekStartStr;
      console.log('connectionDays chargés:', state.connectionDays);
    }
  } else {
    // Pas de semaine enregistrée : initialiser
    console.log('⚠️ PAS DE SEMAINE ENREGISTRÉE - Initialisation');
    try {
      await resetWeekData(currentWeekStartStr);
    } catch (error) {
      console.error('Erreur lors de l\'initialisation de la semaine:', error);
      // En cas d'erreur, initialiser localement seulement
      state.connectionDays = [];
      state.claimedDailyTokens = [];
      state.weekBonusClaimed = false;
    }
    // S'assurer que state.weekStartDate est défini après resetWeekData()
    state.weekStartDate = currentWeekStartStr;
  }
  
  console.log('=== APRÈS traitement semaine ===');
  console.log('state.connectionDays:', state.connectionDays);
  console.log('state.weekStartDate:', state.weekStartDate);
  console.log('==================================');
  
  // S'assurer que state.weekStartDate est toujours défini
  if (!state.weekStartDate) {
    state.weekStartDate = currentWeekStartStr;
  }
  
  // Charger les jetons réclamés depuis le profil
  // IMPORTANT : Toujours charger depuis state.profile.claimed_daily_tokens qui vient de Supabase
  // Ne pas utiliser state.claimedDailyTokens qui pourrait être vide après resetWeekData()
  
  // DEBUG : Vérifier ce qui est dans state.profile AVANT le traitement
  console.log('=== loadConnectionDays - Chargement claimed_daily_tokens ===');
  console.log('state.profile.claimed_daily_tokens (brut depuis Supabase):', state.profile.claimed_daily_tokens);
  console.log('state.profile.connection_days (brut depuis Supabase):', state.profile.connection_days);
  console.log('currentWeekStartStr:', currentWeekStartStr);
  
  if (!state.profile.claimed_daily_tokens) {
    state.profile.claimed_daily_tokens = [];
  }
  
  // Filtrer les dates réclamées pour ne garder que celles de la semaine actuelle
  // Cela garantit qu'un jour ne peut être réclamé qu'une seule fois par semaine
  const allClaimedTokens = Array.isArray(state.profile.claimed_daily_tokens)
    ? state.profile.claimed_daily_tokens
    : [];
  
  console.log('allClaimedTokens (après extraction):', allClaimedTokens);
  
  // Filtrer pour ne garder que les dates de la semaine actuelle (utilise la fonction utilitaire)
  state.claimedDailyTokens = filterDatesByCurrentWeek(allClaimedTokens, currentWeekStartStr);
  
  console.log('state.claimedDailyTokens (après filtrage):', state.claimedDailyTokens);
  console.log('============================================================');
  
  // IMPORTANT : Si on vient de détecter une nouvelle semaine, state.claimedDailyTokens pourrait être vide
  // mais state.profile.claimed_daily_tokens contient encore les données de Supabase
  // On doit donc s'assurer que state.claimedDailyTokens utilise les données filtrées du profil
  if (state.claimedDailyTokens.length === 0 && allClaimedTokens.length > 0) {
    // Les données existent dans Supabase mais ne sont pas de la semaine actuelle (normal)
    console.log('Les données de Supabase sont d\'une autre semaine, c\'est normal');
  }
  
  // DEBUG : Afficher les données chargées avec plus de détails
  console.log('=== loadConnectionDays - Données chargées ===');
  console.log('connectionDays:', state.connectionDays);
  console.log('claimedDailyTokens:', state.claimedDailyTokens);
  console.log('profile.claimed_daily_tokens:', state.profile.claimed_daily_tokens);
  console.log('weekStartDate:', state.weekStartDate);
  console.log('currentWeekStartStr:', currentWeekStartStr);
  console.log('allClaimedTokens (avant filtrage):', allClaimedTokens);
  console.log('claimedDailyTokens.length:', state.claimedDailyTokens.length);
  console.log('allClaimedTokens.length:', allClaimedTokens.length);
  console.log('===========================================');
  
  // Si les dates filtrées sont différentes de celles du profil, mettre à jour le profil
  if (state.claimedDailyTokens.length !== allClaimedTokens.length) {
    state.profile.claimed_daily_tokens = state.claimedDailyTokens;
    // Sauvegarder dans Supabase pour nettoyer les anciennes dates
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ claimed_daily_tokens: state.claimedDailyTokens })
        .eq('id', state.user.id);
      if (error) {
        console.error('Erreur lors de la sauvegarde des claimed_daily_tokens:', error);
        // En cas d'erreur, sauvegarder dans localStorage comme backup
        if (state.user) {
          try {
            localStorage.setItem(`claimed_tokens_${state.user.id}`, JSON.stringify(state.claimedDailyTokens));
          } catch (e) {
            console.warn('Impossible de sauvegarder dans localStorage:', e);
          }
        }
      }
    } catch (error) {
      console.error('Erreur lors de la sauvegarde des claimed_daily_tokens:', error);
      // En cas d'erreur, sauvegarder dans localStorage comme backup
      if (state.user) {
        try {
          localStorage.setItem(`claimed_tokens_${state.user.id}`, JSON.stringify(state.claimedDailyTokens));
        } catch (e) {
          console.warn('Impossible de sauvegarder dans localStorage:', e);
        }
      }
    }
  }
  
  // IMPORTANT : Ne charger depuis localStorage QUE si les données ne sont pas dans Supabase
  // Si state.profile.claimed_daily_tokens existe mais est vide après filtrage, c'est normal (autre semaine)
  // Ne pas charger depuis localStorage dans ce cas car cela écraserait les données de Supabase
  // localStorage est seulement un backup si la colonne n'existe pas dans Supabase
  const hasClaimedTokensInProfile = state.profile.claimed_daily_tokens && 
                                     Array.isArray(state.profile.claimed_daily_tokens) && 
                                     state.profile.claimed_daily_tokens.length > 0;
  
  // Charger depuis localStorage UNIQUEMENT si :
  // 1. state.claimedDailyTokens est vide (après filtrage)
  // 2. ET state.profile.claimed_daily_tokens n'existe pas ou est vide (colonne absente dans Supabase)
  // 3. ET localStorage contient des données
  if (state.claimedDailyTokens.length === 0 && !hasClaimedTokensInProfile && state.user) {
    try {
      const stored = localStorage.getItem(`claimed_tokens_${state.user.id}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          // Filtrer aussi les dates du localStorage pour ne garder que celles de la semaine actuelle
          if (typeof currentWeekStartStr !== 'undefined') {
            const filteredParsed = filterDatesByCurrentWeek(parsed, currentWeekStartStr);
            state.claimedDailyTokens = filteredParsed;
            state.profile.claimed_daily_tokens = filteredParsed;
          } else {
            console.warn('currentWeekStartStr non défini, utilisation des dates sans filtre');
            state.claimedDailyTokens = parsed;
            state.profile.claimed_daily_tokens = parsed;
          }
        }
      }
    } catch (e) {
      console.warn('Erreur lors du chargement depuis localStorage:', e);
    }
  }
  
  state.weekBonusClaimed = Boolean(state.profile.week_bonus_claimed);
  
  // Vérifier si le bonus est disponible (non réclamé)
  state.canClaimBonus = state.connectionDays.length === 7 && !state.weekBonusClaimed;
  
  // État chargé depuis localStorage ou initialisé
  
  // Ne PAS rendre le calendrier ici car il sera rendu par loadConnectionDays()
  // Cela évite les doubles rendus et les problèmes de synchronisation
  updateCalendarBadge();
}

// Vérifie et met à jour le jour de connexion
// IMPORTANT : Cette fonction ne doit PAS réinitialiser les données car loadConnectionDays() l'a déjà fait
// Elle se contente d'ajouter le jour d'aujourd'hui si nécessaire
async function checkAndUpdateConnectionDay() {
  if (!state.user || !state.profile) return;
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split('T')[0];
  const currentWeekStart = getWeekStartDate(today);
  const currentWeekStartStr = currentWeekStart.toISOString().split('T')[0];
  
  // S'assurer que connectionDays est initialisé (chargé par loadConnectionDays())
  if (!state.connectionDays) {
    state.connectionDays = [];
  }
  
  // IMPORTANT : Ne PAS réinitialiser ici car loadConnectionDays() l'a déjà fait
  // On utilise state.weekStartDate qui a été chargé par loadConnectionDays()
  // Si state.weekStartDate n'est pas défini, c'est que loadConnectionDays() n'a pas encore fini
  // Dans ce cas, on ne fait rien (loadConnectionDays() gérera la réinitialisation)
  if (!state.weekStartDate) {
    // loadConnectionDays() n'a pas encore fini, ne rien faire
    return;
  }
  
  // Vérifier que nous sommes bien dans la même semaine que celle chargée
  if (state.weekStartDate !== currentWeekStartStr) {
    // Nouvelle semaine détectée, mais loadConnectionDays() devrait déjà l'avoir géré
    // Ne rien faire ici pour éviter de réinitialiser les données déjà chargées
    return;
  }
  
  // Filtrer connectionDays pour ne garder que les jours de la semaine actuelle
  // Cela garantit qu'on ne mélange pas les jours de différentes semaines
  const connectionDaysThisWeek = filterDatesByCurrentWeek(state.connectionDays, currentWeekStartStr);
  
  // Ajouter seulement la date d'aujourd'hui si pas déjà présente
  // Les jours précédents sont déjà chargés depuis Supabase via loadConnectionDays()
  if (!connectionDaysThisWeek.includes(todayStr)) {
    connectionDaysThisWeek.push(todayStr);
    state.connectionDays = connectionDaysThisWeek;
    state.profile.connection_days = [...state.connectionDays];
    
    // Vérifier si tous les 7 jours sont connectés
    if (state.connectionDays.length === 7) {
      // Tous les jours sont connectés : rendre le bonus disponible
      state.canClaimBonus = true;
      state.profile.week_bonus_available = true;
    }
    
    // Sauvegarder dans Supabase seulement si on a ajouté un nouveau jour
    await supabase
      .from('profiles')
      .update({ 
        connection_days: state.connectionDays,
        week_bonus_available: state.profile.week_bonus_available
      })
      .eq('id', state.user.id);
  } else {
    // Le jour est déjà présent, juste mettre à jour state.connectionDays avec les jours filtrés
    state.connectionDays = connectionDaysThisWeek;
    state.profile.connection_days = [...state.connectionDays];
    
    // Vérifier si tous les 7 jours sont connectés (même si on n'a rien ajouté)
    if (state.connectionDays.length === 7) {
      state.canClaimBonus = true;
      state.profile.week_bonus_available = true;
    }
  }
  
  // Rendre le calendrier seulement si nécessaire (pas de double rendu)
  // Le calendrier est déjà rendu par loadConnectionDays(), donc on ne le rend que si on a modifié quelque chose
  if (state.connectionDays && state.connectionDays.length > 0) {
    renderCalendar();
  }
  updateCalendarBadge();
}

// Rend le calendrier des 7 jours
function renderCalendar() {
  if (!els.calendarWeek) {
    console.warn('renderCalendar: els.calendarWeek n\'existe pas');
    return;
  }
  
  // S'assurer que connectionDays est initialisé
  if (!state.connectionDays) {
    state.connectionDays = [];
  }
  
  // IMPORTANT : Toujours utiliser isDayClaimed() pour vérifier si un jour est réclamé
  // Cette fonction vérifie à la fois dans state.claimedDailyTokens ET dans state.profile.claimed_daily_tokens
  // Cela garantit la synchronisation même si renderCalendar() est appelé plusieurs fois
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split('T')[0];
  const currentWeekStart = getWeekStartDate(today);
  const currentWeekStartStr = currentWeekStart.toISOString().split('T')[0];
  
  // DEBUG : Afficher les données utilisées pour le rendu
  console.log('=== renderCalendar - Données utilisées ===');
  console.log('state.claimedDailyTokens:', state.claimedDailyTokens);
  console.log('state.profile.claimed_daily_tokens:', state.profile?.claimed_daily_tokens);
  console.log('currentWeekStartStr:', currentWeekStartStr);
  console.log('==========================================');
  
  // Rendu du calendrier
  
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
    const isConnected = state.connectionDays && state.connectionDays.includes(dayStr);
    // Vérifier que le jour est dans la semaine actuelle avant de vérifier s'il est réclamé
    const isInCurrentWeek = isDateInCurrentWeek(dayStr, currentWeekStartStr);
    
    // Vérifier si le jour est réclamé (utilise la fonction utilitaire qui vérifie state ET profil)
    const isClaimed = isInCurrentWeek && isDayClaimed(dayStr, currentWeekStartStr);
    const isToday = dayStr === todayStr;
    
    // Déterminer l'état du jour
    let dayState = 'not-available'; // Par défaut : non disponible
    let clickable = false;
    let tokenInfo = '';
    
    if (isConnected) {
      if (isClaimed) {
        dayState = 'claimed'; // Déjà récupéré
        clickable = false;
        tokenInfo = '';
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
  if (days.length === 0) {
    console.error('renderCalendar: Aucun jour généré !');
    return;
  }
  
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
    
    if (!dayStr) return;
    
    // Vérifier si une réclamation est déjà en cours (verrou)
    if (state.isClaimingTokens) {
      console.warn('Une réclamation est déjà en cours, veuillez patienter...');
      return;
    }
    
    // Vérifier si ce jour est déjà en cours de réclamation
    if (state.claimingDay === dayStr) {
      console.warn('Ce jour est déjà en cours de réclamation');
      return;
    }
    
    // Vérifier que le jour est dans la semaine actuelle
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const currentWeekStart = getWeekStartDate(today);
    const currentWeekStartStr = currentWeekStart.toISOString().split('T')[0];
    
    if (!isDateInCurrentWeek(dayStr, currentWeekStartStr)) {
      console.warn('Le jour demandé n\'est pas dans la semaine actuelle');
      renderCalendar();
      return;
    }
    
    // Vérifier directement le state actuel (pas seulement le tableau days)
    // Cela évite les problèmes si l'utilisateur clique rapidement plusieurs fois
    const isConnected = state.connectionDays && state.connectionDays.includes(dayStr);
    const allDaysConnected = state.connectionDays && state.connectionDays.length === 7;
    
    // Vérifier si le jour est réclamé (utilise la fonction utilitaire)
    if (isDayClaimed(dayStr, currentWeekStartStr)) {
      console.warn('Jetons déjà récupérés pour ce jour:', dayStr);
      renderCalendar();
      return;
    }
    
    // Vérifier si c'est le dimanche avec bonus disponible
    // Le dimanche est le 7ème jour de la semaine (lundi = jour 0, dimanche = jour 6 dans le tableau)
    const day = new Date(dayStr + 'T00:00:00');
    const dayOfWeek = day.getDay(); // 0 = dimanche, 1 = lundi, etc.
    const isSunday = dayOfWeek === 0; // Dimanche = 0
    
    if (isSunday && allDaysConnected && !state.weekBonusClaimed && !state.profile?.week_bonus_claimed) {
      handleClaimBonus();
      return;
    }
    
    // Vérifier que le jour est connecté et pas déjà réclamé
    if (isConnected && !isDayClaimed(dayStr, currentWeekStartStr)) {
      claimDailyTokens(dayStr);
    } else {
      console.warn('Jour non disponible pour récupération:', { isConnected, dayStr });
      // Re-rendre le calendrier pour mettre à jour l'affichage
      renderCalendar();
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
  // Réclamation des jetons journaliers
  
  // Vérifier le verrou : si une réclamation est déjà en cours, ignorer
  if (state.isClaimingTokens) {
    console.warn('Une réclamation est déjà en cours, ignorer ce nouvel appel');
    return;
  }
  
  // Vérifier si ce jour est déjà en cours de réclamation
  if (state.claimingDay === dayStr) {
    console.warn('Ce jour est déjà en cours de réclamation');
    return;
  }
  
  if (!state.user || !state.profile) {
    console.warn('Utilisateur ou profil non disponible');
    return;
  }
  
  // Vérifier que le jour est disponible (connecté et pas déjà récupéré)
  if (!state.connectionDays || !state.connectionDays.includes(dayStr)) {
    console.warn('Jour non connecté, impossible de récupérer les jetons. Jour:', dayStr, 'Jours connectés:', state.connectionDays);
    return;
  }
  
  // Vérifier que le jour est dans la semaine actuelle
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const currentWeekStart = getWeekStartDate(today);
  const currentWeekStartStr = currentWeekStart.toISOString().split('T')[0];
  
  if (!isDateInCurrentWeek(dayStr, currentWeekStartStr)) {
    console.warn('Le jour demandé n\'est pas dans la semaine actuelle');
    renderCalendar();
    updateCalendarBadge();
    return;
  }
  
  // S'assurer que claimedDailyTokens est initialisé (mais ne pas écraser s'il existe déjà)
  // IMPORTANT : Charger depuis le profil si le state n'est pas encore initialisé
  if (!state.claimedDailyTokens) {
    // Si pas encore chargé, essayer de charger depuis le profil
    if (state.profile?.claimed_daily_tokens) {
      state.claimedDailyTokens = filterDatesByCurrentWeek(
        Array.isArray(state.profile.claimed_daily_tokens) 
          ? state.profile.claimed_daily_tokens 
          : [],
        currentWeekStartStr
      );
    } else {
      state.claimedDailyTokens = [];
    }
  }
  
  // S'assurer que le profil a aussi les données
  if (!state.profile.claimed_daily_tokens) {
    state.profile.claimed_daily_tokens = [];
  }
  
  // Vérification avant réclamation (utilise la fonction utilitaire)
  if (isDayClaimed(dayStr, currentWeekStartStr)) {
    console.warn('❌ Jetons déjà récupérés pour ce jour:', dayStr);
    // Recharger depuis Supabase pour s'assurer de la synchronisation
    await fetchProfile();
    renderCalendar();
    updateCalendarBadge();
    return;
  }
  
  // S'assurer que connectionDays est bien initialisé et contient des données
  if (!state.connectionDays || state.connectionDays.length === 0) {
    console.warn('connectionDays non initialisé, rechargement du profil...');
    await loadConnectionDays();
    // Vérifier à nouveau après le rechargement
    if (!state.connectionDays || !state.connectionDays.includes(dayStr)) {
      console.warn('Jour non connecté après rechargement');
      renderCalendar();
      updateCalendarBadge();
      return;
    }
    // Après le rechargement, vérifier à nouveau si le jour n'a pas déjà été réclamé
    // Cela garantit qu'un jour ne peut être réclamé qu'une seule fois même après un refresh
    if (isDayClaimed(dayStr, currentWeekStartStr)) {
      console.warn('Jour déjà réclamé après rechargement du profil');
      renderCalendar();
      updateCalendarBadge();
      return;
    }
  }
  
  // ACTIVER LE VERROU : empêcher les appels multiples simultanés
  state.isClaimingTokens = true;
  state.claimingDay = dayStr;
  
  try {
    // IMPORTANT : Mettre à jour le state local IMMÉDIATEMENT pour éviter les doubles clics
    // Cela empêche l'utilisateur de cliquer plusieurs fois avant que la sauvegarde soit terminée
    const newTokens = (state.tokens || 0) + 2;
    const updatedClaimed = [...state.claimedDailyTokens, dayStr];
    
    // Mettre à jour le state local AVANT la sauvegarde Supabase
    state.tokens = newTokens;
    state.profile.tokens = newTokens;
    state.claimedDailyTokens = updatedClaimed;
    if (!state.profile.claimed_daily_tokens) {
      state.profile.claimed_daily_tokens = [];
    }
    state.profile.claimed_daily_tokens = updatedClaimed;
    
    // Re-rendre le calendrier immédiatement pour désactiver le bouton
    renderCalendar();
    updateCalendarBadge();
    
  
    // Mettre à jour dans Supabase
    console.log('=== claimDailyTokens - Sauvegarde dans Supabase ===');
    console.log('updatedClaimed:', updatedClaimed);
    console.log('newTokens:', newTokens);
    
    const { error: updateError, data: updateData } = await supabase
      .from('profiles')
      .update({ 
        tokens: newTokens,
        claimed_daily_tokens: updatedClaimed
      })
      .eq('id', state.user.id)
      .select('claimed_daily_tokens');
    
    console.log('Résultat de la sauvegarde:', { error: updateError, data: updateData });
    console.log('===================================================');
    
    if (updateError) {
      console.error('Erreur lors de la réclamation des jetons journaliers:', updateError);
      // Si la colonne n'existe pas, essayer sans
      if (updateError.message && updateError.message.includes('claimed_daily_tokens')) {
        console.warn('Colonne claimed_daily_tokens absente dans la base de données. Veuillez exécuter le script SQL add_tokens_columns.sql pour ajouter cette colonne.');
        console.warn('En attendant, les jetons sont mis à jour mais les données de récupération sont stockées localement uniquement.');
        
        // Mettre à jour uniquement les jetons (sans la colonne claimed_daily_tokens)
        const { error: retryError } = await supabase
          .from('profiles')
          .update({ tokens: newTokens })
          .eq('id', state.user.id);
        
        if (!retryError) {
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
          showTokenRewardNotification(2);
        } else {
          console.error('Erreur lors de la mise à jour des jetons:', retryError);
          // En cas d'erreur, annuler les changements locaux et recharger depuis Supabase
          state.tokens = (state.tokens || 0) - 2;
          state.profile.tokens = state.tokens;
          state.claimedDailyTokens = state.claimedDailyTokens.filter(d => d !== dayStr);
          state.profile.claimed_daily_tokens = state.claimedDailyTokens;
          // Recharger depuis Supabase pour récupérer l'état réel
          await fetchProfile();
          renderCalendar();
          updateCalendarBadge();
        }
      } else {
        // En cas d'erreur, annuler les changements locaux et recharger depuis Supabase
        state.tokens = (state.tokens || 0) - 2;
        state.profile.tokens = state.tokens;
        state.claimedDailyTokens = state.claimedDailyTokens.filter(d => d !== dayStr);
        state.profile.claimed_daily_tokens = state.claimedDailyTokens;
        // Recharger depuis Supabase pour récupérer l'état réel
        await fetchProfile();
        renderCalendar();
        updateCalendarBadge();
      }
    } else {
      // Succès : les données sont déjà dans le state local et sauvegardées dans Supabase
      // Ne PAS recharger le profil immédiatement car cela pourrait causer des problèmes de synchronisation
      // Le state local est déjà à jour avec les bonnes données
      // Jetons récupérés avec succès
      
      // Animation sur la case du calendrier
      const dayEl = els.calendarWeek?.querySelector(`[data-day="${dayStr}"]`);
      if (dayEl) {
        createTokenClaimAnimation(dayEl, 2);
      }
      
      // Mettre à jour l'affichage
      updateTokensDisplay();
      updateCalendarBadge(); // Mettre à jour la pastille du bouton calendrier
      
      // Afficher une notification
      showTokenRewardNotification(2);
      
      // Ne PAS recharger fetchProfile() ici car :
      // 1. Le state local est déjà correct et à jour
      // 2. La sauvegarde Supabase vient d'être faite avec succès
      // 3. Recharger immédiatement pourrait récupérer des données non synchronisées
      // 4. Le rechargement se fera naturellement au prochain chargement de page
    }
  } finally {
    // DÉSACTIVER LE VERROU : toujours libérer le verrou, même en cas d'erreur
    state.isClaimingTokens = false;
    state.claimingDay = null;
  }
}

// Gère la réclamation du bonus de 3 jetons (depuis la case du dimanche)
async function handleClaimBonus() {
  if (!state.user || !state.profile) return;
  
  // Vérifier le verrou : si une réclamation est déjà en cours, ignorer
  if (state.isClaimingTokens) {
    console.warn('Une réclamation est déjà en cours, ignorer ce nouvel appel');
    return;
  }
  
  // Vérifier que tous les jours sont connectés
  if (!state.connectionDays || state.connectionDays.length !== 7) {
    console.warn('Tous les jours doivent être connectés pour récupérer le bonus');
    return;
  }
  
  // Vérifier que le bonus n'a pas déjà été récupéré
  // Vérifier à la fois dans le state local ET dans le profil (pour éviter les problèmes de synchronisation)
  if (state.weekBonusClaimed || state.profile?.week_bonus_claimed) {
    console.warn('Bonus déjà récupéré cette semaine');
    // Recharger le profil depuis Supabase pour s'assurer de la synchronisation
    await fetchProfile();
    renderCalendar();
    updateCalendarBadge();
    return;
  }
  
  // Trouver la date du dimanche de la semaine
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const currentWeekStart = getWeekStartDate(today);
  const sunday = new Date(currentWeekStart);
  sunday.setDate(currentWeekStart.getDate() + 6); // Dimanche est le 7ème jour
  const sundayStr = sunday.toISOString().split('T')[0];
  
  // ACTIVER LE VERROU : empêcher les appels multiples simultanés
  state.isClaimingTokens = true;
  state.claimingDay = sundayStr;
  
  try {
    // IMPORTANT : Mettre à jour le state local IMMÉDIATEMENT pour éviter les doubles clics
    // Cela empêche l'utilisateur de cliquer plusieurs fois avant que la sauvegarde soit terminée
    const newTokens = (state.tokens || 0) + 3;
    const updatedClaimed = [...(state.claimedDailyTokens || []), sundayStr];
    
    // Mettre à jour le state local AVANT la sauvegarde Supabase
    state.tokens = newTokens;
    state.profile.tokens = newTokens;
    state.canClaimBonus = false;
    state.weekBonusClaimed = true;
    state.profile.week_bonus_available = false;
    state.profile.week_bonus_claimed = true;
    state.claimedDailyTokens = updatedClaimed;
    if (!state.profile.claimed_daily_tokens) {
      state.profile.claimed_daily_tokens = [];
    }
    state.profile.claimed_daily_tokens = updatedClaimed;
    
    // Re-rendre le calendrier immédiatement pour désactiver le bouton
    renderCalendar();
    updateCalendarBadge();
    
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
    
    if (error) {
      console.error('Erreur lors de la réclamation du bonus:', error);
      // En cas d'erreur, annuler les changements locaux et recharger depuis Supabase
      state.tokens = (state.tokens || 0) - 3;
      state.profile.tokens = state.tokens;
      state.canClaimBonus = true;
      state.weekBonusClaimed = false;
      state.profile.week_bonus_available = true;
      state.profile.week_bonus_claimed = false;
      state.claimedDailyTokens = state.claimedDailyTokens.filter(d => d !== sundayStr);
      state.profile.claimed_daily_tokens = state.claimedDailyTokens;
      // Recharger depuis Supabase pour récupérer l'état réel
      await fetchProfile();
      renderCalendar();
      updateCalendarBadge();
    } else {
      // Succès : les données sont déjà dans le state local et sauvegardées dans Supabase
      // Ne PAS recharger le profil immédiatement car le state local est déjà à jour
      // Le rechargement se fera naturellement au prochain chargement de page
      
      // Animation sur la case du dimanche
      const sundayEl = els.calendarWeek?.querySelector(`[data-day="${sundayStr}"]`);
      if (sundayEl) {
        createTokenClaimAnimation(sundayEl, 3);
        createConfettiAnimation(sundayEl);
      }
      
      // Mettre à jour l'affichage
      updateTokensDisplay();
      updateCalendarBadge();
      
      // Afficher une notification
      showTokenRewardNotification(3, 'bonus');
    }
  } finally {
    // DÉSACTIVER LE VERROU : toujours libérer le verrou, même en cas d'erreur
    state.isClaimingTokens = false;
    state.claimingDay = null;
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

// Fonction supprimée - la pastille sur le bouton roue n'est plus utilisée
function updateWheelBadge() {
  // Fonction désactivée - la pastille a été supprimée
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
// Cette fonction tente de verrouiller l'orientation en mode portrait
// Si l'API n'est pas disponible, l'orientation reste libre (pas de message bloquant)
function lockOrientation() {
  // Utiliser l'API Screen Orientation si disponible
  if (screen.orientation && screen.orientation.lock) {
    screen.orientation.lock('portrait').catch(() => {
      // L'API peut échouer si elle n'est pas supportée ou si l'utilisateur l'a désactivée
      // Pas de message d'erreur - on laisse l'utilisateur utiliser l'app normalement
      console.log('Lock orientation non disponible - l\'app fonctionne quand même');
    });
  }
  
  // Note : On ne met plus d'écouteur orientationchange car on ne veut pas de message
  // L'API Screen Orientation verrouille directement l'orientation si elle est supportée
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

