// App front-end de BadgeLife
// Utilise Supabase (base de données + auth) et une UI 100% front.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, PUBLIC_APP_URL } from './config.js';
import { isMysteryLevel } from './badgeCalculations.js';
import { parseConfig, safeSupabaseSelect, pseudoToEmail, isAdminUser, isValidEmail } from './utils.js';
import * as Subscriptions from './subscriptions.js';
import * as SubscriptionUI from './subscriptionUI.js';
import * as NotificationUI from './notificationUI.js';
import { createDailyTokensNotification, createSundayBonusNotification, markAllNotificationsAsRead } from './notifications.js';
import * as BadgeSuspicions from './badgeSuspicions.js';
import { logModalDebugInfo } from './modalDebug.js';

// Nom du bucket d'avatars dans Supabase Storage
const AVATAR_BUCKET = 'avatars';

// Configuration des jetons
const DAILY_TOKENS_AMOUNT = 3; // Nombre de jetons reçus par jour de connexion
const SUNDAY_BONUS_AMOUNT = 5; // Nombre de jetons bonus reçus le dimanche si tous les jours de la semaine sont connectés
const SIGNUP_TOKENS_AMOUNT = 3; // Nombre de jetons donnés aux nouveaux utilisateurs lors de l'inscription

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
  ideaFilter: 'recent', // 'recent', 'liked'
  lowSkillBadges: new Set(), // ids des badges low skill
  userBadges: new Set(),
  userBadgeLevels: new Map(),
  userBadgeAnswers: new Map(), // stocke la réponse saisie par badge
  blockedBySuspicions: new Set(), // badges bloqués par soupçons
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
  wheelThemeIds: null, // Signature des thèmes dans la roue (pour éviter de remélanger inutilement)
  wheelOrder: [], // Ordre des éléments dans la roue
  isClaimingTokens: false, // Verrou pour empêcher les appels multiples simultanés à claimDailyTokens
  claimingDay: null, // Jour en cours de réclamation (pour éviter les doubles clics)
  modifyBadgeCost: null, // Coût en jetons de la modification en cours (2 pour joker, 5 pour section amélioration)
  communityFilterMode: 'all', // 'all' pour tous, 'top' pour top profil, 'friends' pour mes potes
  mutualFriends: [], // Liste des amis mutuels
  communityRefreshTimeout: null, // Timer pour rafraîchir la communauté (realtime)
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

// Helper : calcule les points de skills actuels de l'utilisateur
function calculateCurrentSkillPoints() {
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
  return tempSkillPoints;
}

// Calcule le pourcentage de badges débloqués pour un thème donné
function calculateThemeProgress(themeName) {
  const themeNameFunc = (b) => (b.theme && String(b.theme).trim()) ? String(b.theme).trim() : 'Autres';
  
  // Calculer les points de skills une seule fois (utilisé pour vérifier les conditions des badges fantômes)
  const tempSkillPoints = calculateCurrentSkillPoints();
  
  // Cas spécial pour "Badges cachés" : compter tous les badges fantômes
  if (themeName === 'Badges cachés') {
    // Filtrer uniquement les badges fantômes
    const ghostBadges = state.badges.filter(badge => isGhostBadge(badge));
    
    // Compter les badges fantômes débloqués
    let unlocked = 0;
    const total = ghostBadges.length; // Total de tous les badges fantômes
    
    ghostBadges.forEach(badge => {
      const shouldBeUnlocked = checkGhostBadgeConditionsForUser(badge, state.userBadges, tempSkillPoints);
      if (shouldBeUnlocked) {
        unlocked++;
      }
    });
    
    const percentage = total > 0 ? Math.round((unlocked / total) * 100) : 0;
    const isComplete = percentage === 100;
    
    return { unlocked, total, percentage, isComplete };
  }
  
  // Pour les autres thèmes, logique normale
  
  // Filtrer les badges du thème
  const themeBadges = state.badges.filter(badge => {
    const badgeTheme = themeNameFunc(badge);
    return badgeTheme === themeName;
  });
  
  // Compter les badges débloqués du thème
  let unlocked = 0;
  let total = 0;
  
  themeBadges.forEach(badge => {
    const isUnlocked = state.userBadges.has(badge.id);
    const isGhost = isGhostBadge(badge);
    
    if (isGhost) {
      // Pour les badges fantômes, vérifier s'ils devraient être débloqués
      const shouldBeUnlocked = checkGhostBadgeConditionsForUser(badge, state.userBadges, tempSkillPoints);
      if (shouldBeUnlocked) {
        // Badge fantôme débloqué : compte dans le total et dans les débloqués
        total++;
        unlocked++;
      }
      // Si le badge fantôme n'est pas débloqué, il ne compte pas dans le total
    } else {
      // Badge normal : toujours compté dans le total
      total++;
      if (isUnlocked) {
        unlocked++;
      }
    }
  });
  
  const percentage = total > 0 ? Math.round((unlocked / total) * 100) : 0;
  const isComplete = percentage === 100;
  
  return { unlocked, total, percentage, isComplete };
}

// Récupère tous les thèmes uniques (y compris ceux complétés à 100%)
function getAllThemes() {
  const themeNameFunc = (b) => (b.theme && String(b.theme).trim()) ? String(b.theme).trim() : 'Autres';
  const themesSet = new Set();
  
  // Calculer les points de skills une seule fois pour tous les badges fantômes
  const tempSkillPoints = calculateCurrentSkillPoints();
  
  // Vérifier si au moins un badge fantôme est débloqué
  let hasUnlockedGhostBadge = false;
  const ghostBadges = state.badges.filter(badge => isGhostBadge(badge));
  
  for (const badge of ghostBadges) {
    const shouldBeUnlocked = checkGhostBadgeConditionsForUser(badge, state.userBadges, tempSkillPoints);
    if (shouldBeUnlocked) {
      hasUnlockedGhostBadge = true;
      break;
    }
  }
  
  state.badges.forEach(badge => {
    // Exclure uniquement les badges fantômes non débloqués
    if (isGhostBadge(badge)) {
      const shouldBeUnlocked = checkGhostBadgeConditionsForUser(badge, state.userBadges, tempSkillPoints);
      if (!shouldBeUnlocked) {
        return; // Badge fantôme non débloqué, ne pas compter son thème
      }
    }
    
    const theme = themeNameFunc(badge);
    themesSet.add(theme);
  });
  
  // Ajouter "Badges cachés" seulement si au moins un badge fantôme est débloqué
  if (hasUnlockedGhostBadge) {
    themesSet.add('Badges cachés');
  }
  
  return Array.from(themesSet).sort(compareThemesFixed);
}

// Affiche le slider de thèmes avec les cartes et barres de progression
function renderThemesSlider() {
  if (!els.themesSlider) {
    return;
  }
  
  const allThemes = getAllThemes();
  
  if (allThemes.length === 0) {
    els.themesSlider.innerHTML = '<p class="muted" style="text-align: center; padding: 20px;">Aucun thème disponible.</p>';
    if (els.themesCompletedCount) {
      els.themesCompletedCount.textContent = '0/0';
    }
    return;
  }
  
  // Calculer le nombre de thèmes complétés et trier les thèmes
  let completedCount = 0;
  const themesWithProgress = allThemes.map(themeName => {
    const progress = calculateThemeProgress(themeName);
    if (progress.isComplete) {
      completedCount++;
    }
    return { themeName, progress };
  });
  
  // Séparer "Badges cachés" des autres thèmes
  const hiddenTheme = themesWithProgress.find(t => t.themeName === 'Badges cachés');
  const otherThemes = themesWithProgress.filter(t => t.themeName !== 'Badges cachés');
  
  // Trier les autres thèmes du moins complet au plus complet (par pourcentage croissant)
  otherThemes.sort((a, b) => {
    // Trier par pourcentage de complétion (croissant : du moins complet au plus complet)
    return a.progress.percentage - b.progress.percentage;
  });
  
  // Réorganiser : thèmes non complétés, puis thèmes complétés à 100%, puis "Badges cachés" à la fin
  const incompleteThemes = otherThemes.filter(t => !t.progress.isComplete);
  const completeThemes = otherThemes.filter(t => t.progress.isComplete);
  
  // Reconstruire la liste : incomplets, puis complétés, puis "Badges cachés" à la fin
  const sortedThemes = [...incompleteThemes, ...completeThemes];
  if (hiddenTheme) {
    sortedThemes.push(hiddenTheme);
  }
  
  // Mettre à jour le compteur de thèmes complétés
  if (els.themesCompletedCount) {
    els.themesCompletedCount.textContent = `${completedCount}/${allThemes.length}`;
  }
  
  els.themesSlider.innerHTML = '';
  
  sortedThemes.forEach(({ themeName, progress }) => {
    // Créer la carte de thème
    const themeCard = document.createElement('button');
    themeCard.className = 'theme-card';
    themeCard.type = 'button';
    themeCard.dataset.theme = themeName;
    
    // Le thème "Badges cachés" n'est jamais cliquable
    const isHiddenTheme = themeName === 'Badges cachés';
    
    // Si le thème est complété à 100% ou si c'est "Badges cachés", désactiver
    if (progress.isComplete || isHiddenTheme) {
      themeCard.classList.add('theme-complete');
      themeCard.disabled = true;
    }
    
    // Contenu de la carte
    themeCard.innerHTML = `
      <div class="theme-card-header">
        <h4 class="theme-name">${themeName}</h4>
        ${progress.isComplete ? '<span class="theme-complete-badge">100% complété</span>' : ''}
      </div>
      <div class="theme-progress-container">
        <div class="theme-progress-bar">
          <div class="theme-progress-fill" style="width: ${progress.percentage}%"></div>
        </div>
        <div class="theme-progress-text">
          <span class="theme-progress-percentage">${progress.percentage}%</span>
          <span class="theme-progress-count">${progress.unlocked}/${progress.total}</span>
        </div>
      </div>
      ${!progress.isComplete && !isHiddenTheme ? '<span class="theme-cost">Réponds à une question (1 jeton)</span>' : ''}
    `;
    
    // Attacher l'événement de clic seulement si le thème n'est pas complété et n'est pas "Badges cachés"
    if (!progress.isComplete && !isHiddenTheme) {
      themeCard.addEventListener('click', () => handleThemeButtonClick(themeName));
    }
    
    els.themesSlider.appendChild(themeCard);
  });
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
  // Ajouter une classe sur body pour les styles iOS
  document.body.classList.add('profile-drawer-open');
  if (state.profile) {
    if (els.profileName) els.profileName.value = state.profile.username || '';
    if (els.profileEmail) els.profileEmail.value = state.profile.email || '';
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
  // Retirer la classe sur body
  document.body.classList.remove('profile-drawer-open');
  // Fermer l'infobulle si elle est ouverte
  if (els.profileNameTooltip) {
    els.profileNameTooltip.classList.add('hidden');
  }
}

// Gérer le splash screen de Capacitor
async function initSplashScreen() {
  // Vérifier si on est sur une plateforme native Capacitor
  if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
    try {
      // Importer le plugin SplashScreen
      const { SplashScreen } = await import('@capacitor/splash-screen');
      
      // Attendre que l'app soit prête avant de cacher le splash screen
      // Le splash screen se cache automatiquement après launchShowDuration (2 secondes)
      // Mais on peut aussi le cacher manuellement quand l'app est prête
      
      // Optionnel : garder le splash screen visible jusqu'à ce que l'app soit chargée
      // await SplashScreen.show({
      //   showDuration: 2000,
      //   autoHide: false
      // });
      
      console.log('[SplashScreen] Plugin initialisé');
    } catch (error) {
      console.warn('[SplashScreen] Plugin non disponible:', error);
    }
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  // Initialiser le splash screen en premier
  await initSplashScreen();
  
  cacheElements();
  bindRankTooltip();
  attachAuthTabListeners();
  attachFormListeners();
  attachNavListeners();
  attachProfileListeners();
  attachSettingsMenuListeners();
  attachCommunitySearchListener();
  attachCommunityTabListeners();
  attachCommunityFilterListeners();
  attachIdeaListeners();
  attachTokensTooltip();
  // Slider de thèmes initialisé
  attachCalendarListeners();
  attachProfileBadgesSlideListeners();
  lockOrientation();
  
  // Attacher l'événement au bouton "Améliore un badge"
  if (els.improveBadgeBtn) {
    els.improveBadgeBtn.addEventListener('click', handleImproveBadgeFromWheel);
    
    // Navigation entre sections dans l'onglet "à débloquer"
    if (els.navThemesBtn) {
      els.navThemesBtn.addEventListener('click', () => switchAllBadgesSection('themes'));
    }
    if (els.navImproveBtn) {
      els.navImproveBtn.addEventListener('click', () => switchAllBadgesSection('improve'));
    }
  }
  bootstrapSession();
});

function cacheElements() {
  els.authView = document.getElementById('auth-view');
  els.appView = document.getElementById('app-view');
  els.loginLoader = document.getElementById('login-loader');
  els.authMessage = document.getElementById('auth-message');
  els.authFormCard = document.getElementById('auth-form-card');
  els.authFormClose = document.getElementById('auth-form-close');
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
  els.editProfileBtn = document.getElementById('edit-profile-btn-main');
  els.shareProfileBtn = document.getElementById('share-profile-btn');
  els.profilePrivacyBtn = document.getElementById('profile-privacy-btn');
  els.profilePrivacyIndicator = document.getElementById('profile-privacy-indicator');
  els.profilePanel = document.getElementById('profile-panel');
  els.profileForm = document.getElementById('profile-form');
  els.profileCloseBtn = document.getElementById('profile-close-btn');
  els.profileOverlay = document.getElementById('profile-overlay');
  els.profileName = document.getElementById('profile-name');
  els.profileEmail = document.getElementById('profile-email');
  els.profilePassword = document.getElementById('profile-password');
  els.profileAvatar = document.getElementById('profile-avatar');
  els.profileMessage = document.getElementById('profile-message');
  els.profileNameTooltip = document.getElementById('profile-name-tooltip');
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
  els.profileSectionCompletion = document.getElementById('profile-section-completion');
  els.profileSectionRank = document.getElementById('profile-section-rank');
  els.myBadgesList = document.getElementById('my-badges-list');
  els.allBadgesList = document.getElementById('all-badges-list');
  els.communityList = document.getElementById('community-list');
  els.communityProfileModal = document.getElementById('community-profile-modal');
  els.communityProfileSuspicionDescription = document.getElementById('community-profile-suspicion-description');
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
  els.communityFilterAll = document.getElementById('community-filter-all');
  els.communityFilterTop = document.getElementById('community-filter-top');
  els.communityFilterFriends = document.getElementById('community-filter-friends');
  els.communityFilterDescription = document.getElementById('community-filter-description');
  els.ideaForm = document.getElementById('idea-form');
  els.ideaFormToggle = document.getElementById('idea-form-toggle');
  els.ideaFormCancel = document.getElementById('idea-form-cancel');
  els.ideaTitle = document.getElementById('idea-title');
  els.ideaEmoji = document.getElementById('idea-emoji');
  els.ideaDescription = document.getElementById('idea-description');
  els.ideaMessage = document.getElementById('idea-message');
  els.ideaList = document.getElementById('idea-list');
  els.ideaFilterRecent = document.getElementById('idea-filter-recent');
  els.ideaFilterLiked = document.getElementById('idea-filter-liked');
  // Éléments des jetons et slider de thèmes
  els.tokensCounter = document.getElementById('tokens-counter');
  els.tokensCount = document.getElementById('tokens-count');
  els.themesSlider = document.getElementById('themes-slider');
  els.navThemesBtn = document.getElementById('nav-themes-btn');
  els.navImproveBtn = document.getElementById('nav-improve-btn');
  els.themesSection = document.getElementById('themes-section');
  els.improveSection = document.getElementById('improve-section');
  els.themesCompletedCount = document.getElementById('themes-completed-count');
  els.badgeQuestionContainer = document.getElementById('badge-question-container');
  els.badgeQuestionOverlay = document.getElementById('badge-question-overlay');
  els.selectedBadgeName = document.getElementById('selected-badge-name');
  els.selectedBadgeQuestion = document.getElementById('selected-badge-question');
  els.badgeAnswerForm = document.getElementById('badge-answer-form');
  els.badgeAnswerInput = document.getElementById('badge-answer-input');
  els.badgeAnswerMessage = document.getElementById('badge-answer-message');
  els.modifyBadgeOverlay = document.getElementById('modify-badge-overlay');
  els.tokensTooltip = document.getElementById('tokens-tooltip');
  els.improveBadgeBtn = document.getElementById('improve-badge-btn');
  // Éléments du calendrier
  els.calendarBtn = document.getElementById('calendar-btn');
  els.calendarBadge = document.getElementById('calendar-badge');
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
  { min: 60, name: 'Aisée', color: '#14b8a6' },     // Teal
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
  
  // Overlay pour fermer le calendrier (uniquement si le clic est directement sur l'overlay, pas sur le drawer)
  if (els.calendarOverlay) {
    els.calendarOverlay.addEventListener('click', (e) => {
      // Ne fermer que si le clic est directement sur l'overlay, pas sur le drawer qui est au-dessus
      if (e.target === els.calendarOverlay) {
        closeCalendarDrawer();
      }
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
      const target = btn.dataset.authTab;
      
      // Afficher la card du formulaire si elle est cachée
      if (els.authFormCard && els.authFormCard.classList.contains('hidden')) {
        els.authFormCard.classList.remove('hidden');
      }
      
      // Cacher le formulaire actuellement visible
      if (!els.loginForm.classList.contains('hidden')) {
        els.loginForm.classList.add('hidden');
      }
      if (!els.signupForm.classList.contains('hidden')) {
        els.signupForm.classList.add('hidden');
      }
      
      // Afficher le formulaire correspondant avec animation
      setTimeout(() => {
        if (target === 'login') {
          els.loginForm.classList.remove('hidden');
        } else {
          els.signupForm.classList.remove('hidden');
        }
      }, 50);
      
      setMessage('');
    });
  });

  // Bouton pour fermer le formulaire
  if (els.authFormClose) {
    els.authFormClose.addEventListener('click', () => {
      if (els.authFormCard) {
        els.authFormCard.classList.add('hidden');
      }
      if (els.loginForm) els.loginForm.classList.add('hidden');
      if (els.signupForm) els.signupForm.classList.add('hidden');
      setMessage('');
    });
  }
}

