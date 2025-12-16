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
  userBadges: new Set(),
  userBadgeLevels: new Map(),
  userBadgeAnswers: new Map(), // stocke la réponse saisie par badge
  attemptedBadges: new Set(),
  mysteryCount: 0,
};

const els = {};

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
  attachAuthTabListeners();
  attachFormListeners();
  attachNavListeners();
  attachProfileListeners();
  bootstrapSession();
});

function cacheElements() {
  els.authView = document.getElementById('auth-view');
  els.appView = document.getElementById('app-view');
  els.authMessage = document.getElementById('auth-message');
  els.loginForm = document.getElementById('login-form');
  els.signupForm = document.getElementById('signup-form');
  els.profileUsername = document.getElementById('profile-username');
  els.avatarImg = document.getElementById('avatar-img');
  els.avatarPreviewImg = document.getElementById('avatar-preview-img');
  els.badgeCount = document.getElementById('badge-count');
  els.mysteryCount = document.getElementById('mystery-count');
  els.adminLink = document.getElementById('admin-link');
  els.logoutBtn = document.getElementById('logout-btn');
  els.editProfileBtn = document.getElementById('edit-profile-btn');
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
  els.communityList = document.getElementById('community-list');
  els.communityProfileModal = document.getElementById('community-profile-modal');
  els.communityProfileClose = document.getElementById('community-profile-close');
  els.communityProfileAvatar = document.getElementById('community-profile-avatar');
  els.communityProfileUsername = document.getElementById('community-profile-username');
  els.communityProfileBadges = document.getElementById('community-profile-badges');
  els.communityProfileMystery = document.getElementById('community-profile-mystery');
  els.communityProfileBadgesGrid = document.getElementById('community-profile-badges-grid');
  els.communityProfileAnswer = document.getElementById('community-profile-answer');
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
      await supabase.from('profiles').upsert({ id: userId, username, badge_count: 0 });
    }
    state.session = data.session;
    state.user = data.user;
    toggleAdminLink(isAdminUser(state.user));
    await loadAppData();
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

async function bootstrapSession() {
  const { data } = await supabase.auth.getSession();
  if (data.session) {
    state.session = data.session;
    state.user = data.session.user;
    toggleAdminLink(isAdminUser(state.user));
    await loadAppData();
  } else {
    toggleViews(false);
    toggleAdminLink(false);
  }
}

function resetState() {
  state.session = null;
  state.user = null;
  state.profile = null;
  state.badges = [];
  state.userBadges = new Set();
  state.userBadgeLevels = new Map();
  state.userBadgeAnswers = new Map();
  state.attemptedBadges = new Set();
  state.mysteryCount = 0;
  els.myBadgesList.innerHTML = '';
  els.allBadgesList.innerHTML = '';
  els.communityList.innerHTML = '';
}

async function loadAppData() {
  toggleViews(true);
  await Promise.all([fetchProfile(), fetchBadges(), fetchUserBadges(), fetchCommunity()]);
  render();
}

async function fetchProfile() {
  if (!state.user) return;
  const { data, error } = await supabase.from('profiles').select('username, badge_count, avatar_url').eq('id', state.user.id).single();
  if (error && error.code !== 'PGRST116') {
    console.error(error);
    return;
  }
  if (!data) {
    await supabase.from('profiles').insert({ id: state.user.id, username: 'Invité', badge_count: 0, avatar_url: null });
    state.profile = { username: 'Invité', badge_count: 0, avatar_url: null };
  } else {
    state.profile = data;
  }
}