function attachFormListeners() {
  els.loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const usernameOrEmail = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value.trim();
    if (!usernameOrEmail) return setMessage('Entre ton pseudo ou ton email.', true);
    setMessage('Connexion en cours...');
    
    // Afficher le loader
    showLoginLoader();
    
    // Détecter si c'est un email ou un pseudo
    // - Si email : on s'en sert directement.
    // - Si pseudo : on cherche l'email associé dans la table profils.
    let email = usernameOrEmail;
    if (!isValidEmail(usernameOrEmail)) {
      const { data: profiles, error: profileError } = await supabase
        .from('profiles')
        .select('email')
        .ilike('username', usernameOrEmail)
        .limit(1);
      
      if (profileError) {
        hideLoginLoader();
        return setMessage('Impossible de vérifier ce pseudo. Réessaie dans un instant.', true);
      }

      const profileEmail = profiles?.[0]?.email;
      if (!profileEmail) {
        hideLoginLoader();
        return setMessage('Ce pseudo est introuvable. Utilise ton email ou corrige le pseudo.', true);
      }
      email = profileEmail;
    }
    
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      // Cacher le loader en cas d'erreur
      hideLoginLoader();
      // Message plus clair : pas de connexion si le compte n'existe pas.
      if (error.message?.toLowerCase().includes('invalid login') || error.message?.toLowerCase().includes('invalid')) {
        return setMessage('Compte introuvable ou mot de passe incorrect. Crée un compte si c\'est ta première fois.', true);
      }
      return setMessage(error.message, true);
    }
    state.session = data.session;
    state.user = data.user;
    toggleAdminLink(isAdminUser(state.user));
    setMessage(''); // Effacer le message de connexion
    
    // Mettre à jour le texte du loader
    if (els.loginLoader) {
      const loaderText = els.loginLoader.querySelector('.login-loader-text');
      if (loaderText) loaderText.textContent = 'Chargement de ton profil...';
    }
    
    await loadAppData();
    setupRealtimeSubscription(); // Démarrer l'écoute Realtime après la connexion
    
    // Animation de transition avec zoom/fade
    await animateLoginTransition();
  });

  els.signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('signup-username').value.trim();
    const emailInput = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value.trim();
    
    if (username.length < 3) return setMessage('Choisis un pseudo de 3 caractères minimum.', true);
    if (!emailInput) return setMessage('Entre ton email.', true);
    if (!isValidEmail(emailInput)) return setMessage('Email invalide.', true);
    
    setMessage('Création du compte...');

    // Vérifie qu'aucun compte n'utilise déjà ce pseudo
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

    // Créer le compte avec l'email fourni
    const { data, error } = await supabase.auth.signUp({ email: emailInput, password });
    if (error) {
      // Vérifier si l'email est déjà utilisé
      if (error.message?.toLowerCase().includes('already registered') || error.message?.toLowerCase().includes('already exists')) {
        return setMessage('Cet email est déjà utilisé. Connecte-toi ou utilise un autre email.', true);
      }
      return setMessage(error.message, true);
    }
    
    const userId = data.user?.id;
    if (userId) {
      // Donner des jetons aux nouveaux utilisateurs (heure de Paris)
      const today = getDateInParis();
      const currentWeekStart = getWeekStartDate(today);
      const currentWeekStartStr = formatDateYYYYMMDD(currentWeekStart);
      
      // Créer le profil avec l'email
      await supabase.from('profiles').upsert({ 
        id: userId, 
        username, 
        email: emailInput,
        badge_count: 0, 
        skill_points: 0, 
        rank: 'Minimaliste',
        tokens: SIGNUP_TOKENS_AMOUNT,
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
    
    // Afficher l'infobulle pour les jetons d'inscription
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
  // Boutons de la barre de navigation en bas
  els.bottomNavItems.forEach(btn => {
    btn.addEventListener('click', async () => {
      // Retirer la classe active de tous les boutons
      els.bottomNavItems.forEach(b => b.classList.remove('active'));
      // Ajouter la classe active au bouton cliqué
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      showTab(tab);
      
      // Si on clique sur "Mon profil", masquer seulement la pastille de la barre de navigation
      // La pastille du bouton cloche reste visible jusqu'à ce que l'utilisateur ouvre et ferme l'onglet
      if (tab === 'my-badges' && state.user) {
        try {
          const count = await NotificationUI.getUnreadNotificationsCount();
          NotificationUI.renderNotificationBadge(count, true); // Masquer seulement la pastille de la barre
        } catch (e) {
          console.error('Erreur lors de la mise à jour de la pastille:', e);
        }
      }
    });
  });
}

function showTab(tab) {
  Object.entries(els.tabSections).forEach(([key, section]) => {
    section.classList.toggle('hidden', key !== tab);
  });
  
  // Fermer le calendrier si un onglet est sélectionné
  closeCalendarDrawer();
  
  // Fermer le modal de profil communautaire si un onglet est sélectionné
  if (els.communityProfileModal) {
    els.communityProfileModal.classList.add('hidden');
  }
}

function attachSettingsMenuListeners() {
  // Menu de réglages du header
  if (els.settingsToggle && els.settingsMenu) {
    els.settingsToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      els.settingsMenu.classList.toggle('hidden');
    });
    document.addEventListener('click', (e) => {
      if (els.settingsMenu.classList.contains('hidden')) return;
      if (els.settingsMenu.contains(e.target) || els.settingsToggle.contains(e.target)) return;
      els.settingsMenu.classList.add('hidden');
    });
  }
  
  // Menu de réglages du profil
  const profileSettingsToggle = document.getElementById('profile-settings-toggle');
  const profileSettingsMenu = document.getElementById('profile-settings-menu');
  const profileLogoutBtn = document.getElementById('profile-logout-btn');
  const profileAdminLink = document.getElementById('profile-admin-link');
  
  if (profileSettingsToggle && profileSettingsMenu) {
    profileSettingsToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      profileSettingsMenu.classList.toggle('hidden');
    });
    document.addEventListener('click', (e) => {
      if (profileSettingsMenu.classList.contains('hidden')) return;
      if (profileSettingsMenu.contains(e.target) || profileSettingsToggle.contains(e.target)) return;
      profileSettingsMenu.classList.add('hidden');
    });
    
    // Gérer le bouton de déconnexion du profil
    if (profileLogoutBtn) {
      profileLogoutBtn.addEventListener('click', async () => {
        await supabase.auth.signOut();
        resetState();
        toggleAdminLink(false);
        toggleViews(false);
      });
    }
    
  }
  
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