async function fetchBadges() {
  // On récupère en priorité depuis Supabase.
  // Si on définit window.USE_LOCAL_BADGES = true, ou si Supabase échoue,
  // on charge un fichier local badges.json (plus simple à éditer dans le code).
  const selectWithEmoji = 'id,name,description,question,answer,emoji';
  const selectFallback = 'id,name,description,question,answer';
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
      return;
    }
  }

  // Fallback local
  const localBadges = await loadLocalBadges();
  if (!localBadges.length && !useLocalOnly) {
    setMessage('Impossible de charger les badges.', true);
  }
  state.badges = localBadges;
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
    state.userBadgeLevels = new Map(rows.filter(r => r.success !== false && r.level !== null).map(r => [r.badge_id, r.level]));
    state.userBadgeAnswers = new Map(rows.filter(r => r.success !== false && r.user_answer).map(r => [r.badge_id, r.user_answer]));
    await updateCounters(true);
    return;
  }

  const { data, error } = await supabase.from('user_badges').select('badge_id, level, success, user_answer').eq('user_id', state.user.id);
  if (error) {
    console.error(error);
    return;
  }
  const rows = data ?? [];
  state.attemptedBadges = new Set(rows.map(row => row.badge_id));
  state.userBadges = new Set(rows.filter(r => r.success !== false).map(row => row.badge_id));
  state.userBadgeLevels = new Map(rows.filter(r => r.success !== false && r.level !== null).map(r => [r.badge_id, r.level]));
  state.userBadgeAnswers = new Map(rows.filter(r => r.success !== false && r.user_answer).map(r => [r.badge_id, r.user_answer]));
  await updateCounters(true);
}

async function fetchCommunity() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id,username,badge_count,avatar_url')
    .order('badge_count', { ascending: false })
    .limit(50);
  if (error) {
    console.error(error);
    return;
  }

  const profiles = data ?? [];
  const ids = profiles.map(p => p.id).filter(Boolean);

  if (ids.length) {
    // Recalcule les compteurs via user_badges pour avoir des chiffres à jour (success != false).
    const { data: rows, error: errBadges } = await supabase
      .from('user_badges')
      .select('user_id, level, success')
      .in('user_id', ids);
    if (!errBadges && Array.isArray(rows)) {
      const countMap = new Map();
      const mysteryMap = new Map();
      rows.forEach(r => {
        if (r.success === false) return;
        const uid = r.user_id;
        countMap.set(uid, (countMap.get(uid) || 0) + 1);
        if (isMysteryLevel(r.level)) {
          mysteryMap.set(uid, (mysteryMap.get(uid) || 0) + 1);
        }
      });
      profiles.forEach(p => {
        p.badge_count = countMap.get(p.id) || 0;
        p.mystery_count = mysteryMap.get(p.id) || 0;
      });
    }
  }

  renderCommunity(profiles);
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

function renderAllBadges() {
  if (!state.badges.length) {
    els.allBadgesList.innerHTML = '<p class="muted">Aucun badge pour le moment.</p>';
    return;
  }
  els.allBadgesList.innerHTML = '';
  state.badges.forEach(badge => {
    const unlocked = state.userBadges.has(badge.id);
    const levelLabelRaw = state.userBadgeLevels.get(badge.id);
    const levelLabel = levelLabelRaw;
    const config = parseConfig(badge.answer);
    const card = document.createElement('article');
    card.className = 'card-badge clickable compact';
    const statusLabel = unlocked
      ? `Débloqué${levelLabel ? ' · ' + levelLabel : ''}`
      : 'À débloquer';
    const statusClass = unlocked ? (isMysteryLevel(levelLabel) ? 'mystery' : 'success') : 'locked';
    const emoji = getBadgeEmoji(badge);
    const title = stripEmojis(badge.name || '');
    const levelCount = getLevelCount(config);
    const levelsText = levelCount ? `${levelCount} niveaux à obtenir` : '';
    let formContent = `
      <input type="text" name="answer" placeholder="Ta réponse" required>
      <button type="submit" class="primary">Valider</button>
      <p class="message small"></p>
    `;
    if (config?.type === 'multiSelect' && Array.isArray(config.options)) {
      const optionsMarkup = config.options.map(opt => `
        <option value="${opt.value}">${opt.label}</option>
      `).join('');
      const size = Math.min(Math.max(config.options.length, 4), 9); // entre 4 et 9 lignes
      formContent = `
        <select name="answer-select" class="select-multi" multiple size="${size}">
          ${optionsMarkup}
        </select>
        <small class="muted">Tu peux sélectionner plusieurs options (Ctrl/Cmd + clic).</small>
        <button type="submit" class="primary">Valider</button>
        <p class="message small"></p>
      `;
    }
    card.innerHTML = `
      <div class="row">
        <span class="tag ${statusClass}">${statusLabel}</span>
      </div>
      <div class="badge-compact">
        <div class="badge-emoji">${emoji}</div>
        <div class="badge-title">${title}</div>
      </div>
      ${levelCount ? `<p class="muted">${levelsText}</p>` : ''}
      <div class="all-badge-details hidden">
        <p class="muted">${badge.question}</p>
        <form data-badge-id="${badge.id}">
          ${formContent}
        </form>
      </div>
    `;
    const form = card.querySelector('form');
    form.addEventListener('submit', (e) => handleBadgeAnswer(e, badge));
    const details = card.querySelector('.all-badge-details');
    card.addEventListener('click', (e) => {
      const tag = e.target.tagName.toLowerCase();
      if (tag === 'input' || tag === 'button' || e.target.closest('form')) return;
      details.classList.toggle('hidden');
      card.classList.toggle('expanded');
    });
    els.allBadgesList.appendChild(card);
  });
}

function renderMyBadges() {
  const unlockedBadges = state.badges.filter(b => state.userBadges.has(b.id));
  if (!unlockedBadges.length) {
    els.myBadgesList.innerHTML = '<p class="muted">Aucun badge débloqué pour l’instant.</p>';
    return;
  }
  els.myBadgesList.classList.add('list-mode');
  els.myBadgesList.innerHTML = '';
  unlockedBadges.forEach(badge => {
    const levelLabel = state.userBadgeLevels.get(badge.id);
    const normLevel = levelLabel;
    const card = document.createElement('article');
    // Classe supplémentaire pour cibler le style "Mes badges" sans toucher les autres listes
    card.className = 'card-badge clickable compact my-badge-card';
    const userAnswer = state.userBadgeAnswers.get(badge.id);
    const formattedAnswer = userAnswer ? formatUserAnswer(badge, userAnswer) : null;
    const cleanName = stripEmojis(badge.name || '');
    const hasLevel = Boolean(levelLabel);
    const levelClass = isMysteryLevel(levelLabel)
      ? 'tag mystery'
      : (hasLevel ? 'tag success' : 'tag success');
    const levelText = hasLevel ? normLevel : 'Débloqué';
    card.innerHTML = `
      <div class="row">
        <span class="${levelClass}">${levelText}</span>
      </div>
      <div class="badge-compact">
        <div class="badge-emoji">${getBadgeEmoji(badge)}</div>
        <div class="badge-title">${cleanName}</div>
      </div>
      <div class="badge-details">
        ${formattedAnswer ? `<p class="muted">${formattedAnswer}</p>` : ''}
      </div>
    `;

    const details = card.querySelector('.badge-details');
    card.addEventListener('click', (e) => {
      const tag = e.target.tagName.toLowerCase();
      if (tag === 'input' || tag === 'button' || e.target.closest('form')) return;
      // On ne change pas la forme du badge : on affiche seulement la réponse.
      card.classList.toggle('show-details');
    });
    els.myBadgesList.appendChild(card);
  });
}

function renderCommunity(profiles) {
  if (!profiles.length) {
    els.communityList.innerHTML = '<p class="muted">Personne pour le moment.</p>';
    return;
  }
  els.communityList.innerHTML = '';
  profiles.forEach(profile => {
    const avatarUrl = profile.avatar_url || './icons/badgelife-logo.svg';
    const item = document.createElement('div');
    item.className = 'list-item';
    item.dataset.userId = profile.id || '';
    item.dataset.username = profile.username;
    item.dataset.avatar = avatarUrl;
    item.dataset.badges = profile.badge_count ?? 0;
    item.dataset.mystery = profile.mystery_count ?? 0;
    item.innerHTML = `
      <div style="display:flex; align-items:center; gap:10px;">
        <img src="${avatarUrl}" alt="Avatar" class="logo small" style="width:36px;height:36px;border-radius:50%;object-fit:cover;">
        <div>
          <strong>${profile.username}</strong>
          <p class="muted">Membre BadgeLife</p>
        </div>
      </div>
      <span class="pill">${profile.badge_count ?? 0} badge(s)</span>
    `;
    item.addEventListener('click', () => showCommunityProfile(item.dataset));
    els.communityList.appendChild(item);
  });
}