function attachCommunityFilterListeners() {
  if (!els.communityFilterAll || !els.communityFilterTop || !els.communityFilterFriends || !els.communityFilterDescription) return;
  
  // Gestionnaire pour le bouton "Tous"
  els.communityFilterAll.addEventListener('click', () => {
    state.communityFilterMode = 'all';
    els.communityFilterAll.classList.add('active');
    els.communityFilterTop.classList.remove('active');
    els.communityFilterFriends.classList.remove('active');
    els.communityFilterDescription.textContent = 'Affiche tous les utilisateurs de l\'application.';
    // Récupérer la valeur de recherche actuelle
    const searchTerm = els.communitySearch ? els.communitySearch.value || '' : '';
    renderCommunityFiltered(searchTerm);
  });
  
  // Gestionnaire pour le bouton "Top profil"
  els.communityFilterTop.addEventListener('click', () => {
    state.communityFilterMode = 'top';
    els.communityFilterTop.classList.add('active');
    els.communityFilterAll.classList.remove('active');
    els.communityFilterFriends.classList.remove('active');
    els.communityFilterDescription.textContent = 'Affiche les 5 profils avec le plus grand nombre de badges.';
    // Récupérer la valeur de recherche actuelle
    const searchTerm = els.communitySearch ? els.communitySearch.value || '' : '';
    renderCommunityFiltered(searchTerm);
  });
  
  // Gestionnaire pour le bouton "Mes potes"
  els.communityFilterFriends.addEventListener('click', async () => {
    state.communityFilterMode = 'friends';
    els.communityFilterFriends.classList.add('active');
    els.communityFilterAll.classList.remove('active');
    els.communityFilterTop.classList.remove('active');
    els.communityFilterDescription.textContent = 'Affiche tes amis mutuellement abonnés.';
    
    // Charger les amis mutuels si ce n'est pas déjà fait
    if (!state.mutualFriends || state.mutualFriends.length === 0) {
      await loadMutualFriends();
    }
    
    // Récupérer la valeur de recherche actuelle
    const searchTerm = els.communitySearch ? els.communitySearch.value || '' : '';
    renderCommunityFiltered(searchTerm);
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
  
  // Gestionnaire pour le bouton qui affiche le formulaire
  if (els.ideaFormToggle) {
    els.ideaFormToggle.addEventListener('click', () => {
      if (els.ideaForm) {
        els.ideaForm.classList.remove('hidden');
        els.ideaFormToggle.classList.add('hidden');
      }
    });
  }
  
  // Gestionnaire pour le bouton annuler
  if (els.ideaFormCancel) {
    els.ideaFormCancel.addEventListener('click', () => {
      if (els.ideaForm) {
        els.ideaForm.classList.add('hidden');
        if (els.ideaFormToggle) {
          els.ideaFormToggle.classList.remove('hidden');
        }
        // Réinitialiser le formulaire
        if (els.ideaTitle) els.ideaTitle.value = '';
        if (els.ideaEmoji) els.ideaEmoji.value = '';
        if (els.ideaDescription) els.ideaDescription.value = '';
        if (els.ideaMessage) {
          els.ideaMessage.textContent = '';
          els.ideaMessage.classList.remove('error');
        }
      }
    });
  }
  
  // Gestionnaires pour les boutons de filtre
  if (els.ideaFilterRecent) {
    els.ideaFilterRecent.addEventListener('click', () => {
      setIdeaFilter('recent');
    });
  }
  
  if (els.ideaFilterLiked) {
    els.ideaFilterLiked.addEventListener('click', () => {
      setIdeaFilter('liked');
    });
  }
}

function setIdeaFilter(filter) {
  state.ideaFilter = filter;
  
  // Mettre à jour l'état visuel des boutons
  const buttons = [els.ideaFilterRecent, els.ideaFilterLiked];
  buttons.forEach(btn => {
    if (btn) {
      btn.classList.remove('active');
    }
  });
  
  if (filter === 'recent' && els.ideaFilterRecent) {
    els.ideaFilterRecent.classList.add('active');
  } else if (filter === 'liked' && els.ideaFilterLiked) {
    els.ideaFilterLiked.classList.add('active');
  }
  
  // Réafficher les idées avec le nouveau tri
  renderIdeas();
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

// Rafraîchit la communauté avec un léger délai pour regrouper les événements Realtime
function scheduleCommunityRefresh(delay = 800) {
  if (state.communityRefreshTimeout) return;
  state.communityRefreshTimeout = setTimeout(async () => {
    state.communityRefreshTimeout = null;
    try {
      await fetchCommunity();
    } catch (err) {
      console.error('Erreur lors du rafraîchissement communauté (realtime):', err);
    }
  }, delay);
}

// Gérer les changements détectés par Realtime
async function handleProfileChange(payload) {
  if (!state.user) return;
  
  const { eventType, new: newRecord, old: oldRecord } = payload;
  let shouldRenderCommunity = false;
  
  // Mettre à jour le profil local si c'est le nôtre
  if (newRecord && newRecord.id === state.user.id) {
    if (state.profile) {
      state.profile = { ...state.profile, ...newRecord };
      updatePrivacyButton();
      updatePrivacyIndicator();
      render();
    }
  }
  
  // Sécuriser le tableau local
  if (!Array.isArray(state.communityProfiles)) {
    state.communityProfiles = [];
  }
  
  // Gérer l'INSERT / UPDATE / DELETE pour garder la liste en temps réel
  if (eventType === 'INSERT' && newRecord) {
    const exists = state.communityProfiles.some(p => p.id === newRecord.id);
    if (!exists) {
      state.communityProfiles.push(newRecord);
      shouldRenderCommunity = true;
    }
  } else if (eventType === 'UPDATE' && newRecord) {
    const updatedProfile = state.communityProfiles.find(p => p.id === newRecord.id);
    if (updatedProfile) {
      Object.assign(updatedProfile, newRecord);
      shouldRenderCommunity = true;
    }
  } else if (eventType === 'DELETE' && oldRecord) {
    const before = state.communityProfiles.length;
    state.communityProfiles = state.communityProfiles.filter(p => p.id !== oldRecord.id);
    if (state.communityProfiles.length !== before) {
      shouldRenderCommunity = true;
    }
  }
  
  // Re-rendre si nécessaire (inclut le mode "Top profil" pour badges en temps réel)
  if (shouldRenderCommunity) {
    renderCommunityFiltered('');
  }
}

// Gérer les changements de badges détectés par Realtime
async function handleBadgeChange(payload) {
  if (!state.user) return;
  
  const { eventType, new: newRecord, old: oldRecord } = payload;
  const targetUserId = newRecord?.user_id || oldRecord?.user_id;
  const isCurrentUser = targetUserId && state.user && targetUserId === state.user.id;
  
  // Ignorer les changements locaux si on est en mode offline/local
  if (isLocalBadgesMode()) return;
  
  // Si c'est l'utilisateur courant : garder la logique complète (points, fantômes, etc.)
  if (isCurrentUser) {
    if (eventType === 'INSERT' && newRecord) {
      if (newRecord.success !== false) {
        state.userBadges.add(newRecord.badge_id);
        state.wasEverUnlocked.add(newRecord.badge_id);
      } else {
        state.attemptedBadges.add(newRecord.badge_id);
      }
      if (newRecord.level) state.userBadgeLevels.set(newRecord.badge_id, newRecord.level);
      if (newRecord.user_answer) state.userBadgeAnswers.set(newRecord.badge_id, newRecord.user_answer);
      if (newRecord.was_ever_unlocked === true) state.wasEverUnlocked.add(newRecord.badge_id);
    } else if (eventType === 'UPDATE' && newRecord) {
      if (newRecord.success !== false) {
        state.userBadges.add(newRecord.badge_id);
        state.wasEverUnlocked.add(newRecord.badge_id);
      } else {
        state.userBadges.delete(newRecord.badge_id);
        state.attemptedBadges.add(newRecord.badge_id);
      }
      if (newRecord.level) state.userBadgeLevels.set(newRecord.badge_id, newRecord.level);
      else state.userBadgeLevels.delete(newRecord.badge_id);
      
      if (newRecord.user_answer) state.userBadgeAnswers.set(newRecord.badge_id, newRecord.user_answer);
      else state.userBadgeAnswers.delete(newRecord.badge_id);
      
      if (newRecord.was_ever_unlocked === true) state.wasEverUnlocked.add(newRecord.badge_id);
    } else if (eventType === 'DELETE' && oldRecord) {
      state.userBadges.delete(oldRecord.badge_id);
      state.attemptedBadges.delete(oldRecord.badge_id);
      state.userBadgeLevels.delete(oldRecord.badge_id);
      state.userBadgeAnswers.delete(oldRecord.badge_id);
    }
    
    await syncGhostBadges();
    await updateCounters(true); // push rang/skills dans profiles
    render();
    return;
  }
  
  // Si c'est un autre utilisateur visible dans la communauté : rafraîchir la liste (top profil en temps réel)
  const isKnownCommunityUser = Array.isArray(state.communityProfiles)
    && targetUserId
    && state.communityProfiles.some(p => p.id === targetUserId);
  
  if (isKnownCommunityUser) {
    scheduleCommunityRefresh();
  }
}

async function loadAppData() {
  toggleViews(true);
  try { await fetchProfile(); } catch (e) { console.error(e); }
  try { await fetchBadges(); } catch (e) { console.error(e); }
  try { await fetchUserBadges(); } catch (e) { console.error(e); }
  try { await fetchCommunity(); } catch (e) { console.error(e); }
  try { await fetchIdeas(); } catch (e) { console.error(e); }
  try { await fetchIdeaVotes(); } catch (e) { console.error(e); }
  
  // Initialiser les modules d'abonnement et notifications
  if (state.user) {
    SubscriptionUI.initSubscriptionUI(supabase, state.user.id);
    NotificationUI.initNotificationUI(supabase, state.user.id);
    
    // Charger les stats d'abonnement
    try {
      const followersCount = await Subscriptions.getFollowersCount(supabase, state.user.id);
      const subscriptionsCount = await Subscriptions.getSubscriptionsCount(supabase, state.user.id);
      SubscriptionUI.renderSubscriptionStats(followersCount, subscriptionsCount);
    } catch (e) { console.error('Erreur lors du chargement des stats d\'abonnement:', e); }
    
    // Charger et afficher les notifications
    try {
      await NotificationUI.refreshNotificationBadge();
      // Configurer l'écoute Realtime pour les notifications
      NotificationUI.setupRealtimeNotificationListener();
    } catch (e) { console.error('Erreur lors du chargement des notifications:', e); }
    
    // Configurer l'écoute Realtime pour les abonnements (mise à jour instantanée des compteurs)
    try {
      SubscriptionUI.setupRealtimeSubscriptions();
    } catch (e) { console.error('Erreur lors de la configuration Realtime des abonnements:', e); }
  }
  
  render();
  // Mettre à jour les statistiques d'amélioration après le chargement
  renderImproveBadgesStats();
}

async function fetchProfile() {
  if (!state.user) return;
  // Utiliser safeSupabaseSelect pour gérer automatiquement les colonnes optionnelles
  const { data, error } = await safeSupabaseSelect(
    supabase,
    'profiles',
    'username, badge_count, avatar_url, skill_points, rank, is_private, tokens, last_token_date, connection_days, week_start_date, week_bonus_available, week_bonus_claimed, claimed_daily_tokens, email',
    'username, badge_count, avatar_url, skill_points, rank',
    (query) => query.eq('id', state.user.id).single()
  );
  
  if (error && error.code !== 'PGRST116') {
    console.error('Erreur fetchProfile:', error);
    return;
  }
  if (!data) {
    // Essayer d'insérer avec toutes les colonnes, sinon sans
    const today = getDateInParis();
    const currentWeekStart = getWeekStartDate(today);
    const currentWeekStartStr = formatDateYYYYMMDD(currentWeekStart);
    
    const insertData = { id: state.user.id, username: 'Invité', badge_count: 0, avatar_url: null, skill_points: 0, rank: 'Minimaliste', tokens: SIGNUP_TOKENS_AMOUNT };
    try {
      await supabase.from('profiles').insert({ ...insertData, is_private: false });
      state.profile = { ...insertData, is_private: false, tokens: SIGNUP_TOKENS_AMOUNT, last_token_date: null, connection_days: [], claimed_daily_tokens: [], week_start_date: currentWeekStartStr, week_bonus_available: false, week_bonus_claimed: false };
    } catch (e) {
      await supabase.from('profiles').insert(insertData);
      state.profile = { ...insertData, is_private: false, tokens: SIGNUP_TOKENS_AMOUNT, last_token_date: null, connection_days: [], claimed_daily_tokens: [], week_start_date: currentWeekStartStr, week_bonus_available: false, week_bonus_claimed: false };
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
      tokens: data.tokens ?? SIGNUP_TOKENS_AMOUNT,
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
function showTokenRewardNotification(amount = DAILY_TOKENS_AMOUNT, type = 'daily') {
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

// Affiche une notification "Jetons insuffisants"
// Vérifie d'abord s'il n'y a pas déjà une notification affichée pour éviter les doublons
function showInsufficientTokensNotification(message = 'Jetons insuffisants') {
  // Vérifier s'il y a déjà une notification affichée
  const existingNotification = document.querySelector('.insufficient-tokens-notification');
  if (existingNotification) {
    return; // Ne pas afficher de doublon
  }
  
  // Créer une infobulle temporaire
  const notification = document.createElement('div');
  notification.className = 'token-reward-notification insufficient-tokens-notification';
  
  notification.innerHTML = `
    <div class="token-reward-content">
      <span class="token-emoji">⚠️</span>
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

  // S'assurer que le slider interne est positionné sur "Ma collection"
  const sectionsContainer = document.querySelector('.profile-badges-sections-container');
  const sectionIndicators = document.querySelectorAll('.section-indicator');
  if (sectionsContainer) {
    sectionsContainer.scrollTo({ left: 0, behavior: 'smooth' });
  }
  sectionIndicators.forEach((ind, idx) => {
    ind.classList.toggle('active', idx === 0);
  });
  
  // Fonction de tentative de scroll avec retries
  const tryScroll = (attempt = 1) => {
    // Re-rendre pour s'assurer que le badge existe
    renderMyBadges();
    renderAllBadgesInProfile();

    setTimeout(() => {
      // Chercher d'abord dans la liste "Mon profil", puis dans "Tous les badges" en fallback
      let badgeCard = els.myBadgesList?.querySelector(`[data-badge-id="${badgeId}"]`);
      if (!badgeCard && els.allBadgesList) {
        badgeCard = els.allBadgesList.querySelector(`[data-badge-id="${badgeId}"]`);
      }

      if (badgeCard) {
        // Effet visuel
        badgeCard.classList.add('badge-just-unlocked');

        // Essayer scrollIntoView centré, puis ajuster avec un offset
        try {
          badgeCard.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
        } catch (_) {
          // ignorer
        }

        const offset = 100;
        const cardPosition = badgeCard.getBoundingClientRect().top + window.pageYOffset;
        const offsetPosition = cardPosition - offset;
        window.scrollTo({ top: offsetPosition, behavior: 'smooth' });

        // Retirer l'effet visuel après 3 secondes
        setTimeout(() => {
          badgeCard.classList.remove('badge-just-unlocked');
        }, 3000);
      } else if (attempt < 3) {
        // Si pas trouvé, retenter après un petit délai
        setTimeout(() => tryScroll(attempt + 1), 150);
      }
    }, 80);
  };

  // Lancer la première tentative après un court délai pour laisser le tab s'afficher
  setTimeout(() => tryScroll(1), 80);
}

// Affiche une notification pour les jetons d'inscription
function showSignupTokensNotification() {
  // Créer une infobulle temporaire
  const notification = document.createElement('div');
  notification.className = 'token-reward-notification';
  notification.innerHTML = `
    <div class="token-reward-content">
      <span class="token-emoji">🪙</span>
      <span>Bienvenue ! Tu as reçu ${SIGNUP_TOKENS_AMOUNT} jeton${SIGNUP_TOKENS_AMOUNT > 1 ? 's' : ''} pour t'être inscrit !</span>
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
}

async function fetchBadges() {
  // On récupère en priorité depuis Supabase.
  // Si on définit window.USE_LOCAL_BADGES = true, ou si Supabase échoue,
  // on charge un fichier local badges.json (plus simple à éditer dans le code).
  const selectWithEmoji = 'id,name,description,question,answer,emoji,low_skill,theme,expert_name';
  const selectFallback = 'id,name,description,question,answer,theme,expert_name';
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

  const { data, error } = await supabase.from('user_badges').select('badge_id, level, success, user_answer, was_ever_unlocked, is_blocked_by_suspicions').eq('user_id', state.user.id);
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
  // Charger les badges bloqués par soupçons
  state.blockedBySuspicions = new Set(rows.filter(r => r.is_blocked_by_suspicions === true).map(row => row.badge_id));
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
  // Récupérer tous les utilisateurs (sans limite) pour permettre l'affichage de tous ou du top 5
  const { data, error } = await safeSupabaseSelect(
    supabase,
    'profiles',
    'id,username,badge_count,avatar_url,skill_points,rank,is_private,created_at',
    'id,username,badge_count,avatar_url,skill_points,rank',
    (query) => query.order('skill_points', { ascending: false })
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
  
  // Recharger les amis mutuels si le mode actuel est "friends"
  if (state.communityFilterMode === 'friends') {
    await loadMutualFriends();
  }
  
  renderCommunityFiltered('');
}

// Fonction pour charger les amis mutuels
async function loadMutualFriends() {
  if (!state.user || !state.user.id) {
    state.mutualFriends = [];
    return;
  }
  
  try {
    const mutualFriends = await Subscriptions.getMutualFriends(supabase, state.user.id);
    
    // Enrichir les amis mutuels avec les données complètes des profils de la communauté
    const enrichedFriends = mutualFriends.map(friend => {
      // Trouver le profil complet dans state.communityProfiles
      const fullProfile = state.communityProfiles.find(p => p.id === friend.id);
      if (fullProfile) {
        return {
          ...fullProfile,
          mutual_subscription_date: friend.mutual_subscription_date
        };
      }
      // Si le profil n'est pas dans la communauté, utiliser les données de base
      return {
        ...friend,
        badge_count: friend.badge_count || 0,
        mystery_count: 0,
        is_private: friend.is_private || false
      };
    });
    
    state.mutualFriends = enrichedFriends;
  } catch (error) {
    console.error('Erreur lors du chargement des amis mutuels:', error);
    state.mutualFriends = [];
  }
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
  renderAllBadgesInProfile();
  // Mettre à jour la roue si elle est visible (ne pas interférer si elle tourne)
  renderThemesSlider();
  // Mettre à jour les statistiques d'amélioration
  renderImproveBadgesStats();
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
    // Utiliser l'ordre des rangs depuis la constante RANKS pour garantir la cohérence
    const rankOrder = RANKS.map(r => r.name);
    const currentRank = getRankMeta(userSkillPoints || 0).name;
    const currentRankIndex = rankOrder.indexOf(currentRank);
    const minRankIndex = rankOrder.indexOf(minRank);
    
    // Vérifier que les deux rangs existent dans la liste
    if (currentRankIndex === -1 || minRankIndex === -1) {
      console.warn(`Rang non trouvé: currentRank=${currentRank}, minRank=${minRank}`);
      // Si le rang n'est pas trouvé, on considère que la condition n'est pas remplie
      checks.push(false);
    } else {
      // Le rang actuel doit être supérieur ou égal au rang minimum requis
      checks.push(currentRankIndex >= minRankIndex);
    }
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
    // Synchroniser le profil pour mettre à jour les skill_points dans la base de données
    // car les badges fantômes peuvent avoir des skill points personnalisés
    await updateCounters(true);
    render();
  }
}

function renderAllBadges() {
  // Afficher le slider de thèmes
  renderThemesSlider();
}

// Bascule entre les sections "Thèmes" et "Améliorer" dans l'onglet "à débloquer"
function switchAllBadgesSection(section) {
  // Mettre à jour les boutons
  if (els.navThemesBtn && els.navImproveBtn) {
    els.navThemesBtn.classList.toggle('active', section === 'themes');
    els.navImproveBtn.classList.toggle('active', section === 'improve');
  }
  
  // Afficher/masquer les sections
  if (els.themesSection && els.improveSection) {
    if (section === 'themes') {
      els.themesSection.classList.remove('hidden');
      els.improveSection.classList.add('hidden');
    } else if (section === 'improve') {
      els.themesSection.classList.add('hidden');
      els.improveSection.classList.remove('hidden');
    }
  }
}

// Gère le clic sur un bouton de thème
async function handleThemeButtonClick(themeName) {
  // Vérifier que le thème n'est pas à 100%
  const progress = calculateThemeProgress(themeName);
  if (progress.isComplete) {
    return; // Ne devrait pas arriver car le bouton est désactivé
  }
  
  // Vérifier que l'utilisateur a au moins 1 jeton
  if ((state.tokens || 0) < 1) {
    showInsufficientTokensNotification();
    return;
  }
  
  // Consommer 1 jeton
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
    updateTokensDisplay();
    alert('Erreur lors de la mise à jour des jetons. Veuillez réessayer.');
    return;
  }
  
  // Appeler handleThemeSelected pour afficher le modal
  handleThemeSelected(themeName);
}

// Gère la sélection d'un thème
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
    renderThemesSlider(); // Mettre à jour le slider
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
  
  // Afficher le modal avec animation
  if (els.badgeQuestionOverlay) {
    els.badgeQuestionOverlay.classList.remove('hidden');
  }
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
  renderAllBadgesInProfile();
}

// Calcule les statistiques d'amélioration des badges
function calculateBadgeImprovementStats() {
  let expertCount = 0;
  let totalUnlockedLevels = 0;
  let totalMaxLevels = 0;
  const badgesWithGap = [];

  // Parcourir tous les badges débloqués
  state.userBadges.forEach(badgeId => {
    const badge = getBadgeById(badgeId);
    if (!badge) return;

    const levelLabel = state.userBadgeLevels.get(badgeId);
    const config = parseConfig(badge.answer);

    // Compter les niveaux expert
    if (levelLabel && isMysteryLevel(levelLabel)) {
      expertCount++;
    }

    // Calculer les niveaux débloqués et max
    const currentLevelPos = getLevelPosition(levelLabel, config);
    const maxLevelCount = getLevelCount(config);

    // Si le badge a des niveaux
    if (maxLevelCount > 0) {
      // Niveau actuel : si c'est Expert, on considère qu'il est au niveau max
      if (levelLabel && isMysteryLevel(levelLabel)) {
        totalUnlockedLevels += maxLevelCount;
        totalMaxLevels += maxLevelCount;
      } else if (currentLevelPos !== null && currentLevelPos > 0) {
        totalUnlockedLevels += currentLevelPos;
        totalMaxLevels += maxLevelCount;
        
        // Calculer l'écart pour les badges non-expert
        const gap = maxLevelCount - currentLevelPos;
        if (gap > 0) {
          const displayName = getBadgeDisplayName(badge, levelLabel);
          badgesWithGap.push({
            badgeId,
            name: stripEmojis(displayName),
            emoji: getBadgeEmoji(badge),
            gap,
            currentLevel: currentLevelPos,
            maxLevel: maxLevelCount
          });
        }
      } else {
        // Badge débloqué mais sans niveau défini, compter comme 1 niveau
        totalUnlockedLevels += 1;
        totalMaxLevels += maxLevelCount > 0 ? maxLevelCount : 1;
      }
    } else {
      // Badge sans niveaux (text, boolean simple), compter comme 1 niveau débloqué sur 1 max
      totalUnlockedLevels += 1;
      totalMaxLevels += 1;
    }
  });

  // Trier les badges par écart décroissant et prendre les 3 premiers
  badgesWithGap.sort((a, b) => b.gap - a.gap);
  const top3Badges = badgesWithGap.slice(0, 3);

  return {
    expertCount,
    totalUnlockedLevels,
    totalMaxLevels,
    top3Badges
  };
}

// Affiche les statistiques d'amélioration dans la section
function renderImproveBadgesStats() {
  const expertCountEl = document.getElementById('expert-count');
  const levelsProgressEl = document.getElementById('levels-progress');
  const suggestionsEl = document.getElementById('badge-suggestions');

  if (!expertCountEl || !levelsProgressEl || !suggestionsEl) return;

  // Si l'utilisateur n'a pas de badges débloqués, afficher des valeurs par défaut
  if (!state.userBadges || state.userBadges.size === 0) {
    expertCountEl.innerHTML = '<span class="stat-number">0</span>';
    levelsProgressEl.innerHTML = '<span class="stat-number">0</span><span class="stat-separator">/</span><span class="stat-number">0</span>';
    suggestionsEl.innerHTML = '<p class="muted" style="margin: 8px 0; font-size: 13px;">Débloque des badges pour voir les suggestions d\'amélioration.</p>';
    return;
  }

  const stats = calculateBadgeImprovementStats();

  // Afficher le nombre de niveaux expert avec icône
  expertCountEl.innerHTML = `<span class="stat-number">${stats.expertCount}</span>`;

  // Afficher la progression des niveaux avec pourcentage
  const progressPercent = stats.totalMaxLevels > 0 
    ? Math.round((stats.totalUnlockedLevels / stats.totalMaxLevels) * 100) 
    : 0;
  levelsProgressEl.innerHTML = `
    <span class="stat-number">${stats.totalUnlockedLevels}</span>
    <span class="stat-separator">/</span>
    <span class="stat-number">${stats.totalMaxLevels}</span>
    <span class="stat-percent">${progressPercent}%</span>
  `;

  // Afficher les suggestions de badges
  suggestionsEl.innerHTML = '';
  
  if (stats.top3Badges.length === 0) {
    suggestionsEl.innerHTML = '<p class="muted" style="margin: 8px 0; font-size: 13px;">Tous tes badges sont au niveau maximum ! 🎉</p>';
  } else {
    stats.top3Badges.forEach(badgeInfo => {
      const badgeBtn = document.createElement('button');
      badgeBtn.className = 'suggested-badge-btn';
      badgeBtn.type = 'button';
      badgeBtn.dataset.badgeId = badgeInfo.badgeId;
      badgeBtn.innerHTML = `
        <span class="suggested-badge-emoji">${badgeInfo.emoji}</span>
        <div class="suggested-badge-info">
          <span class="suggested-badge-name">${badgeInfo.name}</span>
          <span class="suggested-badge-gap">niv ${badgeInfo.currentLevel} sur ${badgeInfo.maxLevel}</span>
        </div>
        <span class="suggested-badge-arrow">→</span>
      `;
      badgeBtn.addEventListener('click', () => handleSuggestedBadgeClick(badgeInfo.badgeId));
      suggestionsEl.appendChild(badgeBtn);
    });
  }
}

// Gère le clic sur un badge suggéré (coûte 5 jetons)
async function handleSuggestedBadgeClick(badgeId) {
  // Vérifier que l'utilisateur est connecté
  if (!state.user) {
    alert('Tu dois être connecté pour améliorer un badge.');
    return;
  }
  
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
  
  // Attendre que l'onglet soit visible et les badges rendus
  setTimeout(() => {
    renderMyBadges();
    renderAllBadgesInProfile();
    // Attendre que les badges soient rendus avant d'ouvrir le modal
    setTimeout(() => {
      const badge = getBadgeById(badgeId);
      if (badge) {
        // Ouvrir le modal de modification du badge
        handleModifyBadgeAnswer(badge);
      } else {
        // Si le badge n'est pas trouvé, scroller vers le haut de la section
        const myBadgesSection = document.getElementById('my-badges');
        if (myBadgesSection) {
          myBadgesSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    }, 100);
  }, 100);
  
  // Mettre à jour les statistiques après la consommation des jetons
  renderImproveBadgesStats();
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
      renderThemesSlider();
      renderMyBadges();
      renderAllBadgesInProfile();
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
    renderAllBadgesInProfile();
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
    
    // Notification de jetons supprimée (garder uniquement le message d'inscription)
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
  
  // Afficher le modal avec animation
  if (els.badgeQuestionOverlay) {
    els.badgeQuestionOverlay.classList.remove('hidden');
  }
  els.badgeQuestionContainer.classList.remove('hidden');
  
  // Attacher le gestionnaire de clic pour fermer la carte en cliquant en dehors
  attachBadgeQuestionCloseHandler();
}

// Attache le gestionnaire de clic pour fermer la carte en cliquant en dehors
function attachBadgeQuestionCloseHandler() {
  // Supprimer les anciens gestionnaires s'ils existent
  if (els.badgeQuestionContainer._closeHandler) {
    els.badgeQuestionContainer.removeEventListener('click', els.badgeQuestionContainer._closeHandler);
  }
  if (els.badgeQuestionOverlay && els.badgeQuestionOverlay._closeHandler) {
    els.badgeQuestionOverlay.removeEventListener('click', els.badgeQuestionOverlay._closeHandler);
  }
  
  // Créer un gestionnaire pour le conteneur
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
  
  // Créer un gestionnaire pour l'overlay (permet de fermer en cliquant en dehors)
  if (els.badgeQuestionOverlay) {
    els.badgeQuestionOverlay._closeHandler = (e) => {
      // Ne pas permettre la fermeture si aucune réponse n'a été donnée
      if (!state.badgeQuestionAnswered) {
        return;
      }
      
      // Si on clique directement sur l'overlay (pas sur le conteneur ou la carte), fermer
      if (e.target === els.badgeQuestionOverlay) {
        closeBadgeQuestion();
      }
    };
    
    els.badgeQuestionOverlay.addEventListener('click', els.badgeQuestionOverlay._closeHandler);
  }
  
  els.badgeQuestionContainer.addEventListener('click', els.badgeQuestionContainer._closeHandler);
}

// Ferme la carte du badge
function closeBadgeQuestion() {
  if (els.badgeQuestionContainer) {
    const card = els.badgeQuestionContainer.querySelector('.card');
    
    // Ajouter l'animation de dézoom avant de masquer
    if (card) {
      card.classList.add('zoom-out');
      // Attendre la fin de l'animation avant de masquer
      setTimeout(() => {
        card.classList.remove('zoom-out');
        els.badgeQuestionContainer.classList.add('hidden');
        if (els.badgeQuestionOverlay) {
          els.badgeQuestionOverlay.classList.add('hidden');
        }
      }, 300);
    } else {
      // Si pas de carte, masquer directement
      els.badgeQuestionContainer.classList.add('hidden');
      if (els.badgeQuestionOverlay) {
        els.badgeQuestionOverlay.classList.add('hidden');
      }
    }
  } else {
    if (els.badgeQuestionOverlay) {
      els.badgeQuestionOverlay.classList.add('hidden');
    }
  }
  // Note: Le slider est mis à jour par handleBadgeAnswerFromWheel ou render()
  // Ne pas appeler renderThemesSlider() ici pour éviter les sauts visuels
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
      
      // Récupérer le nom du badge (sans emoji) - utiliser expert_name si niveau expert
      const displayName = getBadgeDisplayName(state.selectedBadgeFromWheel, badgeLevel);
      const badgeName = stripEmojis(displayName);
      
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
                closeBadgeQuestion();
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
    
    // Mettre à jour le slider et les badges IMMÉDIATEMENT (avant le délai)
    renderThemesSlider();
    renderMyBadges();
    renderAllBadgesInProfile();
    
    // Le message reste affiché jusqu'à ce que l'utilisateur clique sur le bouton ou ferme manuellement
    // L'utilisateur peut aussi cliquer ailleurs pour fermer (géré par attachBadgeQuestionCloseHandler)
  } else {
    // Effacer le message d'erreur dans le formulaire s'il existe
    if (els.badgeAnswerMessage) {
      els.badgeAnswerMessage.textContent = '';
      els.badgeAnswerMessage.className = 'message';
    }
    
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
      const errorMessage = customMessage || 'Ta réponse n\'a pas suffi pour débloquer ce badge. Le badge retourne dans le slider, tu peux réessayer !';
      
      card.innerHTML = `
        <p class="badge-error-message" style="text-align: center; color: white; margin: 20px 0; font-size: 18px; line-height: 1.5;">
          ${errorMessage}
        </p>
        <div style="display: flex; justify-content: center; margin-top: 20px;">
          <button class="primary" id="close-error-button" style="padding: 12px 24px; font-size: 16px;">
            Fermer
          </button>
        </div>
      `;
      // Mettre à jour la référence à selectedBadgeName après avoir modifié le HTML
      els.selectedBadgeName = card.querySelector('#selected-badge-name');
      
      // Attacher l'événement au bouton de fermeture
      const closeButton = card.querySelector('#close-error-button');
      if (closeButton) {
        closeButton.addEventListener('click', () => {
          closeBadgeQuestion();
        });
      }
      
      // Réattacher le gestionnaire de fermeture (maintenant la fermeture est autorisée car une réponse a été donnée)
      attachBadgeQuestionCloseHandler();
    }
    
    // Mettre à jour le slider IMMÉDIATEMENT (le badge retourne dans le slider)
    renderThemesSlider();
  }
}


// Gère la modification de réponse d'un badge (depuis le Joker Bonus)
function handleModifyBadgeAnswer(badge) {
  // Empêcher la modification des badges fantômes
  if (isGhostBadge(badge)) {
    alert('Tu ne peux pas modifier un badge fantôme. Une fois débloqué, il reste débloqué.');
    return;
  }
  
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
  
  // Ajouter l'animation de zoom au modal
  if (modal) {
    modal.classList.add('zoom-in');
    // Retirer la classe après l'animation pour permettre de la réappliquer
    setTimeout(() => {
      modal.classList.remove('zoom-in');
    }, 300);
  }
  
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
      // Si le badge était bloqué par soupçons, le débloquer et supprimer tous les soupçons
      const wasBlocked = state.blockedBySuspicions.has(badge.id);
      if (wasBlocked) {
        // Retirer le blocage dans la mise à jour du badge
        // (sera fait dans les upsert suivants)
      }
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
          renderAllBadgesInProfile();
        }, 2500);
      } else if (newLevelIndex > oldLevelIndex || !oldLevel) {
        // Amélioration ! Mettre à jour
        // Si le badge était bloqué par soupçons, le débloquer et supprimer tous les soupçons
        const wasBlocked = state.blockedBySuspicions.has(badge.id);
        const { error } = await supabase.from('user_badges').upsert({
          user_id: state.user.id,
          badge_id: badge.id,
          success: true,
          level: newLevel,
          user_answer: newAnswer,
          was_ever_unlocked: true,
          is_blocked_by_suspicions: false // Débloquer si c'était bloqué
        });
        
        if (!error && wasBlocked) {
          state.blockedBySuspicions.delete(badge.id);
          
          // Supprimer tous les soupçons pour ce badge
          await supabase
            .from('badge_suspicions')
            .delete()
            .eq('user_id', state.user.id)
            .eq('badge_id', badge.id);
          
          // Recompter les badges et skills
          await updateCounters(true);
        }
        
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
        // Si le badge était bloqué par soupçons, le débloquer et supprimer tous les soupçons
        const wasBlocked = state.blockedBySuspicions.has(badge.id);
        const { error } = await supabase.from('user_badges').upsert({
          user_id: state.user.id,
          badge_id: badge.id,
          success: true,
          level: newLevel,
          user_answer: newAnswer,
          was_ever_unlocked: true,
          is_blocked_by_suspicions: false // Débloquer si c'était bloqué
        });
        
        if (!error && wasBlocked) {
          state.blockedBySuspicions.delete(badge.id);
          
          // Supprimer tous les soupçons pour ce badge
          await supabase
            .from('badge_suspicions')
            .delete()
            .eq('user_id', state.user.id)
            .eq('badge_id', badge.id);
          
          // Recompter les badges et skills
          await updateCounters(true);
        }
        
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
        
        // Mettre à jour le slider pour que le badge soit disponible
        renderThemesSlider();
        
        // Mettre à jour l'affichage de la collection pour retirer le badge
        state.badgeQuestionAnswered = true;
        setTimeout(() => {
          closeModifyBadgeOverlay();
          renderMyBadges();
          renderAllBadgesInProfile();
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
    const modal = els.modifyBadgeOverlay.querySelector('.modify-badge-modal .card');
    
    // Ajouter l'animation de dézoom avant de masquer
    if (modal) {
      modal.classList.add('zoom-out');
      // Attendre la fin de l'animation avant de masquer
      await new Promise(resolve => setTimeout(resolve, 300));
      modal.classList.remove('zoom-out');
      modal.innerHTML = '';
    }
    
    els.modifyBadgeOverlay.classList.add('hidden');
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
        renderAllBadgesInProfile();
    });
    }
  } else {
    // Supprimer le bandeau s'il existe
    const existingBanner = document.getElementById('modify-badge-banner');
    if (existingBanner) {
      existingBanner.remove();
  }
}

  // Filtrer les badges : afficher uniquement les badges débloqués (y compris ceux bloqués par soupçons)
  const visibleBadges = allBadges.filter(badge => {
    const unlocked = state.userBadges.has(badge.id);
    // Afficher uniquement si débloqué (même si bloqué par soupçons)
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
      const isBlocked = state.blockedBySuspicions.has(badge.id);

      const card = document.createElement('article');
      card.className = 'card-badge clickable compact all-badge-card my-catalog-card';
      if (isBlocked) {
        card.classList.add('badge-blocked-by-suspicions');
      }
      card.dataset.badgeId = badge.id; // Ajouter un identifiant pour pouvoir scroller vers le badge

      // Afficher les badges débloqués normalement
      const safeEmoji = getBadgeEmoji(badge);
      const displayName = getBadgeDisplayName(badge, levelLabel);
      const safeTitle = stripEmojis(displayName);

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
      
      // Ajouter indicateur "Soupçon" si bloqué
      const suspicionTag = isBlocked ? '<span class="tag suspicion-tag" style="background: #ef4444; color: white; margin-left: 8px;">Soupçon</span>' : '';
      
      // Ajouter bouton de modification si bloqué
      let modifyButtonHTML = '';
      if (isBlocked && !state.isModifyingBadge) {
        modifyButtonHTML = `
          <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border, #1f2937);">
            <p class="muted" style="font-size: 0.875rem; margin-bottom: 8px;">Ce badge a été bloqué par tes amis. Tu peux modifier ta réponse pour 3 jetons.</p>
            <button class="ghost small modify-blocked-badge-btn" data-badge-id="${badge.id}" style="font-size: 0.75rem; padding: 4px 8px;">Modifier ma réponse (3 jetons)</button>
          </div>
        `;
      }

      card.innerHTML = `
        <div class="row level-row">
          <span class="tag ${statusClass}">${statusLabel}</span>${suspicionTag}
        </div>
        <div class="badge-compact">
          <div class="badge-emoji">${safeEmoji}</div>
          <div class="badge-title ${isExpert ? 'expert-badge-title' : ''}">${safeTitle}</div>
        </div>
        <div class="all-badge-details hidden">
          <p class="muted">${displayText || ''}</p>
          ${modifyButtonHTML}
        </div>
      `;
      
      // Gérer le clic sur le bouton de modification pour badges bloqués
      const modifyBtn = card.querySelector('.modify-blocked-badge-btn');
      if (modifyBtn) {
        modifyBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          
          // Empêcher la modification des badges fantômes
          if (isGhostBadge(badge)) {
            alert('Tu ne peux pas modifier un badge fantôme. Une fois débloqué, il reste débloqué.');
            return;
          }
          
          // Vérifier les jetons
          if (state.tokens < 3) {
            alert('Tu n\'as pas assez de jetons. Il te faut 3 jetons pour modifier ce badge.');
            return;
          }
          
          // Confirmer
          if (!confirm('Modifier ta réponse pour ce badge coûtera 3 jetons. Continuer ?')) {
            return;
          }
          
          // Débiter les jetons
          const newTokens = state.tokens - 3;
          await supabase
            .from('profiles')
            .update({ tokens: newTokens })
            .eq('id', state.user.id);
          
          state.tokens = newTokens;
          state.profile.tokens = newTokens;
          updateTokensDisplay();
          
          // Activer le mode modification avec coût de 3 jetons
          state.isModifyingBadge = true;
          state.modifyBadgeCost = 3;
          
          // Ouvrir le formulaire de modification
          handleModifyBadgeAnswer(badge);
        });
      }

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
          // Empêcher la modification des badges fantômes
          if (isGhostBadge(badge)) {
            alert('Tu ne peux pas modifier un badge fantôme. Une fois débloqué, il reste débloqué.');
            return;
          }
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

function renderAllBadgesInProfile() {
  // Affiche tous les badges (sauf cachés) avec leurs différents états
  if (!els.allBadgesList) {
    console.error('❌ els.allBadgesList n\'existe pas !');
    return;
  }
  
  const allBadges = state.badges.slice();
  
  if (!allBadges.length) {
    els.allBadgesList.innerHTML = '<p class="muted">Aucun badge pour le moment. Vérifiez que la table "badges" existe dans Supabase et contient des données.</p>';
    return;
  }
  
  // Vérifier si au moins un badge fantôme est débloqué
  const ghostBadges = allBadges.filter(badge => isGhostBadge(badge));
  const hasUnlockedGhostBadge = ghostBadges.some(badge => state.userBadges.has(badge.id));
  
  // Filtrer les badges : inclure "Badges cachés" uniquement si au moins un badge fantôme est débloqué
  const visibleBadges = allBadges.filter(badge => {
    const themeName = (badge.theme && String(badge.theme).trim()) ? String(badge.theme).trim() : 'Autres';
    if (themeName === 'Badges cachés') {
      return hasUnlockedGhostBadge;
    }
    return true;
  });
  
  if (!visibleBadges.length) {
    els.allBadgesList.innerHTML = '<p class="muted">Aucun badge disponible.</p>';
    return;
  }
  
  els.allBadgesList.classList.remove('list-mode');
  els.allBadgesList.classList.add('my-badges-catalog');
  els.allBadgesList.innerHTML = '';
  
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
    if (themeBadges.length === 0) return;
    
    const title = document.createElement('div');
    title.className = 'section-subtitle theme-title';
    title.textContent = t;
    els.allBadgesList.appendChild(title);
    
    themeBadges.sort(sortById).forEach(badge => {
      // Déterminer le statut du badge
      const unlocked = state.userBadges.has(badge.id);
      const attempted = state.attemptedBadges.has(badge.id);
      
      // Statut : non répondu et non débloqué
      const isNotAnswered = !attempted && !unlocked;
      // Statut : répondu mais non débloqué
      const isAnsweredButLocked = attempted && !unlocked;
      
      const levelLabel = state.userBadgeLevels.get(badge.id);
      const config = parseConfig(badge.answer);
      const isGhost = isGhostBadge(badge);
      const userAnswer = state.userBadgeAnswers.get(badge.id);
      const isBlocked = state.blockedBySuspicions.has(badge.id);
      
      const card = document.createElement('article');
      card.className = 'card-badge clickable compact all-badge-card my-catalog-card';
      
      // Ajouter classe pour badge grisé si répondu mais non débloqué
      if (isAnsweredButLocked) {
        card.classList.add('badge-answered-locked');
      }
      
      if (isBlocked) {
        card.classList.add('badge-blocked-by-suspicions');
      }
      card.dataset.badgeId = badge.id;
      
      // Déterminer l'emoji et le nom à afficher
      let safeEmoji, safeTitle, isMysteryBadge = false;
      if (isNotAnswered) {
        // Badge jamais répondu : afficher "?" en gris pour l'emoji et "?????" pour le nom
        safeEmoji = '?';
        safeTitle = '?????';
        isMysteryBadge = true;
      } else {
        // Badge répondu ou débloqué : afficher normalement
        safeEmoji = getBadgeEmoji(badge);
        const displayName = getBadgeDisplayName(badge, levelLabel);
        safeTitle = stripEmojis(displayName);
      }
      
      // Déterminer le label : afficher le niveau si débloqué
      const statusLabel = unlocked ? formatLevelTag(unlocked, levelLabel, config) : '';
      const statusClass = isMysteryLevel(levelLabel) ? 'mystery' : 'success';
      const isExpert = isMysteryLevel(levelLabel);
      
      if (isExpert && unlocked) {
        card.classList.add('expert-badge');
      }
      
      // Déterminer le texte à afficher dans les détails
      let displayText = '';
      if (isNotAnswered) {
        displayText = 'Badge non découvert';
      } else if (isAnsweredButLocked) {
        // Afficher la réponse si répondu mais non débloqué
        const formattedAnswer = userAnswer ? formatUserAnswer(badge, userAnswer) : null;
        displayText = formattedAnswer || '';
      } else if (unlocked) {
        // Badge débloqué : afficher la réponse ou le texte fantôme
        const formattedAnswer = userAnswer ? formatUserAnswer(badge, userAnswer) : null;
        const ghostText = isGhost ? (config?.ghostDisplayText || 'Débloqué automatiquement') : null;
        displayText = formattedAnswer || ghostText || '';
      }
      
      // Ajouter indicateur "Soupçon" si bloqué
      const suspicionTag = isBlocked ? '<span class="tag suspicion-tag" style="background: #ef4444; color: white; margin-left: 8px;">Soupçon</span>' : '';
      
      card.innerHTML = `
        ${statusLabel ? `<div class="row level-row">
          <span class="tag ${statusClass}">${statusLabel}</span>${suspicionTag}
        </div>` : ''}
        <div class="badge-compact">
          <div class="badge-emoji" ${isMysteryBadge ? 'style="color: #9ca3af;"' : ''}>${safeEmoji}</div>
          <div class="badge-title ${isExpert && unlocked ? 'expert-badge-title' : ''}">${safeTitle}</div>
        </div>
        <div class="all-badge-details hidden">
          <p class="muted">${displayText || ''}</p>
        </div>
      `;
      
      const details = card.querySelector('.all-badge-details');
      
      card.addEventListener('click', (e) => {
        const tag = e.target.tagName.toLowerCase();
        if (tag === 'input' || tag === 'button' || e.target.closest('form')) return;
        
        // Si mode modification actif, ouvrir le formulaire de modification
        if (state.isModifyingBadge) {
          // Empêcher la modification des badges fantômes
          if (isGhostBadge(badge)) {
            alert('Tu ne peux pas modifier un badge fantôme. Une fois débloqué, il reste débloqué.');
            return;
          }
          handleModifyBadgeAnswer(badge);
          return;
        }
        
        // Fermer tous les autres badges
        const allCards = els.allBadgesList.querySelectorAll('.my-catalog-card');
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
      
      els.allBadgesList.appendChild(card);
    });
  });
}

function renderCommunity(profiles) {
  if (!profiles.length) {
    els.communityList.innerHTML = '<p class="muted">Personne pour le moment.</p>';
    return;
  }
  els.communityList.innerHTML = '';
  
  // Vérifier si on est en mode "Top profil" pour afficher le classement
  const showRanking = state.communityFilterMode === 'top';
  
  profiles.forEach((profile, index) => {
    const avatarUrl = profile.avatar_url || './icons/logobl.png';
    
    // Créer un conteneur pour le numéro et la carte si on est en mode classement
    let container;
    if (showRanking) {
      container = document.createElement('div');
      container.className = 'ranking-item-container';
    }
    
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
    
    // Afficher le compteur de badges uniquement en mode "Top" (classement)
    const showBadgePill = state.communityFilterMode === 'top';
    const badgePillHtml = showBadgePill ? `<span class="pill">${profile.badge_count ?? 0} badge(s)</span>` : '';
    
    item.innerHTML = `
      <div class="community-profile-header">
        <img src="${avatarUrl}" alt="Avatar" class="logo small avatar">
        <div>
          <strong>${profile.username}</strong>
          <p class="${rankClass}" ${rankStyle}>${rankText}</p>
        </div>
      </div>
      ${badgePillHtml}
    `;
    item.addEventListener('click', () => showCommunityProfile(item.dataset));
    
    // Si on est en mode classement, créer le numéro et l'ajouter au conteneur
    if (showRanking) {
      const rankingNumber = document.createElement('span');
      const position = index + 1;
      rankingNumber.className = 'ranking-number';
      rankingNumber.textContent = position;
      container.appendChild(rankingNumber);
      container.appendChild(item);
      els.communityList.appendChild(container);
    } else {
      els.communityList.appendChild(item);
    }
  });
}

function renderCommunityFiltered(term = '') {
  const lower = term.trim().toLowerCase();
  let list = [];
  
  // Sélectionner la liste source selon le mode
  if (state.communityFilterMode === 'friends') {
    // Mode "Mes potes" : utiliser la liste des amis mutuels
    list = state.mutualFriends || [];
  } else {
    // Mode "Tous" ou "Top profil" : utiliser la liste complète de la communauté
    list = state.communityProfiles || [];
  }
  
  // Appliquer le filtre de recherche
  let filtered = lower
    ? list.filter(p => (p.username || '').toLowerCase().includes(lower))
    : list;
  
  // Appliquer le mode de filtrage et le tri
  if (state.communityFilterMode === 'top') {
    // Mode "Top profil" : trier par nombre de badges (du plus grand au plus petit) et limiter à 5
    filtered = filtered
      .sort((a, b) => (b.badge_count || 0) - (a.badge_count || 0))
      .slice(0, 5);
  } else if (state.communityFilterMode === 'friends') {
    // Mode "Mes potes" : trier du moins récent au plus récent (par date d'abonnement mutuel)
    filtered = filtered
      .sort((a, b) => {
        const dateA = a.mutual_subscription_date ? new Date(a.mutual_subscription_date).getTime() : 0;
        const dateB = b.mutual_subscription_date ? new Date(b.mutual_subscription_date).getTime() : 0;
        return dateA - dateB; // Du moins récent au plus récent
      });
  } else {
    // Mode "Tous" : trier du plus récent au moins récent (par date de création)
    filtered = filtered
      .sort((a, b) => {
        // Trier par date de création décroissante (plus récent en premier)
        const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
        return dateB - dateA; // Du plus récent au moins récent
      });
  }
  
  renderCommunity(filtered);
}

function sortIdeas(ideas) {
  // Créer une copie pour ne pas modifier l'original
  const sorted = [...ideas];
  
  if (state.ideaFilter === 'recent') {
    // Plus récent au moins récent (par date de création, décroissant)
    sorted.sort((a, b) => {
      const dateA = new Date(a.created_at || 0);
      const dateB = new Date(b.created_at || 0);
      return dateB - dateA; // Plus récent en premier
    });
  } else if (state.ideaFilter === 'liked') {
    // Plus liké (par nombre de likes, décroissant)
    sorted.sort((a, b) => {
      const statsA = getIdeaStats(a.id);
      const statsB = getIdeaStats(b.id);
      return statsB.likes - statsA.likes; // Plus de likes en premier
    });
  }
  
  return sorted;
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
  
  // Trier les idées selon le filtre actif
  const sortedIdeas = sortIdeas(state.ideas);
  
  sortedIdeas.forEach(idea => {
    // Permettre la suppression si c'est le créateur OU si c'est un admin
    const canDelete = (uid && idea.user_id === uid) || (state.user && isAdminUser(state.user));
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
  
  // Cacher le formulaire et réafficher le bouton après soumission réussie
  if (els.ideaForm) {
    els.ideaForm.classList.add('hidden');
  }
  if (els.ideaFormToggle) {
    els.ideaFormToggle.classList.remove('hidden');
  }
  
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
    // Mettre à jour le slider immédiatement pour que le badge soit disponible
    renderThemesSlider();
    
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
    
    // Mettre à jour le slider IMMÉDIATEMENT
    // Le badge ne devrait pas apparaître dans le slider car il est débloqué (filtré par renderThemesSlider)
    // Le state.userBadges a été mis à jour AVANT, donc le filtre fonctionnera correctement
    renderThemesSlider();
    
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
  
  // Mettre à jour les statistiques d'amélioration après une modification de badge
  renderImproveBadgesStats();
  
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

// Retourne le nom du badge à afficher selon le niveau
// Si le badge est au niveau expert et qu'un expert_name est défini, retourne expert_name
// Sinon retourne le nom normal
function getBadgeDisplayName(badge, levelLabel = null) {
  if (!badge) return '';
  
  // Si un niveau est fourni et que c'est un niveau expert, utiliser expert_name si disponible
  if (levelLabel && isMysteryLevel(levelLabel)) {
    if (badge.expert_name && typeof badge.expert_name === 'string' && badge.expert_name.trim()) {
      return badge.expert_name.trim();
    }
  }
  
  // Sinon, retourner le nom normal
  return badge.name || '';
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
  
  // Gestion du bouton "Partager mon profil"
  if (els.shareProfileBtn) {
    els.shareProfileBtn.addEventListener('click', () => {
      shareProfile();
    });
  }

  // Fermer avec la croix
  if (els.profileCloseBtn) {
    els.profileCloseBtn.addEventListener('click', closeProfileDrawer);
  }

  // Fermer en cliquant sur l'overlay (uniquement si le clic est directement sur l'overlay, pas sur le panneau)
  if (els.profileOverlay) {
    els.profileOverlay.addEventListener('click', (e) => {
      // Ne fermer que si le clic est directement sur l'overlay, pas sur le panneau qui est au-dessus
      if (e.target === els.profileOverlay) {
        closeProfileDrawer();
      }
    });
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

// Gestion du slide entre "Ma collection" et "Tous les badges"
function attachProfileBadgesSlideListeners() {
  const container = document.querySelector('.profile-badges-sections-container');
  const indicators = document.querySelectorAll('.section-indicator');
  
  if (!container || !indicators.length) return;
  
  // Fonction pour mettre à jour les indicateurs selon la position de scroll
  function updateIndicators() {
    const scrollLeft = container.scrollLeft;
    const containerWidth = container.clientWidth;
    
    // Chaque section fait 100% de la largeur du conteneur
    // Si scrollLeft est proche de 0, on est sur la première section (Ma collection)
    // Si scrollLeft est proche de containerWidth, on est sur la deuxième section (Tous les badges)
    const threshold = containerWidth * 0.5; // Seuil à 50% de la largeur
    const isOnCollection = scrollLeft < threshold;
    
    indicators.forEach((indicator, index) => {
      if (index === 0) {
        // Premier indicateur = Ma collection
        indicator.classList.toggle('active', isOnCollection);
      } else if (index === 1) {
        // Deuxième indicateur = Tous les badges
        indicator.classList.toggle('active', !isOnCollection);
      }
    });
  }
  
  // S'assurer que le conteneur est à la position initiale (première section)
  container.scrollLeft = 0;
  
  // Initialiser les indicateurs correctement (premier actif)
  indicators.forEach((indicator, index) => {
    if (index === 0) {
      indicator.classList.add('active');
    } else {
      indicator.classList.remove('active');
    }
  });
  
  // Écouter le scroll
  container.addEventListener('scroll', updateIndicators);
  
  // Mettre à jour après un court délai pour s'assurer que le DOM est prêt
  setTimeout(() => {
    updateIndicators();
  }, 100);
  
  // Permettre de cliquer sur les indicateurs pour naviguer
  indicators.forEach((indicator, index) => {
    indicator.addEventListener('click', () => {
      const sectionWidth = container.clientWidth;
      container.scrollTo({
        left: index * sectionWidth,
        behavior: 'smooth'
      });
    });
  });
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

// Fonction pour partager le profil
async function shareProfile() {
  if (!state.user || !state.profile) {
    setMessage('Impossible de partager le profil.', true);
    return;
  }
  
  // Créer l'URL de partage (lien vers le profil dans la communauté)
  // Si on est dans une app Capacitor, utiliser l'URL publique au lieu de capacitor://localhost
  let profileUrl;
  if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
    // Dans une app native, utiliser l'URL publique
    const baseUrl = PUBLIC_APP_URL || 'https://badgelife.app'; // Fallback si non défini
    profileUrl = `${baseUrl}#community-${state.user.id}`;
  } else {
    // Dans un navigateur, utiliser l'URL actuelle
    profileUrl = `${window.location.origin}${window.location.pathname}#community-${state.user.id}`;
  }
  
  const title = `Profil de ${state.profile.username || 'Utilisateur'} sur BadgeLife`;
  const text = `Découvre le profil de ${state.profile.username || 'Utilisateur'} sur BadgeLife !`;
  
  // 1. Essayer d'abord avec le plugin Capacitor Share (pour iOS natif)
  try {
    // Vérifier si on est sur une plateforme native Capacitor
    if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
      // Essayer d'abord via window.Capacitor.Plugins (si le plugin est déjà chargé)
      if (window.Capacitor.Plugins && window.Capacitor.Plugins.Share) {
        await window.Capacitor.Plugins.Share.share({
          title: title,
          text: text,
          url: profileUrl,
          dialogTitle: 'Partager le profil'
        });
        return; // Succès, on sort
      }
      
      // Sinon, essayer d'importer dynamiquement le plugin Share
      try {
        const { Share } = await import('@capacitor/share');
        await Share.share({
          title: title,
          text: text,
          url: profileUrl,
          dialogTitle: 'Partager le profil'
        });
        return; // Succès, on sort
      } catch (importErr) {
        console.warn('Impossible d\'importer le plugin Share:', importErr);
        // Continuer avec les fallbacks
      }
    }
  } catch (err) {
    // Si l'utilisateur annule, ne rien faire
    if (err && (err.message === 'User cancelled' || err.message === 'Share canceled' || err.name === 'AbortError')) {
      return;
    }
    // Logger l'erreur complète pour le débogage
    console.error('Erreur Capacitor Share:', err);
    console.error('Détails de l\'erreur:', JSON.stringify(err, null, 2));
    // Continuer avec les fallbacks
  }
  
  // 2. Essayer avec l'API Web Share (Safari iOS, Chrome Android)
  if (navigator.share) {
    try {
      await navigator.share({
        title: title,
        text: text,
        url: profileUrl
      });
      return; // Succès, on sort
    } catch (err) {
      // Si l'utilisateur annule, ne rien faire
      if (err.name !== 'AbortError') {
        console.error('Erreur lors du partage:', err);
        // Continuer avec le fallback
      } else {
        return; // Utilisateur a annulé
      }
    }
  }
  
  // 3. Fallback : copier le lien dans le presse-papiers
  copyProfileLink(profileUrl);
}

// Fonction pour copier le lien du profil dans le presse-papiers
function copyProfileLink(url) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(() => {
      setMessage('Lien du profil copié dans le presse-papiers !', false);
    }).catch(err => {
      console.error('Erreur lors de la copie:', err);
      setMessage('Impossible de copier le lien. Veuillez le copier manuellement.', true);
    });
  } else {
    // Fallback pour les navigateurs plus anciens
    const textarea = document.createElement('textarea');
    textarea.value = url;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      setMessage('Lien du profil copié dans le presse-papiers !', false);
    } catch (err) {
      console.error('Erreur lors de la copie:', err);
      setMessage('Impossible de copier le lien. Veuillez le copier manuellement.', true);
    }
    document.body.removeChild(textarea);
  }
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
    // Mise à jour de l'image dans la section profil principale pour un changement en temps réel
    if (els.profileSectionAvatar) {
      els.profileSectionAvatar.src = finalUrl;
      els.profileSectionAvatar.style.objectFit = 'cover';
      els.profileSectionAvatar.style.borderRadius = '50%';
    }
  }
}

// Affichage profil communauté (modal)
function showCommunityProfile(data) {
  if (!els.communityProfileModal) return;
  // La classe modal-open sera ajoutée automatiquement par setupModalOpenTracking
  els.communityProfileModal.classList.remove('hidden');
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
  // Stocker l'userId dans le modal pour y accéder dans renderCommunityProfileBadges
  if (els.communityProfileModal && data.userId) {
    els.communityProfileModal.dataset.userId = data.userId;
  }
  renderCommunityProfileBadges([], isPrivate);
  // La classe modal-open sera ajoutée automatiquement par setupModalOpenTracking
  
  // Charger les stats d'abonnement pour ce profil
  if (data.userId && state.user) {
    const isOwnProfile = data.userId === state.user.id;
    
    // Vérifier l'abonnement mutuel pour afficher/masquer la description
    if (!isOwnProfile) {
      Subscriptions.isMutuallySubscribed(supabase, state.user.id, data.userId).then(isMutual => {
        if (els.communityProfileSuspicionDescription) {
          els.communityProfileSuspicionDescription.style.display = isMutual ? 'block' : 'none';
        }
      }).catch(err => {
        console.error('Erreur lors de la vérification de l\'abonnement mutuel:', err);
        if (els.communityProfileSuspicionDescription) {
          els.communityProfileSuspicionDescription.style.display = 'none';
        }
      });
    } else {
      // Masquer la description si c'est notre propre profil
      if (els.communityProfileSuspicionDescription) {
        els.communityProfileSuspicionDescription.style.display = 'none';
      }
    }
    
    Promise.all([
      Subscriptions.getFollowersCount(supabase, data.userId),
      Subscriptions.getSubscriptionsCount(supabase, data.userId),
      Subscriptions.isSubscribed(supabase, state.user.id, data.userId)
    ]).then(([followersCount, subscriptionsCount, isSubscribed]) => {
      SubscriptionUI.renderCommunityProfileSubscription(
        data.userId,
        isOwnProfile,
        followersCount,
        subscriptionsCount,
        isSubscribed
      );
    }).catch(err => {
      console.error('Erreur lors du chargement des stats d\'abonnement:', err);
    });
    
    fetchCommunityUserStats(data.userId, isPrivate);
  } else {
    // Masquer la description si l'utilisateur n'est pas connecté
    if (els.communityProfileSuspicionDescription) {
      els.communityProfileSuspicionDescription.style.display = 'none';
    }
  }
}

function hideCommunityProfile() {
  if (!els.communityProfileModal) return;
  els.communityProfileModal.classList.add('hidden');
}

// Exposer showCommunityProfile, getRankMeta, formatRankText et fetchCommunityUserStats globalement pour les modules d'abonnement
window.showCommunityProfile = showCommunityProfile;
window.getRankMeta = getRankMeta;
window.formatRankText = formatRankText;
window.fetchCommunityUserStats = fetchCommunityUserStats;

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
    const rows = await fetchPublicUserBadges(userId, isPrivate);
    if (!rows || !rows.length) {
      renderCommunityProfileBadges([], isPrivate).catch(err => console.error('Erreur renderCommunityProfileBadges:', err));
      return;
    }
    let unlocked = rows.filter(r => r.success !== false);
    
    // Calculer les points de skills et créer un Set des badges débloqués
    // (nécessaire pour vérifier les conditions des badges fantômes)
    // Exclure les badges bloqués par soupçons du comptage
    let totalSkills = 0;
    const badgesWithLevels = new Set();
    const userBadgeIds = new Set();
    
    unlocked.forEach(row => {
      if (row.badge_id) {
        userBadgeIds.add(row.badge_id);
        // Ne pas compter les skills des badges bloqués par soupçons
        if (!row.is_blocked_by_suspicions) {
          if (row.level) {
            totalSkills += getSkillPointsForBadge(row.badge_id, row.level);
            badgesWithLevels.add(row.badge_id);
          }
        }
      }
    });
    
    // Ajouter les points pour les badges débloqués sans niveau (sauf ceux bloqués)
    unlocked.forEach(row => {
      if (row.badge_id && !badgesWithLevels.has(row.badge_id) && !row.is_blocked_by_suspicions) {
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
    // Exclure les badges bloqués par soupçons du comptage
    totalSkills = 0;
    badgesWithLevels.clear();
    const filteredBadgeIds = new Set();
    
    unlocked.forEach(row => {
      if (row.badge_id) {
        filteredBadgeIds.add(row.badge_id);
        // Ne pas compter les skills des badges bloqués par soupçons
        if (!row.is_blocked_by_suspicions) {
          if (row.level) {
            totalSkills += getSkillPointsForBadge(row.badge_id, row.level);
            badgesWithLevels.add(row.badge_id);
          }
        }
      }
    });
    
    unlocked.forEach(row => {
      if (row.badge_id && !badgesWithLevels.has(row.badge_id) && !row.is_blocked_by_suspicions) {
        const badge = state.badges.find(b => b.id === row.badge_id);
        if (badge) {
          totalSkills += calculatePointsForBadgeWithoutLevel(badge, row.badge_id, row.user_answer);
        }
      }
    });
    
    // Compter uniquement les badges non bloqués par soupçons
    const badgeCount = unlocked.filter(r => !r.is_blocked_by_suspicions).length;
    els.communityProfileBadges.textContent = `${badgeCount} badge(s)`;
    els.communityProfileMystery.textContent = `${totalSkills} skill(s)`;
    renderCommunityProfileBadges(unlocked, isPrivate).catch(err => console.error('Erreur renderCommunityProfileBadges:', err));
  } catch (_) {
    renderCommunityProfileBadges([], isPrivate).catch(err => console.error('Erreur renderCommunityProfileBadges:', err));
  }
}

async function fetchPublicUserBadges(userId, isPrivate = false) {
  // Vérifier si l'utilisateur actuel peut voir les badges
  if (state.user) {
    const canView = await Subscriptions.canViewBadges(supabase, state.user.id, userId, isPrivate);
    if (!canView) {
      return []; // Ne pas retourner de badges si l'utilisateur ne peut pas les voir
    }
  } else {
    // Si l'utilisateur n'est pas connecté, ne peut voir que les profils publics
    if (isPrivate) {
      return [];
    }
  }
  
  // Essaye d'abord une vue publique, sinon retombe sur user_badges
  // Inclure is_blocked_by_suspicions pour savoir si un badge est bloqué
  // Note: public_user_badges_min peut ne pas avoir is_blocked_by_suspicions
  const sources = [
    { table: 'public_user_badges_min', fields: 'badge_id,level,success,user_answer', hasBlockedColumn: false },
    { table: 'user_badges', fields: 'badge_id,level,success,user_answer,is_blocked_by_suspicions', hasBlockedColumn: true },
  ];
  for (const src of sources) {
    const { data, error } = await supabase
      .from(src.table)
      .select(src.fields)
      .eq('user_id', userId);
    if (!error) {
      // Si la vue n'a pas la colonne is_blocked_by_suspicions, ajouter une valeur par défaut
      if (!src.hasBlockedColumn && Array.isArray(data)) {
        return data.map(row => ({ ...row, is_blocked_by_suspicions: false }));
      }
      return data ?? [];
    } else {
      // Si l'erreur est 404 (vue/table n'existe pas) ou PGRST116 (table non trouvée), 
      // continuer silencieusement vers la source suivante
      // Sinon, logger l'erreur pour le débogage
      const isNotFoundError = error.code === 'PGRST116' || 
                             error.message?.includes('does not exist') ||
                             error.message?.includes('Could not find the table') ||
                             error.status === 404;
      if (!isNotFoundError) {
        console.warn(`⚠️ Erreur lors de l'accès à ${src.table}:`, error.message);
      }
      // Continuer vers la source suivante si c'est une erreur "non trouvé"
    }
  }
  return [];
}

// Rendre les badges du profil communautaire comme dans "Mes badges"
async function renderCommunityProfileBadges(unlockedBadges, isPrivate = false) {
  if (!els.communityProfileBadgesList) return;
  
  // Récupérer l'userId du profil affiché depuis le modal
  const profileUserId = els.communityProfileModal?.dataset?.userId;
  const isOwnProfile = profileUserId === state.user?.id;
  
  // Vérifier l'abonnement mutuel si ce n'est pas notre propre profil
  let isMutual = false;
  let suspicionData = new Map(); // badgeId -> { count, hasSuspected, isBlocked }
  
  if (!isOwnProfile && profileUserId && state.user) {
    isMutual = await Subscriptions.isMutuallySubscribed(supabase, state.user.id, profileUserId);
    
    // Si abonnement mutuel, charger toutes les données de soupçons en une seule requête
    if (isMutual && unlockedBadges && unlockedBadges.length > 0) {
      const badgeIds = unlockedBadges
        .filter(row => row.badge_id)
        .map(row => row.badge_id);
      
      // Charger toutes les données de soupçons en une seule requête
      const allSuspicionData = await BadgeSuspicions.getAllSuspicionData(
        supabase,
        state.user.id,
        profileUserId,
        badgeIds
      );
      
      // Construire la Map finale avec les données de blocage
      unlockedBadges.forEach(row => {
        if (row.badge_id) {
          const suspicionInfo = allSuspicionData.get(row.badge_id) || { count: 0, hasSuspected: false };
          suspicionData.set(row.badge_id, {
            count: suspicionInfo.count,
            hasSuspected: suspicionInfo.hasSuspected,
            isBlocked: row.is_blocked_by_suspicions === true
          });
        }
      });
    }
  }
  
  // Créer des Maps et Sets pour les badges de l'utilisateur communautaire
  const communityUserBadges = new Set();
  const communityUserBadgeLevels = new Map();
  const communityUserBadgeAnswers = new Map();
  const communityWasEverUnlocked = new Set();
  const communityBlockedBadges = new Set();
  
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
        // Marquer les badges bloqués par soupçons
        if (row.is_blocked_by_suspicions === true) {
          communityBlockedBadges.add(row.badge_id);
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
      const displayName = getBadgeDisplayName(badge, levelLabel);
      const safeTitle = stripEmojis(displayName);

      const statusLabel = formatLevelTag(unlocked, levelLabel, config);
      const statusClass = isMysteryLevel(levelLabel) ? 'mystery' : 'success';
      const isExpert = isMysteryLevel(levelLabel);
      
      if (isExpert) {
        card.classList.add('expert-badge');
      }

      const formattedAnswer = userAnswer ? formatUserAnswer(badge, userAnswer) : null;
      const ghostText = isGhostBadge(badge) ? (config?.ghostDisplayText || 'Débloqué automatiquement') : null;
      const displayText = formattedAnswer || ghostText || '';
      
      // Vérifier si le badge est bloqué par soupçons
      const isBlocked = communityBlockedBadges.has(badge.id);
      const suspicionInfo = suspicionData.get(badge.id);
      const suspicionCount = suspicionInfo?.count || 0;
      const hasSuspected = suspicionInfo?.hasSuspected || false;
      
      // Ajouter classe pour badge bloqué
      if (isBlocked) {
        card.classList.add('badge-blocked-by-suspicions');
      }
      
      // Construire le HTML avec les boutons de soupçon si abonnement mutuel
      let suspicionHTML = '';
      if (isMutual && !isOwnProfile) {
            suspicionHTML = `
            <div class="suspicion-section" style="margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border-color, #e5e7eb);">
            ${suspicionCount > 0 ? `<p class="muted" style="font-size: 0.875rem; margin-bottom: 8px;">${suspicionCount} soupçon(s)</p>` : ''}
            ${hasSuspected 
              ? `<button class="ghost small suspicion-btn" data-badge-id="${badge.id}" data-action="remove">Retirer soupçon</button>`
              : `<button class="ghost small suspicion-btn" data-badge-id="${badge.id}" data-action="suspect">Soupçonner</button>`
            }
          </div>
        `;
      }
      
      // Ajouter indicateur "Soupçon" si bloqué
      const suspicionTag = isBlocked ? '<span class="tag suspicion-tag" style="background: #ef4444; color: white; margin-left: 8px;">Soupçon</span>' : '';

      card.innerHTML = `
        <div class="row level-row">
          <span class="tag ${statusClass}">${statusLabel}</span>${suspicionTag}
        </div>
        <div class="badge-compact">
          <div class="badge-emoji">${safeEmoji}</div>
          <div class="badge-title ${isExpert ? 'expert-badge-title' : ''}">${safeTitle}</div>
        </div>
        <div class="all-badge-details hidden">
          <p class="muted">${displayText || ''}</p>
          ${suspicionHTML}
        </div>
      `;

      const details = card.querySelector('.all-badge-details');
      
      // Gérer les clics sur les boutons de soupçon
      const suspicionBtn = card.querySelector('.suspicion-btn');
      if (suspicionBtn && !isOwnProfile && profileUserId) {
        suspicionBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const badgeId = e.target.dataset.badgeId;
          const action = e.target.dataset.action;
          
          if (action === 'suspect') {
            const result = await BadgeSuspicions.suspectBadge(supabase, state.user.id, profileUserId, badgeId);
            if (result.success) {
              // Recharger les badges pour mettre à jour l'affichage
              const rows = await fetchPublicUserBadges(profileUserId, isPrivate);
              await renderCommunityProfileBadges(rows, isPrivate);
            } else {
              alert(result.error || 'Erreur lors du soupçon.');
            }
          } else if (action === 'remove') {
            const result = await BadgeSuspicions.removeSuspicion(supabase, state.user.id, profileUserId, badgeId);
            if (result.success) {
              // Recharger les badges pour mettre à jour l'affichage
              const rows = await fetchPublicUserBadges(profileUserId, isPrivate);
              await renderCommunityProfileBadges(rows, isPrivate);
            } else {
              alert(result.error || 'Erreur lors du retrait du soupçon.');
            }
          }
        });
      }
      
      card.addEventListener('click', (e) => {
        const tag = e.target.tagName.toLowerCase();
        if (tag === 'input' || tag === 'button' || e.target.closest('form') || e.target.closest('.suspicion-section')) return;
        
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
    document.body.classList.remove('auth-page');
  } else {
    els.authView.classList.remove('hidden');
    els.appView.classList.add('hidden');
    document.body.classList.add('auth-page');
    
    // Vérifier que l'image de fond se charge (debug)
    const testImg = new Image();
    testImg.onload = () => console.log('✅ Image de fond chargée avec succès');
    testImg.onerror = () => console.error('❌ Erreur lors du chargement de l\'image de fond');
    testImg.src = './icons/background.png';
  }
}

function toggleAdminLink(show) {
  if (els.adminLink) {
    if (show) {
      els.adminLink.classList.remove('hidden');
    } else {
      els.adminLink.classList.add('hidden');
    }
  }
  // Mettre à jour aussi le lien admin du profil
  const profileAdminLink = document.getElementById('profile-admin-link');
  if (profileAdminLink) {
    if (show) {
      profileAdminLink.classList.remove('hidden');
    } else {
      profileAdminLink.classList.add('hidden');
    }
  }
}

function setMessage(text, isError = false) {
  els.authMessage.textContent = text;
  els.authMessage.classList.toggle('error', isError);
}

// Afficher le loader de connexion
function showLoginLoader() {
  if (!els.loginLoader) return;
  els.loginLoader.classList.remove('hidden');
  // Petit délai pour que l'animation s'affiche
  setTimeout(() => {
    els.loginLoader.classList.add('visible');
  }, 10);
}

// Cacher le loader de connexion
function hideLoginLoader() {
  if (!els.loginLoader) return;
  els.loginLoader.classList.remove('visible');
  setTimeout(() => {
    els.loginLoader.classList.add('hidden');
  }, 300);
}

// Animation de transition lors de la connexion
async function animateLoginTransition() {
  if (!els.loginLoader || !els.authView || !els.appView) return;
  
  // Mettre à jour le texte avec une transition douce
  const loaderText = els.loginLoader.querySelector('.login-loader-text');
  if (loaderText) {
    loaderText.style.opacity = '0';
    setTimeout(() => {
      loaderText.textContent = 'Bienvenue !';
      loaderText.style.opacity = '1';
    }, 200);
  }
  
  // Attendre un peu pour que l'utilisateur voie le message
  await new Promise(resolve => setTimeout(resolve, 800));
  
  // Préparer l'app-view avant l'animation
  toggleViews(true);
  
  // Petit délai pour que le DOM se mette à jour
  await new Promise(resolve => setTimeout(resolve, 50));
  
  // Animation de zoom/fade simultanée
  els.loginLoader.classList.add('zooming-out');
  els.appView.classList.add('zooming-in');
  
  // Attendre la fin de l'animation (800ms pour l'animation de zoom)
  await new Promise(resolve => setTimeout(resolve, 800));
  
  // Cacher le loader
  hideLoginLoader();
  
  // Retirer la classe d'animation après un délai
  setTimeout(() => {
    els.appView.classList.remove('zooming-in');
  }, 100);
}

// Met à jour la jauge de progression des badges

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
  
  // Exclure les badges bloqués par soupçons du comptage
  const validBadgeIdsWithoutBlocked = new Set();
  validBadgeIds.forEach(badgeId => {
    if (!state.blockedBySuspicions.has(badgeId)) {
      validBadgeIdsWithoutBlocked.add(badgeId);
    }
  });
  
  // Recalculer les points en excluant les badges fantômes rebloqués et les badges bloqués par soupçons
  const badgeCount = validBadgeIdsWithoutBlocked.size;
  
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
  
  // Compter les points pour les badges avec niveaux (exclure les badges bloqués par soupçons)
  state.userBadgeLevels.forEach((lvl, badgeId) => {
    if (validBadgeIdsWithoutBlocked.has(badgeId)) {
      totalSkillPoints += getSkillPointsForBadge(badgeId, lvl);
    }
  });
  
  // Compter les points pour les badges débloqués sans niveau (text, boolean, etc.)
  // Exclure les badges bloqués par soupçons
  validBadgeIdsWithoutBlocked.forEach(badgeId => {
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
  
  // Mettre à jour le slider de thèmes
  renderThemesSlider();
  
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
    // Préserver le span "pts" lors de la mise à jour
    const ptsSpan = els.profileSectionSkillCount.querySelector('.skill-pts');
    if (ptsSpan) {
      // Si le span pts existe déjà, mettre à jour seulement le texte avant
      const textNode = Array.from(els.profileSectionSkillCount.childNodes).find(node => node.nodeType === Node.TEXT_NODE);
      if (textNode) {
        textNode.textContent = totalSkillPoints;
      } else {
        // Si pas de texte, créer un nouveau nœud texte
        els.profileSectionSkillCount.insertBefore(document.createTextNode(totalSkillPoints), ptsSpan);
      }
    } else {
      // Si le span pts n'existe pas, créer la structure complète
      els.profileSectionSkillCount.innerHTML = `${totalSkillPoints}<span class="skill-pts">pts</span>`;
    }
  }
  if (els.profileSectionCompletion) {
    // Calculer le pourcentage de complétion
    let totalBadgesForCompletion = 0;
    const allBadges = state.badges || [];
    allBadges.forEach(badge => {
      if (!isGhostBadge(badge)) {
        // Badge normal : toujours compté
        totalBadgesForCompletion++;
      }
    });
    const completionPercentage = totalBadgesForCompletion > 0 ? Math.round((badgeCount / totalBadgesForCompletion) * 100) : 0;
    els.profileSectionCompletion.textContent = `${completionPercentage}%`;
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

// Fonction utilitaire pour obtenir la date d'aujourd'hui en heure de Paris (Europe/Paris)
// Retourne la date au format YYYY-MM-DD
function getTodayInParis() {
  const now = new Date();
  // Convertir en heure de Paris (UTC+1 en hiver, UTC+2 en été)
  // Utiliser toLocaleString avec le fuseau horaire Europe/Paris
  const parisDate = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  const year = parisDate.getFullYear();
  const month = String(parisDate.getMonth() + 1).padStart(2, '0');
  const day = String(parisDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Fonction utilitaire pour obtenir un objet Date en heure de Paris
// Retourne une date à minuit (00:00:00) en heure de Paris
function getDateInParis() {
  const now = new Date();
  
  // Utiliser Intl.DateTimeFormat pour obtenir les composants de date en heure de Paris
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  
  const yearParis = parseInt(parts.find(p => p.type === 'year').value);
  const monthParis = parseInt(parts.find(p => p.type === 'month').value) - 1; // Mois 0-indexé
  const dayParis = parseInt(parts.find(p => p.type === 'day').value);
  
  // Créer une date locale avec les composants de Paris (sera interprétée comme locale)
  // Cela évite les problèmes de conversion UTC
  const parisDateLocal = new Date(yearParis, monthParis, dayParis, 0, 0, 0, 0);
  
  return parisDateLocal;
}

// Fonction utilitaire pour formater une date au format YYYY-MM-DD
function formatDateYYYYMMDD(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Retourne le lundi de la semaine pour une date donnée
// Corrigé pour éviter les problèmes de changement de mois
function getWeekStartDate(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0 = dimanche, 1 = lundi, etc.
  
  // Calculer le nombre de jours à soustraire pour arriver au lundi
  // Si c'est dimanche (0), on recule de 6 jours, sinon on recule de (day - 1) jours
  const daysToSubtract = day === 0 ? 6 : day - 1;
  
  // Créer une nouvelle date pour éviter de modifier l'originale
  const monday = new Date(d);
  monday.setDate(d.getDate() - daysToSubtract);
  
  return monday;
}

// Fonction utilitaire pour filtrer les dates d'un tableau pour ne garder que celles de la semaine actuelle
// Évite la duplication de code dans plusieurs fonctions
// Optimisée pour éviter de recalculer le début de semaine pour chaque date
function filterDatesByCurrentWeek(dateArray, currentWeekStartStr) {
  if (!Array.isArray(dateArray) || dateArray.length === 0) return [];
  
  // Calculer les limites de la semaine actuelle une seule fois
  const currentWeekStart = new Date(currentWeekStartStr + 'T00:00:00');
  const currentWeekEnd = new Date(currentWeekStart);
  currentWeekEnd.setDate(currentWeekStart.getDate() + 6); // Dimanche de la semaine
  
  // Filtrer en comparant directement les dates (plus rapide que recalculer le début de semaine)
  return dateArray.filter(dateStr => {
    try {
      const date = new Date(dateStr + 'T00:00:00');
      // Vérifier si la date est entre le lundi et le dimanche de la semaine actuelle
      return date >= currentWeekStart && date <= currentWeekEnd;
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

// Fonction utilitaire pour vérifier si une date est un dimanche
// Utilisée partout pour éviter les incohérences
function isSundayDate(dateStr) {
  try {
    const date = new Date(dateStr + 'T00:00:00');
    return date.getDay() === 0; // 0 = dimanche en JavaScript
  } catch (e) {
    return false;
  }
}

// Fonction utilitaire pour obtenir la date du dimanche d'une semaine donnée
// Prend le lundi de la semaine (currentWeekStartStr) et retourne le dimanche
function getSundayDateOfWeek(currentWeekStartStr) {
  try {
    const monday = new Date(currentWeekStartStr + 'T00:00:00');
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6); // Dimanche est 6 jours après le lundi
    return formatDateYYYYMMDD(sunday);
  } catch (e) {
    return null;
  }
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
  
  // Utiliser l'heure de Paris pour tous les calculs de date
  const today = getDateInParis();
  const currentWeekStart = getWeekStartDate(today);
  const currentWeekStartStr = formatDateYYYYMMDD(currentWeekStart);
  
  // DEBUG : Vérifier les données AVANT le traitement
  console.log('=== loadConnectionDays - AVANT traitement ===');
  console.log('state.profile.week_start_date:', state.profile.week_start_date);
  console.log('state.profile.connection_days:', state.profile.connection_days);
  console.log('state.profile.claimed_daily_tokens:', state.profile.claimed_daily_tokens);
  console.log('currentWeekStartStr:', currentWeekStartStr);
  
  // Si on a une semaine enregistrée et que c'est une nouvelle semaine, réinitialiser
  if (state.profile.week_start_date) {
    // Convertir la date sauvegardée (qui est déjà en format YYYY-MM-DD)
    const savedWeekStartStr = state.profile.week_start_date;
    
    console.log('savedWeekStartStr (depuis Supabase):', savedWeekStartStr);
    console.log('currentWeekStartStr (calculé aujourd\'hui):', currentWeekStartStr);
    const todayStrForDisplay = formatDateYYYYMMDD(today);
    console.log('Date d\'aujourd\'hui (Paris):', todayStrForDisplay);
    console.log('Jour de la semaine (0=dimanche, 1=lundi...):', today.getDay());
    console.log('Nouvelle semaine?', savedWeekStartStr !== currentWeekStartStr);
    
    if (savedWeekStartStr !== currentWeekStartStr) {
      // Nouvelle semaine : réinitialiser les jours de connexion ET les jetons récupérés
      console.log('⚠️ NOUVELLE SEMAINE DÉTECTÉE - Réinitialisation');
      
      // Filtrer les données existantes pour ne garder que celles de la semaine actuelle
      // (normalement, il ne devrait y en avoir aucune, mais on filtre par sécurité)
      const connectionDaysFromProfile = Array.isArray(state.profile.connection_days) ? state.profile.connection_days : [];
      const connectionDaysThisWeek = filterDatesByCurrentWeek(
        connectionDaysFromProfile,
        currentWeekStartStr
      );
      const claimedTokensThisWeek = filterDatesByCurrentWeek(
        Array.isArray(state.profile.claimed_daily_tokens) ? state.profile.claimed_daily_tokens : [],
        currentWeekStartStr
      );
      
      // DEBUG : Afficher ce qui est filtré
      console.log('🔍 Données avant filtrage:', connectionDaysFromProfile);
      console.log('🔍 Données après filtrage:', connectionDaysThisWeek);
      console.log('🔍 Semaine actuelle (lundi):', currentWeekStartStr);
      
      // Réinitialiser localement (les données filtrées devraient être vides pour une nouvelle semaine)
      state.connectionDays = connectionDaysThisWeek;
      state.claimedDailyTokens = claimedTokensThisWeek;
      state.weekBonusClaimed = false;
      state.weekStartDate = currentWeekStartStr;
      
      // Mettre à jour le profil local avec les données filtrées
      if (state.profile) {
        state.profile.connection_days = connectionDaysThisWeek;
        state.profile.claimed_daily_tokens = claimedTokensThisWeek;
        state.profile.week_bonus_claimed = false;
        state.profile.week_start_date = currentWeekStartStr;
        state.profile.week_bonus_available = false;
      }
      
      // Sauvegarder dans Supabase les données filtrées (nettoyer les anciennes semaines)
      // Cela garantit que la base de données ne contient que les données de la semaine actuelle
      try {
        const { error } = await supabase
          .from('profiles')
          .update({ 
            week_start_date: currentWeekStartStr,
            week_bonus_available: false,
            week_bonus_claimed: false,
            connection_days: connectionDaysThisWeek,
            claimed_daily_tokens: claimedTokensThisWeek
          })
          .eq('id', state.user.id);
        
        if (error) {
          console.error('Erreur lors de la mise à jour de la semaine:', error);
        } else {
          console.log('✅ Semaine réinitialisée dans Supabase');
        }
      } catch (error) {
        console.error('Erreur lors de la mise à jour de la semaine:', error);
      }
    } else {
      // Même semaine : charger les jours existants et les filtrer pour la semaine actuelle
      console.log('✅ MÊME SEMAINE - Chargement des données existantes');
      
      // Filtrer les données pour ne garder que celles de la semaine actuelle
      const connectionDaysFiltered = filterDatesByCurrentWeek(
        Array.isArray(state.profile.connection_days) ? state.profile.connection_days : [],
        currentWeekStartStr
      );
      const claimedTokensFiltered = filterDatesByCurrentWeek(
        Array.isArray(state.profile.claimed_daily_tokens) ? state.profile.claimed_daily_tokens : [],
        currentWeekStartStr
      );
      
      state.connectionDays = connectionDaysFiltered;
      state.claimedDailyTokens = claimedTokensFiltered;
      state.weekStartDate = state.profile.week_start_date || currentWeekStartStr;
      
      // Mettre à jour le profil local avec les données filtrées
      if (state.profile) {
        state.profile.connection_days = connectionDaysFiltered;
        state.profile.claimed_daily_tokens = claimedTokensFiltered;
      }
      
      console.log('connectionDays chargés (filtrés):', state.connectionDays);
      console.log('claimedDailyTokens chargés (filtrés):', state.claimedDailyTokens);
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
  
  // Recalculer la date d'aujourd'hui pour être cohérent (heure de Paris)
  const todayForLog = getDateInParis();
  const todayStrForLog = formatDateYYYYMMDD(todayForLog);
  
  console.log('=== APRÈS traitement semaine ===');
  console.log('state.connectionDays:', state.connectionDays);
  console.log('state.weekStartDate:', state.weekStartDate);
  console.log('Date d\'aujourd\'hui:', todayStrForLog);
  console.log('Jour de la semaine (0=dimanche):', todayForLog.getDay());
  console.log('Début de semaine actuelle:', currentWeekStartStr);
  if (state.connectionDays && state.connectionDays.length > 0) {
    console.log('⚠️ ATTENTION: connectionDays contient des éléments après réinitialisation:', state.connectionDays);
    console.log('Ces dates sont-elles dans la semaine actuelle?');
    state.connectionDays.forEach(dateStr => {
      const isInWeek = isDateInCurrentWeek(dateStr, currentWeekStartStr);
      console.log(`  - ${dateStr}: ${isInWeek ? '✅ Dans la semaine' : '❌ Pas dans la semaine'}`);
    });
  }
  console.log('==================================');
  
  // S'assurer que state.weekStartDate est toujours défini
  if (!state.weekStartDate) {
    state.weekStartDate = currentWeekStartStr;
  }
  
  // Les données sont déjà filtrées dans la section précédente (nouvelle semaine ou même semaine)
  // On s'assure juste que state.claimedDailyTokens est bien initialisé
  if (!state.claimedDailyTokens) {
    state.claimedDailyTokens = [];
  }
  
  // DEBUG : Afficher les données chargées
  console.log('=== loadConnectionDays - Données chargées ===');
  console.log('connectionDays:', state.connectionDays);
  console.log('claimedDailyTokens:', state.claimedDailyTokens);
  console.log('profile.claimed_daily_tokens:', state.profile.claimed_daily_tokens);
  console.log('weekStartDate:', state.weekStartDate);
  console.log('currentWeekStartStr:', currentWeekStartStr);
  console.log('===========================================');
  
  // IMPORTANT : Synchroniser localStorage avec Supabase
  // Si les données de Supabase existent, elles ont priorité
  // localStorage est seulement un backup si la colonne n'existe pas dans Supabase
  
  // Vérifier si les données de Supabase existent (même après filtrage)
  const hasClaimedTokensInSupabase = state.profile.claimed_daily_tokens && 
                                     Array.isArray(state.profile.claimed_daily_tokens);
  
  // Si on a des données dans Supabase, synchroniser localStorage avec Supabase
  if (hasClaimedTokensInSupabase && state.user) {
    try {
      // Sauvegarder les données filtrées dans localStorage pour backup
      localStorage.setItem(`claimed_tokens_${state.user.id}`, JSON.stringify(state.claimedDailyTokens));
      console.log('localStorage synchronisé avec Supabase');
    } catch (e) {
      console.warn('Impossible de synchroniser localStorage:', e);
    }
  }
  
  // Charger depuis localStorage UNIQUEMENT si :
  // 1. state.claimedDailyTokens est vide (après filtrage)
  // 2. ET state.profile.claimed_daily_tokens n'existe pas ou n'est pas un tableau (colonne absente dans Supabase)
  // 3. ET localStorage contient des données
  if (state.claimedDailyTokens.length === 0 && !hasClaimedTokensInSupabase && state.user) {
    try {
      const stored = localStorage.getItem(`claimed_tokens_${state.user.id}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          // Filtrer aussi les dates du localStorage pour ne garder que celles de la semaine actuelle
          const filteredParsed = filterDatesByCurrentWeek(parsed, currentWeekStartStr);
          state.claimedDailyTokens = filteredParsed;
          state.profile.claimed_daily_tokens = filteredParsed;
          console.log('Données chargées depuis localStorage (backup)');
        }
      }
    } catch (e) {
      console.warn('Erreur lors du chargement depuis localStorage:', e);
    }
  }
  
  state.weekBonusClaimed = Boolean(state.profile.week_bonus_claimed);
  
  // Filtrer les jours de connexion pour ne garder que ceux de la semaine actuelle
  const connectionDaysThisWeek = filterDatesByCurrentWeek(
    state.connectionDays || [],
    currentWeekStartStr
  );
  
  // Vérifier si le bonus est disponible (tous les jours de la semaine actuelle connectés et non réclamé)
  state.canClaimBonus = connectionDaysThisWeek.length === 7 && !state.weekBonusClaimed;
  
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
  
  // Utiliser l'heure de Paris pour tous les calculs de date
  const today = getDateInParis();
  const todayStr = formatDateYYYYMMDD(today);
  const currentWeekStart = getWeekStartDate(today);
  const currentWeekStartStr = formatDateYYYYMMDD(currentWeekStart);
  
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
  
  // Variable pour savoir si on a modifié quelque chose
  let hasChanged = false;
  
  // Ajouter seulement la date d'aujourd'hui si pas déjà présente
  // Les jours précédents sont déjà chargés depuis Supabase via loadConnectionDays()
  if (!connectionDaysThisWeek.includes(todayStr)) {
    connectionDaysThisWeek.push(todayStr);
    hasChanged = true;
  }
  
  // Mettre à jour state.connectionDays avec les jours filtrés (même si rien n'a changé)
  // Cela garantit que state.connectionDays contient toujours les bons jours
  state.connectionDays = connectionDaysThisWeek;
  state.profile.connection_days = [...state.connectionDays];
  
  // Vérifier si tous les 7 jours sont connectés
  const allDaysConnected = state.connectionDays.length === 7;
  if (allDaysConnected) {
    // Tous les jours sont connectés : rendre le bonus disponible
    state.canClaimBonus = true;
    state.profile.week_bonus_available = true;
  }
  
  // IMPORTANT : Toujours sauvegarder dans Supabase pour s'assurer que tous les jours sont bien enregistrés
  // Cela garantit que même si une sauvegarde précédente a échoué, les jours seront bien sauvegardés
  try {
    const { error } = await supabase
      .from('profiles')
      .update({ 
        connection_days: state.connectionDays,
        week_bonus_available: state.profile.week_bonus_available
      })
      .eq('id', state.user.id);
    
    if (error) {
      console.error('Erreur lors de la sauvegarde des connection_days:', error);
      // En cas d'erreur, sauvegarder dans localStorage comme backup
      if (state.user) {
        try {
          localStorage.setItem(`connection_days_${state.user.id}`, JSON.stringify(state.connectionDays));
        } catch (e) {
          console.warn('Impossible de sauvegarder dans localStorage:', e);
        }
      }
    } else if (hasChanged) {
      console.log('✅ Jour de connexion sauvegardé:', todayStr);
      console.log('📅 Tous les jours de connexion:', state.connectionDays);
    }
  } catch (error) {
    console.error('Erreur lors de la sauvegarde des connection_days:', error);
    // En cas d'erreur, sauvegarder dans localStorage comme backup
    if (state.user) {
      try {
        localStorage.setItem(`connection_days_${state.user.id}`, JSON.stringify(state.connectionDays));
      } catch (e) {
        console.warn('Impossible de sauvegarder dans localStorage:', e);
      }
    }
  }
  
  // Rendre le calendrier seulement si nécessaire (pas de double rendu)
  // Le calendrier sera rendu par loadConnectionDays() ou lors de l'ouverture du drawer
  // On ne le rend ici que si on a modifié quelque chose ET que le calendrier est ouvert
  if (hasChanged && els.calendarDrawer && !els.calendarDrawer.classList.contains('hidden')) {
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
  
  // Utiliser l'heure de Paris pour tous les calculs de date
  const today = getDateInParis();
  const todayStr = formatDateYYYYMMDD(today);
  const currentWeekStart = getWeekStartDate(today);
  const currentWeekStartStr = formatDateYYYYMMDD(currentWeekStart);
  
  // DEBUG : Afficher les données utilisées pour le rendu
  console.log('=== renderCalendar - Données utilisées ===');
  console.log('state.claimedDailyTokens:', state.claimedDailyTokens);
  console.log('state.profile.claimed_daily_tokens:', state.profile?.claimed_daily_tokens);
  console.log('currentWeekStartStr:', currentWeekStartStr);
  console.log('==========================================');
  
  // Rendu du calendrier
  
  const dayNames = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  const days = [];
  
  // Filtrer les jours de connexion pour ne garder que ceux de la semaine actuelle
  const connectionDaysThisWeek = filterDatesByCurrentWeek(
    state.connectionDays || [],
    currentWeekStartStr
  );
  
  // Vérifier si tous les jours de la semaine actuelle sont connectés pour le bonus hebdomadaire
  const allDaysConnected = connectionDaysThisWeek.length === 7;
  
  // Générer les 7 jours de la semaine (lundi à dimanche)
  for (let i = 0; i < 7; i++) {
    const day = new Date(currentWeekStart);
    day.setDate(currentWeekStart.getDate() + i);
    const dayStr = formatDateYYYYMMDD(day);
    const isConnected = connectionDaysThisWeek.includes(dayStr);
    // Vérifier que le jour est dans la semaine actuelle avant de vérifier s'il est réclamé
    const isInCurrentWeek = isDateInCurrentWeek(dayStr, currentWeekStartStr);
    
    // Vérifier si le jour est réclamé (utilise la fonction utilitaire qui vérifie state ET profil)
    const isClaimed = isInCurrentWeek && isDayClaimed(dayStr, currentWeekStartStr);
    const isToday = dayStr === todayStr;
    
    // Vérifier si c'est le dimanche en utilisant la fonction utilitaire
    const isSunday = isSundayDate(dayStr);
    
    // Déterminer l'état du jour
    let dayState = 'not-available'; // Par défaut : non disponible
    let clickable = false;
    let tokenInfo = '';
    
    // Pour le dimanche : vérifier le bonus hebdomadaire (priorité sur les jetons journaliers)
    if (isSunday && allDaysConnected) {
      if (state.weekBonusClaimed) {
        dayState = 'bonus-claimed';
        clickable = false;
        tokenInfo = '✓ Bonus récupéré';
      } else {
        // Bonus disponible (remplace les jetons journaliers du dimanche)
        dayState = 'bonus-available';
        clickable = true;
        tokenInfo = `🪙 +${SUNDAY_BONUS_AMOUNT} bonus`;
      }
    } else if (isConnected) {
      if (isClaimed) {
        dayState = 'claimed'; // Déjà récupéré
        clickable = false;
        tokenInfo = '';
      } else {
        dayState = 'available'; // Disponible pour récupération
        clickable = true;
        tokenInfo = `🪙 +${DAILY_TOKENS_AMOUNT}`;
      }
    } else {
      dayState = 'not-available'; // Pas de connexion ce jour
      clickable = false;
      tokenInfo = '';
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
    
    // Vérifier que le jour est dans la semaine actuelle (heure de Paris)
    const today = getDateInParis();
    const currentWeekStart = getWeekStartDate(today);
    const currentWeekStartStr = formatDateYYYYMMDD(currentWeekStart);
    
    if (!isDateInCurrentWeek(dayStr, currentWeekStartStr)) {
      console.warn('Le jour demandé n\'est pas dans la semaine actuelle');
      renderCalendar();
      return;
    }
    
    // Filtrer les jours de connexion pour ne garder que ceux de la semaine actuelle
    const connectionDaysThisWeek = filterDatesByCurrentWeek(
      state.connectionDays || [],
      currentWeekStartStr
    );
    
    // Vérifier directement le state actuel (pas seulement le tableau days)
    // Cela évite les problèmes si l'utilisateur clique rapidement plusieurs fois
    const isConnected = connectionDaysThisWeek.includes(dayStr);
    const allDaysConnected = connectionDaysThisWeek.length === 7;
    
    // Vérifier si le jour est réclamé (utilise la fonction utilitaire)
    if (isDayClaimed(dayStr, currentWeekStartStr)) {
      console.warn('Jetons déjà récupérés pour ce jour:', dayStr);
      renderCalendar();
      return;
    }
    
    // Vérifier si c'est le dimanche avec bonus disponible (utilise la fonction utilitaire)
    const isSunday = isSundayDate(dayStr);
    
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
  
  // Vérifier que le jour est dans la semaine actuelle (heure de Paris)
  const today = getDateInParis();
  const currentWeekStart = getWeekStartDate(today);
  const currentWeekStartStr = formatDateYYYYMMDD(currentWeekStart);
  
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
  // IMPORTANT : Activer le verrou AVANT toute autre opération pour éviter les race conditions
  state.isClaimingTokens = true;
  state.claimingDay = dayStr;
  
  // Vérification finale avant de continuer (double vérification pour éviter les race conditions)
  // Vérifier une dernière fois que le jour n'a pas été réclamé entre-temps
  if (isDayClaimed(dayStr, currentWeekStartStr)) {
    console.warn('Jour déjà réclamé (vérification finale), annulation');
    state.isClaimingTokens = false;
    state.claimingDay = null;
    renderCalendar();
    updateCalendarBadge();
    return;
  }
  
  try {
    // IMPORTANT : Mettre à jour le state local IMMÉDIATEMENT pour éviter les doubles clics
    // Cela empêche l'utilisateur de cliquer plusieurs fois avant que la sauvegarde soit terminée
    const newTokens = (state.tokens || 0) + DAILY_TOKENS_AMOUNT;
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
      
      // Annuler les changements locaux immédiatement pour éviter les incohérences
      state.tokens = (state.tokens || 0) - DAILY_TOKENS_AMOUNT;
      state.profile.tokens = state.tokens;
      state.claimedDailyTokens = state.claimedDailyTokens.filter(d => d !== dayStr);
      if (state.profile.claimed_daily_tokens) {
        state.profile.claimed_daily_tokens = state.profile.claimed_daily_tokens.filter(d => d !== dayStr);
      }
      
      // Re-rendre le calendrier pour remettre l'état correct
      renderCalendar();
      updateCalendarBadge();
      updateTokensDisplay();
      
      // Si la colonne n'existe pas, essayer de sauvegarder uniquement les jetons
      if (updateError.message && updateError.message.includes('claimed_daily_tokens')) {
        console.warn('Colonne claimed_daily_tokens absente dans la base de données. Veuillez exécuter le script SQL add_tokens_columns.sql pour ajouter cette colonne.');
        
        // Mettre à jour uniquement les jetons (sans la colonne claimed_daily_tokens)
        const { error: retryError } = await supabase
          .from('profiles')
          .update({ tokens: state.tokens })
          .eq('id', state.user.id);
        
        if (!retryError) {
          // Stocker aussi dans localStorage comme backup (si la colonne n'existe pas)
          try {
            const currentClaimed = state.claimedDailyTokens || [];
            localStorage.setItem(`claimed_tokens_${state.user.id}`, JSON.stringify(currentClaimed));
            console.log('Jetons sauvegardés dans localStorage comme backup');
          } catch (e) {
            console.warn('Impossible de stocker dans localStorage:', e);
          }
          
          // Afficher un message d'avertissement à l'utilisateur
          setMessage('Les jetons ont été ajoutés, mais la sauvegarde complète a échoué. Veuillez contacter le support.', true);
        } else {
          console.error('Erreur lors de la mise à jour des jetons:', retryError);
          // Afficher un message d'erreur à l'utilisateur
          setMessage('Erreur lors de la sauvegarde des jetons. Veuillez réessayer.', true);
          // Recharger depuis Supabase pour récupérer l'état réel
          await fetchProfile();
        }
      } else {
        // Autre type d'erreur (réseau, permissions, etc.)
        console.error('Erreur de sauvegarde:', updateError);
        // Afficher un message d'erreur à l'utilisateur
        setMessage('Erreur de connexion lors de la sauvegarde. Veuillez réessayer.', true);
        // Recharger depuis Supabase pour récupérer l'état réel
        await fetchProfile();
      }
      
      // Ne pas continuer après une erreur
      return;
    } else {
      // Succès : les données sont déjà dans le state local et sauvegardées dans Supabase
      // Ne PAS recharger le profil immédiatement car cela pourrait causer des problèmes de synchronisation
      // Le state local est déjà à jour avec les bonnes données
      // Jetons récupérés avec succès
      
      // Animation sur la case du calendrier
      const dayEl = els.calendarWeek?.querySelector(`[data-day="${dayStr}"]`);
      if (dayEl) {
        createTokenClaimAnimation(dayEl, DAILY_TOKENS_AMOUNT);
      }
      
      // Mettre à jour l'affichage
      updateTokensDisplay();
      updateCalendarBadge(); // Mettre à jour la pastille du bouton calendrier
      
      // Notification de jetons supprimée (garder uniquement le message d'inscription)
      
      // Créer une notification dans le système unifié
      if (state.user) {
        await createDailyTokensNotification(supabase, state.user.id, dayStr, DAILY_TOKENS_AMOUNT);
      }
      
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
  
  // Trouver la date du dimanche de la semaine actuelle (heure de Paris)
  const today = getDateInParis();
  const currentWeekStart = getWeekStartDate(today);
  const currentWeekStartStr = formatDateYYYYMMDD(currentWeekStart);
  const sundayStr = getSundayDateOfWeek(currentWeekStartStr);
  
  if (!sundayStr) {
    console.error('Impossible de calculer la date du dimanche');
    return;
  }
  
  // Filtrer les jours de connexion pour ne garder que ceux de la semaine actuelle
  const connectionDaysThisWeek = filterDatesByCurrentWeek(
    state.connectionDays || [],
    currentWeekStartStr
  );
  
  // Vérifier que tous les jours de la semaine actuelle sont connectés
  if (connectionDaysThisWeek.length !== 7) {
    console.warn('Tous les jours de la semaine actuelle doivent être connectés pour récupérer le bonus');
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
  
  // ACTIVER LE VERROU : empêcher les appels multiples simultanés
  // IMPORTANT : Activer le verrou AVANT toute autre opération pour éviter les race conditions
  state.isClaimingTokens = true;
  state.claimingDay = sundayStr;
  
  // Vérification finale avant de continuer (double vérification pour éviter les race conditions)
  // Vérifier une dernière fois que le bonus n'a pas été réclamé entre-temps
  if (state.weekBonusClaimed || state.profile?.week_bonus_claimed) {
    console.warn('Bonus déjà réclamé (vérification finale), annulation');
    state.isClaimingTokens = false;
    state.claimingDay = null;
    renderCalendar();
    updateCalendarBadge();
    return;
  }
  
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
    
    // Synchroniser localStorage après une sauvegarde réussie
    if (!error && state.user) {
      try {
        localStorage.setItem(`claimed_tokens_${state.user.id}`, JSON.stringify(updatedClaimed));
        console.log('localStorage synchronisé après sauvegarde du bonus réussie');
      } catch (e) {
        console.warn('Impossible de synchroniser localStorage:', e);
      }
    }
    
    if (error) {
      console.error('Erreur lors de la réclamation du bonus:', error);
      // En cas d'erreur, annuler les changements locaux et recharger depuis Supabase
      state.tokens = (state.tokens || 0) - SUNDAY_BONUS_AMOUNT;
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
        createTokenClaimAnimation(sundayEl, SUNDAY_BONUS_AMOUNT);
        createConfettiAnimation(sundayEl);
      }
      
      // Mettre à jour l'affichage
      updateTokensDisplay();
      updateCalendarBadge();
      
      // Notification de jetons supprimée (garder uniquement le message d'inscription)
      
      // Créer une notification dans le système unifié
      if (state.user && sundayStr) {
        await createSundayBonusNotification(supabase, state.user.id, sundayStr, SUNDAY_BONUS_AMOUNT);
      }
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
    // Calculer le début de la semaine actuelle pour filtrer les dates
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const currentWeekStart = getWeekStartDate(today);
    const currentWeekStartStr = formatDateYYYYMMDD(currentWeekStart);
    
    // Filtrer les jours de connexion et les jours réclamés pour ne garder que la semaine actuelle
    const connectionDaysThisWeek = filterDatesByCurrentWeek(
      state.connectionDays || [],
      currentWeekStartStr
    );
    const claimedDaysThisWeek = filterDatesByCurrentWeek(
      state.claimedDailyTokens || [],
      currentWeekStartStr
    );
    
    // Compter les jours avec des jetons disponibles mais non récupérés (seulement pour la semaine actuelle)
    let availableTokensCount = 0;
    
    if (connectionDaysThisWeek.length > 0) {
      // Compter les jours connectés mais non récupérés dans la semaine actuelle
      availableTokensCount = connectionDaysThisWeek.filter(dayStr => 
        !claimedDaysThisWeek.includes(dayStr)
      ).length;
    }
    
    // Vérifier si le bonus hebdomadaire est disponible (tous les jours de la semaine actuelle connectés)
    const allDaysConnected = connectionDaysThisWeek.length === 7;
    const canClaimBonus = allDaysConnected && !state.weekBonusClaimed && !state.profile?.week_bonus_claimed;
    
    // Ajouter 1 si le bonus hebdomadaire est disponible
    if (canClaimBonus) {
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
  
  // Gestion de la classe modal-open pour fix iOS
  setupModalOpenTracking();
}

/**
 * Configure le tracking des modals pour gérer body.modal-open
 * Fix iOS : neutralise overflow de #app-view quand un modal est ouvert
 */
function setupModalOpenTracking() {
  const modalSelectors = [
    '#subscribers-modal',
    '#subscriptions-modal',
    '#notifications-modal',
    '#modify-badge-overlay',
    '#community-profile-modal',
  ];
  
  const observer = new MutationObserver((mutations) => {
    let hasVisibleModal = false;
    
    modalSelectors.forEach(selector => {
      const modal = document.querySelector(selector);
      if (modal && !modal.classList.contains('hidden')) {
        hasVisibleModal = true;
        
        // Log debug si body a la classe debug-modal
        if (document.body.classList.contains('debug-modal')) {
          const modalCard = modal.querySelector('.modal-card') || modal.querySelector('.card');
          setTimeout(() => {
            logModalDebugInfo(modal, modalCard);
          }, 100);
        }
      }
    });
    
    // Ajouter/retirer la classe modal-open sur body
    if (hasVisibleModal) {
      document.body.classList.add('modal-open');
    } else {
      document.body.classList.remove('modal-open');
    }
  });
  
  // Observer tous les modals
  modalSelectors.forEach(selector => {
    const modal = document.querySelector(selector);
    if (modal) {
      observer.observe(modal, {
        attributes: true,
        attributeFilter: ['class'],
      });
    }
  });
}