async function handleBadgeAnswer(event, badge) {
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
  const selectInput = isMultiSelect ? form.querySelector('select[name="answer-select"]') : null;
  const checkboxInputs = isMultiSelect ? form.querySelectorAll('input[name="answer-option"]:checked') : null;
  const answerInput = isMultiSelect ? null : form.querySelector('input[name="answer"]');
  const selectedOptions = isMultiSelect
    ? (
        selectInput
          ? Array.from(selectInput.selectedOptions || []).map(o => o.value)
          : Array.from(checkboxInputs || []).map(el => el.value)
      )
    : [];
  const feedback = form.querySelector('.message');
  feedback.textContent = '';
  const rawAnswer = isMultiSelect ? selectedOptions.join(', ') : (answerInput?.value.trim() || '');
  if (isMultiSelect && !selectedOptions.length) {
    feedback.textContent = 'Choisis au moins une option.';
    feedback.classList.add('error');
    return;
  }
  if (!isMultiSelect && !rawAnswer) {
    feedback.textContent = 'Réponse vide.';
    feedback.classList.add('error');
    return;
  }

  const result = evaluateBadgeAnswer(badge, rawAnswer, selectedOptions);
  if (!result.ok) {
    // On enregistre aussi l'échec et on remet le badge en "À débloquer".
    if (localMode) {
      const rows = loadLocalUserBadgeRows();
      const others = rows.filter(r => r.badge_id !== badge.id);
      const updated = [...others, { badge_id: badge.id, success: false, level: null, user_answer: rawAnswer || null }];
      saveLocalUserBadgeRows(updated);
    } else {
      await supabase.from('user_badges').upsert({
        user_id: state.user.id,
        badge_id: badge.id,
        success: false,
        level: null,
        user_answer: rawAnswer || null,
      });
    }
    state.userBadges.delete(badge.id);
    state.userBadgeLevels.delete(badge.id);
    state.userBadgeAnswers.delete(badge.id);
    state.attemptedBadges.add(badge.id);
    feedback.textContent = result.message || 'Badge non débloqué.';
    feedback.classList.add('error');
    updateCounters(false);
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
    });
    if (error) {
      feedback.textContent = 'Erreur, merci de réessayer.';
      feedback.classList.add('error');
      return;
    }
  }
  state.userBadges.add(badge.id);
  if (result.level) state.userBadgeLevels.set(badge.id, result.level);
  state.userBadgeAnswers.set(badge.id, rawAnswer);
  state.attemptedBadges.add(badge.id);
  updateCounters(false);
  feedback.textContent = result.message || 'Bravo, badge gagné !';
  feedback.classList.remove('error');
  render();
}

function isMysteryLevel(label) {
  if (typeof label !== 'string') return false;
  const lower = label.toLowerCase();
  // On accepte encore "secret" pour les anciennes données, mais on affichera "Niv mystère".
  return lower.includes('mystère') || lower.includes('mystere') || lower.includes('secret');
}

function getLevelCount(config) {
  if (!config) return 0;
  if (Array.isArray(config.levels)) return config.levels.length;
  return 0;
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
    const levels = Array.isArray(config.levels) ? [...config.levels] : [];
    levels.sort((a, b) => (b.min ?? 0) - (a.min ?? 0));
    const level = levels.find(l => count >= (l.min ?? 0));
    const maxLevel = levels.length ? levels[0] : null;
    const levelLabel = level?.label ?? null;
    const isMax = maxLevel && levelLabel === maxLevel.label;
    const finalLabel = (isLecteurBadge && isMax) ? 'Niv max'
      : (isMax && !isMysteryLevel(levelLabel) ? 'Niv max' : levelLabel);
    const storedLabel = isMysteryLevel(finalLabel) ? 'Niv mystère' : finalLabel;
    return { ok: true, level: storedLabel, message: 'Bravo, badge débloqué !' };
  }

  if (config && config.type === 'range' && Array.isArray(config.levels)) {
    const value = Number(rawAnswer);
    if (Number.isNaN(value)) {
      return { ok: false, message: 'Merci de saisir un nombre.' };
    }
    const level = config.levels.find(l => value >= (l.min ?? -Infinity) && value <= (l.max ?? Infinity));
    if (!level) {
      return { ok: false, message: 'Valeur hors des niveaux.' };
    }
    const maxLevel = config.levels[config.levels.length - 1];
    const isMax = level === maxLevel;
    const finalLabel = (isLecteurBadge && isMax) ? 'Niv max'
      : ((isMax && !isMysteryLevel(level.label)) ? 'Niv max' : level.label);
    const storedLabel = isMysteryLevel(finalLabel) ? 'Niv mystère' : finalLabel;
    return { ok: true, level: storedLabel, message: `Bravo, niveau obtenu : ${storedLabel}` };
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
  const template = config?.displayTemplate; // ex: "Ta réponse : {{answer}} pays visités."
  const suffix = config?.displaySuffix;     // ex: "pays visités"
  const questionSuffix = inferSuffixFromQuestion(badge.question);
  const lowerAns = answer?.trim().toLowerCase();

  // Cas particulier : question de type "sauvé une vie" (boolean)
  if (config?.type === 'boolean' && badge.question?.toLowerCase().includes('sauvé une vie')) {
    if (lowerAns === 'oui' || lowerAns === 'yes' || lowerAns === 'y') {
      return 'A déjà sauvé une vie';
    }
    if (lowerAns === 'non' || lowerAns === 'no' || lowerAns === 'n') {
      return 'N’a pas encore sauvé de vie';
    }
  }
  // Cas particulier : service militaire (boolean)
  if (config?.type === 'boolean' && badge.question?.toLowerCase().includes('service militaire')) {
    if (lowerAns === 'oui' || lowerAns === 'yes' || lowerAns === 'y') {
      return 'A fait son service militaire';
    }
    if (lowerAns === 'non' || lowerAns === 'no' || lowerAns === 'n') {
      return 'N’a pas encore fait son service militaire';
    }
  }

  // Cas particulier : badge Amoureux/se (boolean)
  if (config?.type === 'boolean' && badge.name?.toLowerCase().includes('amoureux')) {
    if (lowerAns === 'oui' || lowerAns === 'yes' || lowerAns === 'y') {
      return 'A été amoureux/se';
    }
    if (lowerAns === 'non' || lowerAns === 'no' || lowerAns === 'n') {
      return 'N’a jamais été amoureux/se';
    }
  }

  // Cas particulier : badge Pilote → préfixe lisible "permis de ..."
  if (badge?.name && badge.name.toLowerCase().includes('pilote')) {
    return `permis de ${answer}`;
  }

  // Cas particulier : badge Bodycounter (orthographe tolérante) → suffixe explicite
  if (badge?.name) {
    const lowerName = badge.name.toLowerCase();
    if (lowerName.includes('bodycounter') || lowerName.includes('bodycoutner')) {
      return `${answer} partenaires sexuelle`;
    }
  }

  if (config?.type === 'multiSelect') {
    // On affiche directement la sélection sans préfixe "Réponse :"
    return `${answer}`;
  }
  if (typeof template === 'string' && template.includes('{{answer}}')) {
    return template.replace('{{answer}}', answer);
  }
  if (typeof suffix === 'string' && suffix.trim().length) {
    return `${answer} ${suffix}`;
  }
  if (questionSuffix) {
    return `${answer} ${questionSuffix}`;
  }
  // Fallback lisible si rien n'est configuré
  return `${answer}`;
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

function inferSuffixFromQuestion(question) {
  if (!question) return null;
  const q = question.toLowerCase();
  if (q.includes('pays')) return 'pays visités';
  if (q.includes('livre')) return 'livres lus';
  if (q.includes('kilomètre') || q.includes('km')) return 'km/h sur l`autoroute';
  if (q.includes('heures') || q.includes('heure')) return 'heures';
  if (q.includes('service militaire') || q.includes('militaire')) return 'service militaire';
  return null;
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
        els.avatarPreviewImg.src = './icons/badgelife-logo.svg';
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
    // Optionnel : validation de taille (plafond porté à ~5 Mo)
    const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
    if (avatarFile.size > MAX_AVATAR_BYTES) {
      return setProfileMessage('Image trop lourde (max ~5 Mo).', true);
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
  const finalUrl = url || './icons/badgelife-logo.svg';
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
  els.communityProfileAvatar.src = data.avatar || './icons/badgelife-logo.svg';
  els.communityProfileUsername.textContent = data.username || 'Utilisateur';
  els.communityProfileBadges.textContent = `${data.badges || 0} badge(s)`;
  els.communityProfileMystery.textContent = `${data.mystery || 0} niv. mystère`;
  renderCommunityBadgeGrid([]);
  els.communityProfileModal.classList.remove('hidden');
  if (data.userId) {
    fetchCommunityUserStats(data.userId);
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
async function fetchCommunityUserStats(userId) {
  try {
    const rows = await fetchPublicUserBadges(userId);
    if (!rows || !rows.length) {
      renderCommunityBadgeGridMessage('Badges non visibles');
      return;
    }
    const unlocked = rows.filter(r => r.success !== false);
    const badgeCount = unlocked.length;
    const mystery = unlocked.filter(r => isMysteryLevel(r.level)).length;
    els.communityProfileBadges.textContent = `${badgeCount} badge(s)`;
    els.communityProfileMystery.textContent = `${mystery} niv. mystère`;
    renderCommunityBadgeGrid(unlocked);
  } catch (_) {
    renderCommunityBadgeGridMessage('Badges non visibles');
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

function renderCommunityBadgeGrid(unlockedBadges) {
  if (!els.communityProfileBadgesGrid) return;
  if (els.communityProfileAnswer) {
    els.communityProfileAnswer.textContent = '';
  }
  if (!unlockedBadges || !unlockedBadges.length) {
    renderCommunityBadgeGridMessage('Aucun badge');
    return;
  }
  const items = unlockedBadges.map(row => {
    const badge = state.badges.find(b => b.id === row.badge_id);
    const emoji = badge ? getBadgeEmoji(badge) : '🏅';
    const formatted = badge ? formatUserAnswer(badge, row.user_answer || '') : (row.user_answer || '');
    return `<button class="modal-badge-emoji" data-answer="${encodeURIComponent(formatted)}" title="${badge?.name ?? ''}">${emoji}</button>`;
  }).join('');
  els.communityProfileBadgesGrid.innerHTML = items;
  els.communityProfileBadgesGrid.querySelectorAll('.modal-badge-emoji').forEach(btn => {
    btn.addEventListener('click', () => {
      const ans = decodeURIComponent(btn.dataset.answer || '');
      // Met en évidence l'emoji sélectionné
      els.communityProfileBadgesGrid.querySelectorAll('.modal-badge-emoji')
        .forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (els.communityProfileAnswer) {
        els.communityProfileAnswer.textContent = ans ? ans : 'Réponse indisponible';
      }
    });
  });
}

function renderCommunityBadgeGridMessage(msg) {
  if (!els.communityProfileBadgesGrid) return;
  els.communityProfileBadgesGrid.innerHTML = `<p class="muted" style="grid-column:1/-1;text-align:center;">${msg}</p>`;
  if (els.communityProfileAnswer) {
    els.communityProfileAnswer.textContent = '';
  }
}

function toggleViews(authenticated) {
  els.authView.classList.toggle('hidden', authenticated);
  els.appView.classList.toggle('hidden', !authenticated);
}

function toggleAdminLink(show) {
  if (!els.adminLink) return;
  els.adminLink.style.display = show ? 'inline-flex' : 'none';
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
  const badgeCount = state.userBadges.size;
  const totalBadges = state.badges?.length ?? 0;
  state.mysteryCount = Array.from(state.userBadgeLevels.values()).filter(isMysteryLevel).length;
  if (els.badgeCount) els.badgeCount.textContent = `${badgeCount}/${totalBadges}`;
  if (els.mysteryCount) els.mysteryCount.textContent = state.mysteryCount;
  if (state.profile) {
    state.profile.badge_count = badgeCount;
    if (syncProfile) {
      await supabase.from('profiles').update({ badge_count: badgeCount }).eq('id', state.user.id);
    }
  }
}

