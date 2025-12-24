// Admin badges - gestion CRUD via Supabase
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, ADMIN_USER_IDS } from './config.js';
import { isMysteryLevel, pickHighestLevel, extractSkillNumber, calculateMaxSkillPoints, calculateSkillsTotals as calculateSkillsTotalsShared } from './badgeCalculations.js';
import { parseBadgeAnswer, safeSupabaseSelect, pseudoToEmail, isAdminUser } from './utils.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const state = {
  session: null,
  badges: [],
};

const els = {};

document.addEventListener('DOMContentLoaded', async () => {
  cacheEls();
  bindAuth();
  bindForm();
  bindTokensForm();
  await bootstrapSession();
});

function cacheEls() {
  els.authCard = document.getElementById('admin-auth-card');
  els.app = document.getElementById('admin-app');
  els.loginForm = document.getElementById('admin-login-form');
  els.loginMsg = document.getElementById('admin-message');
  els.logoutBtn = document.getElementById('admin-logout');
  els.badgeTotal = document.getElementById('admin-badge-total');
  els.skillsTotal = document.getElementById('admin-skills-total');
  els.lowSkillsTotal = document.getElementById('admin-low-skills-total');
  els.badgeList = document.getElementById('badge-list');
  els.badgeForm = document.getElementById('badge-form');
  els.formMsg = document.getElementById('form-message');
  els.id = document.getElementById('badge-id');
  els.name = document.getElementById('badge-name');
  els.emoji = document.getElementById('badge-emoji');
  els.theme = document.getElementById('badge-theme');
  els.q = document.getElementById('badge-question');
  els.answerType = document.getElementById('answer-type');
  els.answerText = document.getElementById('answer-text');
  els.boolDisplayText = document.getElementById('bool-display-text');
  els.boolDisplayTextFalse = document.getElementById('bool-display-text-false');
  els.boolSkillPoints = document.getElementById('bool-skill-points');
  els.rangeLevels = document.getElementById('range-levels');
  els.multiOptions = document.getElementById('multi-options');
  els.multiLevels = document.getElementById('multi-levels');
  els.multiSkillByOptionHidden = document.getElementById('multi-skill-by-option');
  els.multiSkillByOptionToggle = document.getElementById('multi-skill-by-option-toggle');
  els.multiOptionSkills = document.getElementById('multi-option-skills');
  els.multiSkillByOptionBlock = document.getElementById('multi-skill-by-option-block');
  els.singleOptions = document.getElementById('single-options');
  els.singleSkills = document.getElementById('single-skills');
  els.multiDisplayListHidden = document.getElementById('multi-display-list');
  els.multiDisplayListToggle = document.getElementById('multi-display-list-toggle');
  els.displayPrefix = document.getElementById('display-prefix');
  els.displaySuffix = document.getElementById('display-suffix');
  els.blockedMessage = document.getElementById('blocked-message');
  els.lowSkillHidden = document.getElementById('badge-low-skill');
  els.lowSkillToggle = document.getElementById('badge-low-skill-toggle');
  els.ghostHidden = document.getElementById('badge-ghost');
  els.ghostToggle = document.getElementById('badge-ghost-toggle');
  els.ghostRequiredBadgesSelect = document.getElementById('ghost-required-badges-select');
  els.ghostPrereqMode = document.getElementById('ghost-prereq-mode');
  els.ghostMinBadges = document.getElementById('ghost-min-badges');
  els.ghostMinSkills = document.getElementById('ghost-min-skills');
  els.ghostMinRank = document.getElementById('ghost-min-rank');
  els.ghostDisplayText = document.getElementById('ghost-display-text');
  els.ghostSkillPoints = document.getElementById('ghost-skill-points');
  els.ghostBlock = document.getElementById('block-ghost');
  els.btnDelete = document.getElementById('btn-delete');
  els.btnReset = document.getElementById('btn-reset');
  els.blocks = {
    text: document.getElementById('block-text'),
    boolean: document.getElementById('block-boolean'),
    range: document.getElementById('block-range'),
    multiSelect: document.getElementById('block-multi'),
    singleSelect: document.getElementById('block-single'),
  };
  els.nonGhostOnly = Array.from(document.querySelectorAll('.non-ghost-only'));
  els.tokensForm = document.getElementById('tokens-form');
  els.tokensAmount = document.getElementById('tokens-amount');
  els.tokensMessage = document.getElementById('tokens-message');
}

function bindAuth() {
  els.loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('admin-username').value.trim();
    const password = document.getElementById('admin-password').value.trim();
    if (!username) return setAuthMsg('Entre ton pseudo.', true);
    if (!password) return setAuthMsg('Entre ton mot de passe.', true);
    setAuthMsg('Connexion...');
    const email = pseudoToEmail(username);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setAuthMsg(error.message || 'Connexion impossible.', true);
      return;
    }
    if (!isAdminUser(data.user)) {
      setAuthMsg('Accès refusé : compte non autorisé pour l’admin.', true);
      await supabase.auth.signOut();
      return;
    }
    state.session = data.session;
    setAuthMsg('Connecté.');
    await enterApp();
  });

  els.logoutBtn.addEventListener('click', async () => {
    await supabase.auth.signOut();
    state.session = null;
    toggleApp(false);
  });
}

function bindForm() {
  els.answerType.addEventListener('change', () => showBlock(els.answerType.value));

  if (els.lowSkillToggle) {
    els.lowSkillToggle.addEventListener('click', () => toggleLowSkill());
  }

  if (els.ghostToggle) {
    els.ghostToggle.addEventListener('click', () => toggleGhost());
  }
  if (els.multiDisplayListToggle) {
    els.multiDisplayListToggle.addEventListener('click', () => toggleMultiDisplayList());
  }
  if (els.multiSkillByOptionToggle) {
    els.multiSkillByOptionToggle.addEventListener('click', () => toggleMultiSkillByOption());
  }

  els.badgeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const isGhost = Boolean(Number(els.ghostHidden?.value || '0'));
    const payload = buildPayloadFromForm();
    if (!payload.name) return setFormMsg('Nom requis.', true);
    if (!isGhost && !payload.question) return setFormMsg('Question requise.', true);
    setFormMsg('Enregistrement...');
    let { error } = await supabase.from('badges').upsert(payload);
    // Si la colonne emoji n'existe pas, on retente sans le champ emoji
    if (error && error.message && error.message.toLowerCase().includes('emoji')) {
      const payloadNoEmoji = { ...payload };
      delete payloadNoEmoji.emoji;
      const retry = await supabase.from('badges').upsert(payloadNoEmoji);
      error = retry.error;
    }
    if (error) {
      setFormMsg(error.message || 'Erreur lors de la sauvegarde.', true);
      return;
    }
    setFormMsg('Badge enregistré.');
    await loadBadges();
    if (!payload.id) resetForm(); // si nouvel ID auto, on vide le formulaire
  });

  els.btnDelete.addEventListener('click', async () => {
    const rawId = els.id.value.trim();
    if (!rawId) return setFormMsg('ID requis pour supprimer.', true);
    const idValue = Number.isNaN(Number(rawId)) ? rawId : Number(rawId);
    setFormMsg('Suppression...');
    const { error } = await supabase.from('badges').delete().eq('id', idValue);
    if (error) {
      setFormMsg(error.message || 'Erreur lors de la suppression.', true);
      return;
    }
    setFormMsg('Badge supprimé.');
    await loadBadges();
    resetForm();
  });

  els.btnReset.addEventListener('click', resetForm);
}

async function bootstrapSession() {
  const { data } = await supabase.auth.getSession();
  if (data.session) {
    if (!isAdminUser(data.session.user)) {
      await supabase.auth.signOut();
      toggleApp(false);
      setAuthMsg('Accès refusé : compte non autorisé.');
      return;
    }
    state.session = data.session;
    await enterApp();
  } else {
    toggleApp(false);
  }
}

async function enterApp() {
  toggleApp(true);
  setAuthMsg('');
  await loadBadges();
}

function toggleApp(isConnected) {
  els.authCard.classList.toggle('hidden', isConnected);
  els.app.classList.toggle('hidden', !isConnected);
}

async function loadBadges() {
  const selectWithEmoji = 'id,name,description,question,answer,emoji,low_skill,theme';
  const selectFallback = 'id,name,description,question,answer,theme';

  const { data, error } = await safeSupabaseSelect(
    supabase,
    'badges',
    selectWithEmoji,
    selectFallback,
    (query) => query.order('id')
  );

  if (error) {
    setFormMsg(error.message || 'Erreur de chargement.', true);
    return;
  }
  
  // Afficher un message si on utilise le fallback (pas d'emoji)
  if (data && data.length > 0 && !data[0].emoji && selectWithEmoji.includes('emoji')) {
    setFormMsg('Colonne emoji absente, affichage sans emoji.', false);
  } else {
    setFormMsg('');
  }

  state.badges = data || [];
  renderBadges();
  renderGhostBadgesSelectOptions();
}

function renderGhostBadgesSelectOptions() {
  if (!els.ghostRequiredBadgesSelect) return;
  const selected = new Set(getGhostSelectedIds());
  els.ghostRequiredBadgesSelect.innerHTML = '';
  (state.badges || []).forEach(b => {
    const id = b?.id;
    if (id === undefined || id === null) return;
    const opt = document.createElement('option');
    opt.value = String(id);
    opt.textContent = `${b.emoji || ''} ${b.name || ''}`.trim() || String(id);
    opt.selected = selected.has(opt.value);
    els.ghostRequiredBadgesSelect.appendChild(opt);
  });
}

function getGhostSelectedIds() {
  if (!els.ghostRequiredBadgesSelect) return [];
  return Array.from(els.ghostRequiredBadgesSelect.selectedOptions || []).map(o => o.value).filter(Boolean);
}

function setGhostSelectedIds(ids) {
  if (!els.ghostRequiredBadgesSelect) return;
  const set = new Set((ids || []).map(String));
  Array.from(els.ghostRequiredBadgesSelect.options || []).forEach(o => {
    o.selected = set.has(String(o.value));
  });
}

// Fonction wrapper pour utiliser calculateSkillsTotals du module partagé
function calculateSkillsTotals() {
  return calculateSkillsTotalsShared(state.badges, (answer) => {
    if (typeof answer === 'string') {
      try { return JSON.parse(answer); } catch (_) { return null; }
    }
    return answer;
  });
}

function renderBadges() {
  els.badgeList.innerHTML = '';
  if (els.badgeTotal) {
    els.badgeTotal.textContent = `Total de badges : ${state.badges.length || 0}`;
  }
  
  // Calculer les totaux de skills
  const { totalSkills, totalLowSkills } = calculateSkillsTotals();
  if (els.skillsTotal) {
    els.skillsTotal.textContent = `Skills : ${totalSkills}`;
  }
  if (els.lowSkillsTotal) {
    els.lowSkillsTotal.textContent = `Low skills : ${totalLowSkills}`;
  }
  
  if (!state.badges.length) {
    els.badgeList.innerHTML = '<div class="muted">Aucun badge.</div>';
    return;
  }
  state.badges.forEach(b => {
    const row = document.createElement('div');
    row.className = 'table-row clickable';
    row.innerHTML = `
      <span>${b.emoji || ''}</span>
      <span>${b.name || ''}</span>
      <span class="muted text-small">${getLevelSummary(b.answer, Boolean(b.low_skill))}</span>
    `;
    row.addEventListener('click', () => fillForm(b));
    els.badgeList.appendChild(row);
  });
}

// calculateMaxSkillPoints est maintenant importé du module badgeCalculations.js

function getLevelSummary(answer, isLowSkill = false) {
  if (!answer) {
    const maxSkill = calculateMaxSkillPoints(null, isLowSkill);
    return `Aucun · ${isLowSkill ? 'low ' : ''}skills: ${maxSkill}`;
  }
  const parsed = parseBadgeAnswer(answer);
  const maxSkill = calculateMaxSkillPoints(parsed, isLowSkill);
  const skillText = `${isLowSkill ? 'low ' : ''}skills: ${maxSkill}`;
  
  if (!parsed || typeof parsed !== 'object' || !parsed.type) {
    return `1 skill (sans niveau) · ${skillText}`;
  }
  
  // Badge fantôme
  if (parsed.isGhost === true) {
    return `Badge fantôme · ${skillText}`;
  }
  
  // Badge range (numérotation)
  if (parsed.type === 'range' && Array.isArray(parsed.levels)) {
    const levels = parsed.levels;
    if (!levels.length) return `Numérotation · ${skillText}`;
    const hasMystery = levels.some(l => isMysteryLevel(l.label));
    const top = pickHighestLevel(levels, 'max');
    const topLabel = top?.label || '—';
    if (hasMystery) {
      return `Numérotation (Expert) · ${skillText}`;
    }
    return `Numérotation (${topLabel}) · ${skillText}`;
  }
  
  // Badge multiSelect
  if (parsed.type === 'multiSelect') {
    // Vérifier si mode "skills par option"
    if (parsed.multiSkillMode === 'option' && parsed.optionSkills && typeof parsed.optionSkills === 'object') {
      const hasExpert = Object.values(parsed.optionSkills).some(v => {
        const label = String(v || '').trim();
        return isMysteryLevel(label);
      });
      if (hasExpert) {
        return `Multi-sélection (Expert) · ${skillText}`;
      }
      return `Multi-sélection (Par option) · ${skillText}`;
    }
    
    // Mode classique (par nombre de coches)
    if (Array.isArray(parsed.levels)) {
      const levels = parsed.levels;
      if (!levels.length) return `Multi-sélection · ${skillText}`;
      const hasMystery = levels.some(l => isMysteryLevel(l.label));
      const top = pickHighestLevel(levels, 'min');
      const topLabel = top?.label || '—';
      if (hasMystery) {
        return `Multi-sélection (Expert) · ${skillText}`;
      }
      return `Multi-sélection (${topLabel}) · ${skillText}`;
    }
    return `Multi-sélection · ${skillText}`;
  }
  
  // Badge singleSelect
  if (parsed.type === 'singleSelect') {
    const levels = Array.isArray(parsed.levels) ? parsed.levels : [];
    if (!levels.length) {
      // Vérifier si skills par option
      if (parsed.optionSkills && typeof parsed.optionSkills === 'object') {
        const hasExpert = Object.values(parsed.optionSkills).some(v => {
          const label = String(v || '').trim();
          return isMysteryLevel(label);
        });
        if (hasExpert) {
          return `Sélection unique (Expert) · ${skillText}`;
        }
        return `Sélection unique (Par option) · ${skillText}`;
      }
      return `Sélection unique · ${skillText}`;
    }
    const hasMystery = levels.some(l => isMysteryLevel(l.label));
    const topLabel = levels[levels.length - 1]?.label || '—';
    if (hasMystery) {
      return `Sélection unique (Expert) · ${skillText}`;
    }
    return `Sélection unique (${topLabel}) · ${skillText}`;
  }
  
  // Badge boolean
  if (parsed.type === 'boolean') {
    if (typeof parsed.skillPoints === 'number' && parsed.skillPoints > 0) {
      return `Oui/Non (${parsed.skillPoints} skill${parsed.skillPoints > 1 ? 's' : ''} si "oui") · ${skillText}`;
    }
    return `Oui/Non · ${skillText}`;
  }
  
  // Badge text simple
  if (parsed.type === 'text') {
    return `Texte · ${skillText}`;
  }
  
  return `Aucun · ${skillText}`;
}

// isMysteryLevel est maintenant importé du module badgeCalculations.js

// pickHighestLevel est maintenant importé du module badgeCalculations.js

function fillForm(b) {
  els.id.value = b.id ?? '';
  els.name.value = b.name ?? '';
  els.emoji.value = b.emoji ?? '';
  if (els.theme) els.theme.value = b.theme ?? '';
  els.q.value = b.question ?? '';
  setLowSkillState(Boolean(b.low_skill));
  if (els.displayPrefix) els.displayPrefix.value = '';
  els.displaySuffix.value = '';
  if (els.blockedMessage) els.blockedMessage.value = '';
  if (els.boolDisplayText) els.boolDisplayText.value = '';
  if (els.boolDisplayTextFalse) els.boolDisplayTextFalse.value = '';
  setMultiDisplayListState(false);
  setMultiSkillByOptionState(false);
  if (els.multiOptionSkills) els.multiOptionSkills.value = '';
  if (els.singleSkills) els.singleSkills.value = '';
  // Parse answer
  const parsed = parseBadgeAnswer(b.answer);
  
  // Charger les informations de badge fantôme
  const isGhost = parsed?.isGhost === true;
  setGhostState(isGhost);
  if (isGhost && parsed?.requiredBadges) {
    const req = Array.isArray(parsed.requiredBadges) ? parsed.requiredBadges : [];
    renderGhostBadgesSelectOptions();
    setGhostSelectedIds(req);
  } else {
    renderGhostBadgesSelectOptions();
    setGhostSelectedIds([]);
  }
  if (els.ghostDisplayText) {
    els.ghostDisplayText.value = isGhost ? (parsed?.ghostDisplayText ?? '') : '';
  }
  // Charger skillPoints pour tous les types de badges fantômes
  if (els.ghostSkillPoints) {
    els.ghostSkillPoints.value = isGhost ? (parsed?.skillPoints ?? '') : '';
  }
  if (els.ghostPrereqMode) els.ghostPrereqMode.value = isGhost ? String(parsed?.prereqMode ?? 'all') : 'all';
  if (els.ghostMinBadges) els.ghostMinBadges.value = isGhost ? String(parsed?.minBadges ?? '') : '';
  if (els.ghostMinSkills) els.ghostMinSkills.value = isGhost ? String(parsed?.minSkills ?? '') : '';
  if (els.ghostMinRank) els.ghostMinRank.value = isGhost ? String(parsed?.minRank ?? '') : '';
  
  if (!parsed || typeof parsed !== 'object' || !parsed.type) {
    // Réponse texte simple
    els.answerType.value = 'text';
    showBlock('text');
    els.answerText.value = b.answer ?? '';
    return;
  }
  if (els.displayPrefix) els.displayPrefix.value = parsed.displayPrefix ?? '';
  // Ancien displaySuffix: on continue de le lire pour compat
  els.displaySuffix.value = parsed.displaySuffix ?? '';
  // Charger le message personnalisé si non débloqué
  if (els.blockedMessage) els.blockedMessage.value = parsed.blockedMessage ?? '';
  const type = parsed.type;
  els.answerType.value = type;
  showBlock(type);
  if (type === 'boolean') {
    if (els.boolDisplayText) els.boolDisplayText.value = parsed.booleanDisplayText ?? '';
    if (els.boolDisplayTextFalse) els.boolDisplayTextFalse.value = parsed.booleanDisplayTextFalse ?? '';
    // Si c'est un badge fantôme, utiliser ghostSkillPoints, sinon boolSkillPoints
    if (isGhost) {
      // ghostSkillPoints est déjà chargé plus haut pour tous les types
      if (els.boolSkillPoints) els.boolSkillPoints.value = '';
    } else {
      if (els.boolSkillPoints) els.boolSkillPoints.value = parsed.skillPoints ?? '';
    }
  } else if (type === 'range') {
    const lines = (parsed.levels || []).map(l => `${l.label || ''}|${l.min ?? ''}|${l.max ?? ''}${l.points ? `|${l.points}` : ''}`).join('\n');
    els.rangeLevels.value = lines;
  } else if (type === 'multiSelect') {
    const optLines = (parsed.options || []).map(o => `${o.value || ''}|${o.label || ''}`).join('\n');
    const lvlLines = (parsed.levels || []).map(l => `${l.label || ''}|${l.min ?? ''}${l.points ? `|${l.points}` : ''}`).join('\n');
    els.multiOptions.value = optLines;
    els.multiLevels.value = lvlLines;
    setMultiDisplayListState(parsed.multiDisplayMode === 'list');
    setMultiSkillByOptionState(parsed.multiSkillMode === 'option');
    if (els.multiOptionSkills) {
      const entries = parsed.optionSkills && typeof parsed.optionSkills === 'object' ? Object.entries(parsed.optionSkills) : [];
      // Vérifier si des points sont stockés dans les levels
      const levelsMap = new Map();
      if (Array.isArray(parsed.levels)) {
        parsed.levels.forEach(level => {
          if (level.label && typeof level.points === 'number' && level.points > 0) {
            levelsMap.set(level.label, level.points);
          }
        });
      }
      els.multiOptionSkills.value = entries.map(([val, skillLabel]) => {
        const points = levelsMap.get(skillLabel);
        return points ? `${val}|${skillLabel}|${points}` : `${val}|${skillLabel}`;
      }).join('\n');
    }
  } else if (type === 'singleSelect') {
    const optLines = (parsed.options || []).map(o => `${o.value || ''}|${o.label || ''}`).join('\n');
    if (els.singleOptions) els.singleOptions.value = optLines;
    if (els.singleSkills) {
      const entries = parsed.optionSkills && typeof parsed.optionSkills === 'object' ? Object.entries(parsed.optionSkills) : [];
      // Vérifier si des points sont stockés dans les levels
      const levelsMap = new Map();
      if (Array.isArray(parsed.levels)) {
        parsed.levels.forEach(level => {
          if (level.label && typeof level.points === 'number' && level.points > 0) {
            levelsMap.set(level.label, level.points);
          }
        });
      }
      els.singleSkills.value = entries.map(([val, skillLabel]) => {
        const points = levelsMap.get(skillLabel);
        return points ? `${val}|${skillLabel}|${points}` : `${val}|${skillLabel}`;
      }).join('\n');
    }
  } else {
    // fallback texte
    els.answerText.value = b.answer ?? '';
  }
}

function buildPayloadFromForm() {
  const idVal = Number(els.id.value);
  const payload = {
    name: els.name.value.trim(),
    description: '', // Champ description supprimé
    theme: (els.theme?.value || '').trim() || null,
    question: els.q.value.trim(),
    emoji: els.emoji.value.trim(),
    low_skill: Boolean(Number(els.lowSkillHidden?.value || '0')),
  };
  const rawId = els.id.value.trim();
  // On accepte soit un nombre (auto-incr.), soit un texte (UUID).
  if (rawId) {
    const numeric = Number(rawId);
    payload.id = Number.isNaN(numeric) ? rawId : numeric;
  }

  const type = els.answerType.value;
  const displayPrefix = (els.displayPrefix?.value || '').trim();
  const displaySuffix = (els.displaySuffix?.value || '').trim();
  const blockedMessage = (els.blockedMessage?.value || '').trim();
  const multiDisplayMode = Boolean(Number(els.multiDisplayListHidden?.value || '0')) ? 'list' : 'count';
  const isGhost = Boolean(Number(els.ghostHidden?.value || '0'));
  const requiredBadges = isGhost 
    ? getGhostSelectedIds().filter(Boolean)
    : [];
  const ghostDisplayText = isGhost ? (els.ghostDisplayText?.value || '').trim() : '';
  const ghostSkillPoints = isGhost ? (els.ghostSkillPoints?.value || '').trim() : '';
  const minBadges = isGhost ? Number(els.ghostMinBadges?.value || 0) : 0;
  const minSkills = isGhost ? Number(els.ghostMinSkills?.value || 0) : 0;
  const minRank = isGhost ? String(els.ghostMinRank?.value || '') : '';
  const prereqMode = isGhost ? String(els.ghostPrereqMode?.value || 'all') : 'all';

  // Fonction helper pour ajouter les propriétés fantômes si nécessaire
  const addGhostProps = (obj) => {
    const hasAnyPrereq =
      (requiredBadges.length > 0) ||
      (Number.isFinite(minBadges) && minBadges > 0) ||
      (Number.isFinite(minSkills) && minSkills > 0) ||
      (minRank && minRank.trim().length > 0);

    if (isGhost && hasAnyPrereq) {
      obj.isGhost = true;
      obj.requiredBadges = requiredBadges;
      if (ghostDisplayText) obj.ghostDisplayText = ghostDisplayText;
      if (prereqMode === 'any') obj.prereqMode = 'any';
      if (Number.isFinite(minBadges) && minBadges > 0) obj.minBadges = minBadges;
      if (Number.isFinite(minSkills) && minSkills > 0) obj.minSkills = minSkills;
      if (minRank && minRank.trim().length > 0) obj.minRank = minRank.trim();
      // Ajouter skillPoints pour tous les types de badges fantômes
      if (ghostSkillPoints) {
        const points = parseInt(ghostSkillPoints, 10);
        if (!isNaN(points) && points > 0) {
          obj.skillPoints = points;
        }
      }
    }
    return obj;
  };

  // Si c'est un badge fantôme, la question n'est pas utilisée (on la garde non vide pour éviter des contraintes DB)
  if (isGhost && !payload.question) {
    payload.question = 'Badge fantôme';
  }

  if (type === 'text') {
    if (isGhost && requiredBadges.length > 0) {
      payload.answer = JSON.stringify({
        type: 'text',
        answer: els.answerText.value.trim(),
        isGhost: true,
        requiredBadges,
        ...(ghostDisplayText ? { ghostDisplayText } : {}),
        ...(displayPrefix ? { displayPrefix } : {}),
        ...(displaySuffix ? { displaySuffix } : {}),
        ...(blockedMessage ? { blockedMessage } : {}),
      });
    } else if (blockedMessage) {
      // Badge texte normal avec message personnalisé
      payload.answer = JSON.stringify({
        type: 'text',
        answer: els.answerText.value.trim(),
        blockedMessage,
      });
    } else {
      payload.answer = els.answerText.value.trim();
    }
    return payload;
  }

  if (type === 'boolean') {
    const boolPayload = {
      type: 'boolean',
      // L'utilisateur choisit via boutons Oui / Non dans l'app
      trueLabels: ['oui'],
      falseLabels: ['non'],
      // Par défaut, on débloque si l'utilisateur répond "oui"
      expected: true,
      ...(els.boolDisplayText?.value?.trim() ? { booleanDisplayText: els.boolDisplayText.value.trim() } : {}),
      ...(els.boolDisplayTextFalse?.value?.trim() ? { booleanDisplayTextFalse: els.boolDisplayTextFalse.value.trim() } : {}),
      ...(blockedMessage ? { blockedMessage } : {}),
    };
    // Ajouter skillPoints seulement si le champ est rempli (pour badges normaux ou fantômes)
    const skillPointsValue = isGhost ? ghostSkillPoints : (els.boolSkillPoints?.value?.trim() || '');
    if (skillPointsValue) {
      const points = parseInt(skillPointsValue, 10);
      if (!isNaN(points) && points > 0) {
        boolPayload.skillPoints = points;
      }
    }
    payload.answer = JSON.stringify(addGhostProps(boolPayload));
    return payload;
  }

  if (type === 'range') {
    const levels = parseRangeLevels(els.rangeLevels.value);
    payload.answer = JSON.stringify(addGhostProps({
      type: 'range',
      levels,
      ...(displayPrefix ? { displayPrefix } : {}),
      ...(displaySuffix ? { displaySuffix } : {}),
      ...(blockedMessage ? { blockedMessage } : {}),
    }));
    return payload;
  }

  if (type === 'multiSelect') {
    const options = parseOptions(els.multiOptions.value);
    const multiSkillMode = Boolean(Number(els.multiSkillByOptionHidden?.value || '0')) ? 'option' : 'count';
    // On garde toujours optionSkills: même si "skills par option" est désactivé,
    // on peut s'en servir pour le mot-clé "bloquer".
    const optionSkillsData = parseSingleSkills(els.multiOptionSkills?.value || '');
    const optionSkills = optionSkillsData?.skills || optionSkillsData;
    // En mode "option", on génère automatiquement la liste de niveaux à partir des skills
    const levels = (multiSkillMode === 'option') ? uniqueSkillLevelsFromOptionSkills(optionSkillsData) : parseMultiLevels(els.multiLevels.value);
    payload.answer = JSON.stringify(addGhostProps({
      type: 'multiSelect',
      options,
      levels,
      multiSkillMode,
      ...(optionSkills ? { optionSkills } : {}),
      multiDisplayMode,
      ...(displayPrefix ? { displayPrefix } : {}),
      ...(displaySuffix ? { displaySuffix } : {}),
      ...(blockedMessage ? { blockedMessage } : {}),
    }));
    return payload;
  }

  if (type === 'singleSelect') {
    const options = parseOptions(els.singleOptions?.value || '');
    const optionSkillsData = parseSingleSkills(els.singleSkills?.value || '');
    const optionSkills = optionSkillsData?.skills || optionSkillsData;
    const levels = uniqueSkillLevelsFromOptionSkills(optionSkillsData);
    payload.answer = JSON.stringify(addGhostProps({
      type: 'singleSelect',
      options,
      optionSkills,
      levels,
      ...(displayPrefix ? { displayPrefix } : {}),
      ...(displaySuffix ? { displaySuffix } : {}),
      ...(blockedMessage ? { blockedMessage } : {}),
    }));
    return payload;
  }

  payload.answer = '';
  return payload;
}

function parseRangeLevels(text) {
  return text.split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map((line, index) => {
      const parts = line.split('|');
      const [label = '', min = '', max = '', points = ''] = parts;
      const parsed = {
        label: label.trim(),
        min: Number(min),
        max: Number(max),
      };
      // Si points est spécifié et valide, l'utiliser, sinon utiliser position+1
      // Permettre points = 0 pour le niveau 0 (badge bloqué)
      const pointsNum = points.trim() ? Number(points.trim()) : null;
      const isLevel0 = parsed.label.toLowerCase() === 'niv 0' || parsed.label.toLowerCase() === 'skill 0' || parsed.label.toLowerCase() === 'niveau 0';
      if (!Number.isNaN(pointsNum) && (pointsNum > 0 || (pointsNum === 0 && isLevel0))) {
        parsed.points = pointsNum;
      }
      return parsed;
    })
    .filter(l => l.label && !Number.isNaN(l.min) && !Number.isNaN(l.max));
}

function parseOptions(text) {
  return text.split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(line => {
      const [value = '', label = ''] = line.split('|');
      return { value: value.trim(), label: label.trim() || value.trim() };
    })
    .filter(o => o.value);
}

function parseMultiLevels(text) {
  return text.split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map((line, index) => {
      const parts = line.split('|');
      const [label = '', min = '', points = ''] = parts;
      const parsed = {
        label: label.trim(),
        min: Number(min),
      };
      // Si points est spécifié et valide, l'utiliser, sinon utiliser position+1
      // Permettre points = 0 pour le niveau 0 (badge bloqué)
      const pointsNum = points.trim() ? Number(points.trim()) : null;
      const isLevel0 = parsed.label.toLowerCase() === 'niv 0' || parsed.label.toLowerCase() === 'skill 0' || parsed.label.toLowerCase() === 'niveau 0';
      if (!Number.isNaN(pointsNum) && (pointsNum > 0 || (pointsNum === 0 && isLevel0))) {
        parsed.points = pointsNum;
      }
      return parsed;
    })
    .filter(l => l.label && !Number.isNaN(l.min));
}

function parseSingleSkills(text) {
  // Format: valeur|Skill 1|points (points optionnel)
  const map = {};
  const pointsMap = {}; // Stocke les points par skill label
  text.split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .forEach(line => {
      const parts = line.split('|');
      const [value = '', skill = '', points = ''] = parts;
      const v = value.trim();
      const sRaw = skill.trim();
      if (!v) return;
      // "bloquer" => cette option bloque le déblocage du badge
      const sLower = sRaw.toLowerCase();
      if (sLower === 'bloquer') {
        map[v] = 'bloquer';
        return;
      }
      // "aucun"/"none"/vide => pas de skill pour cette option (mais on le stocke pour vérifier)
      if (!sRaw || sLower === 'aucun' || sLower === 'none' || sLower === 'no' || sLower === '0' || sLower === '-') {
        map[v] = 'aucun';
        return;
      }
      map[v] = sRaw;
      // Si des points sont spécifiés, les stocker
      // Permettre points = 0 pour le niveau 0 (badge bloqué)
      if (points.trim()) {
        const pointsNum = parseInt(points.trim(), 10);
        const isLevel0 = sRaw.toLowerCase() === 'niv 0' || sRaw.toLowerCase() === 'skill 0' || sRaw.toLowerCase() === 'niveau 0';
        if (!isNaN(pointsNum) && (pointsNum > 0 || (pointsNum === 0 && isLevel0))) {
          pointsMap[sRaw] = pointsNum;
        }
      }
    });
  // Retourner un objet avec les skills et les points
  return { skills: map, points: pointsMap };
}

function uniqueSkillLevelsFromOptionSkills(optionSkillsData) {
  // optionSkillsData peut être soit un objet { skills, points }, soit un objet simple (ancien format)
  const optionSkills = optionSkillsData?.skills || optionSkillsData;
  const pointsMap = optionSkillsData?.points || {};
  
  const labels = [];
  const seen = new Set();
  if (!optionSkills || typeof optionSkills !== 'object') return [];
  Object.values(optionSkills).forEach(label => {
    const l = (label ?? '').toString().trim();
    if (!l || seen.has(l) || l.toLowerCase() === 'bloquer' || l.toLowerCase() === 'aucun') return;
    seen.add(l);
    labels.push(l);
  });
  // Trier pour que les points soient cohérents:
  // niv 0, Skill 1, Skill 2, Skill 3... puis "Skill mystère" à la fin.
  labels.sort((a, b) => {
    const am = isMysteryLevel(a) ? 2 : 0;
    const bm = isMysteryLevel(b) ? 2 : 0;
    if (am !== bm) return am - bm; // non-mystère d'abord, puis mystère à la fin
    const an = extractSkillNumber(a);
    const bn = extractSkillNumber(b);
    // Vérifier si c'est le niveau 0
    const aIsZero = a.toLowerCase() === 'niv 0' || a.toLowerCase() === 'skill 0' || a.toLowerCase() === 'niveau 0';
    const bIsZero = b.toLowerCase() === 'niv 0' || b.toLowerCase() === 'skill 0' || b.toLowerCase() === 'niveau 0';
    if (aIsZero && !bIsZero) return -1; // niv 0 en premier
    if (!aIsZero && bIsZero) return 1;
    if (an !== null && bn !== null) return an - bn;
    if (an !== null) return -1;
    if (bn !== null) return 1;
    return a.localeCompare(b);
  });
  // Créer les levels avec les points si disponibles
  return labels.map((label, index) => {
    const level = { label };
    // Si des points sont définis pour ce label, les utiliser
    // Permettre points = 0 pour le niveau 0 (badge bloqué)
    const isLevel0 = label.toLowerCase() === 'niv 0' || label.toLowerCase() === 'skill 0' || label.toLowerCase() === 'niveau 0';
    if (typeof pointsMap[label] === 'number' && (pointsMap[label] > 0 || (pointsMap[label] === 0 && isLevel0))) {
      level.points = pointsMap[label];
    }
    return level;
  });
}

// extractSkillNumber est maintenant importé du module badgeCalculations.js

function splitCsv(val) {
  return val.split(',').map(s => s.trim()).filter(Boolean);
}

function showBlock(type) {
  Object.keys(els.blocks).forEach(key => {
    els.blocks[key].classList.toggle('hidden', key !== type);
  });
  // Pour le type Oui/Non: on cache template + suffixe (ils n’ont plus de sens)
  const isBoolean = type === 'boolean';
  const nonBooleanEls = Array.from(document.querySelectorAll('.non-boolean-only'));
  nonBooleanEls.forEach(el => el.classList.toggle('hidden', isBoolean));
}

function resetForm() {
  els.badgeForm.reset();
  els.answerType.value = 'text';
  showBlock('text');
  els.formMsg.textContent = '';
  setLowSkillState(false);
  setGhostState(false);
  renderGhostBadgesSelectOptions();
  setGhostSelectedIds([]);
  if (els.ghostDisplayText) els.ghostDisplayText.value = '';
  if (els.ghostSkillPoints) els.ghostSkillPoints.value = '';
  if (els.ghostPrereqMode) els.ghostPrereqMode.value = 'all';
  if (els.ghostMinBadges) els.ghostMinBadges.value = '';
  if (els.ghostMinSkills) els.ghostMinSkills.value = '';
  if (els.ghostMinRank) els.ghostMinRank.value = '';
  setMultiDisplayListState(false);
  setMultiSkillByOptionState(false);
  if (els.multiOptionSkills) els.multiOptionSkills.value = '';
  if (els.theme) els.theme.value = '';
  if (els.blockedMessage) els.blockedMessage.value = '';
}

function setMultiDisplayListState(isList) {
  if (els.multiDisplayListHidden) els.multiDisplayListHidden.value = isList ? '1' : '0';
  if (els.multiDisplayListToggle) {
    els.multiDisplayListToggle.textContent = isList ? 'Liste : activée' : 'Liste : désactivée';
    els.multiDisplayListToggle.classList.toggle('active', isList);
  }
}

function toggleMultiDisplayList() {
  const current = Boolean(Number(els.multiDisplayListHidden?.value || '0'));
  setMultiDisplayListState(!current);
}

function setMultiSkillByOptionState(enabled) {
  if (els.multiSkillByOptionHidden) els.multiSkillByOptionHidden.value = enabled ? '1' : '0';
  if (els.multiSkillByOptionToggle) {
    els.multiSkillByOptionToggle.textContent = enabled ? 'Skills par option : activé' : 'Skills par option : désactivé';
    els.multiSkillByOptionToggle.classList.toggle('active', enabled);
  }
  if (els.multiSkillByOptionBlock) {
    els.multiSkillByOptionBlock.classList.toggle('hidden', !enabled);
  }
  // Quand activé, les niveaux par nombre de coches ne servent plus
  if (els.multiLevels) {
    els.multiLevels.classList.toggle('hidden', enabled);
  }
}

function toggleMultiSkillByOption() {
  const current = Boolean(Number(els.multiSkillByOptionHidden?.value || '0'));
  setMultiSkillByOptionState(!current);
}

function setAuthMsg(msg, error = false) {
  els.loginMsg.textContent = msg || '';
  els.loginMsg.classList.toggle('error', error);
}

function setFormMsg(msg, error = false) {
  els.formMsg.textContent = msg || '';
  els.formMsg.classList.toggle('error', error);
}

function setLowSkillState(isLow) {
  if (els.lowSkillHidden) els.lowSkillHidden.value = isLow ? '1' : '0';
  if (els.lowSkillToggle) {
    els.lowSkillToggle.textContent = isLow ? 'Low skill : activé' : 'Low skill : désactivé';
    els.lowSkillToggle.classList.toggle('active', isLow);
  }
}

function toggleLowSkill() {
  const current = Boolean(Number(els.lowSkillHidden?.value || '0'));
  setLowSkillState(!current);
}

function setGhostState(isGhost) {
  if (els.ghostHidden) els.ghostHidden.value = isGhost ? '1' : '0';
  if (els.ghostToggle) {
    els.ghostToggle.textContent = isGhost ? 'Badge fantôme : activé' : 'Badge fantôme : désactivé';
    els.ghostToggle.classList.toggle('active', isGhost);
  }
  if (els.ghostBlock) {
    els.ghostBlock.classList.toggle('hidden', !isGhost);
  }
  // Cacher les champs "question/réponse" quand le badge est fantôme
  if (Array.isArray(els.nonGhostOnly) && els.nonGhostOnly.length) {
    els.nonGhostOnly.forEach(el => {
      el.classList.toggle('hidden', isGhost);
    });
  }
}

function toggleGhost() {
  const current = Boolean(Number(els.ghostHidden?.value || '0'));
  setGhostState(!current);
}

function bindTokensForm() {
  if (!els.tokensForm) return;
  
  els.tokensForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.session || !state.session.user) {
      setTokensMsg('Connecte-toi d\'abord.', true);
      return;
    }
    
    const amount = parseInt(els.tokensAmount.value, 10);
    if (isNaN(amount) || amount < 1) {
      setTokensMsg('Entre un nombre valide (minimum 1).', true);
      return;
    }
    
    setTokensMsg('Ajout des jetons...');
    
    // Récupérer le profil actuel pour connaître le nombre de jetons actuels
    const { data: profile, error: fetchError } = await supabase
      .from('profiles')
      .select('tokens')
      .eq('id', state.session.user.id)
      .single();
    
    if (fetchError) {
      console.error('Erreur lors de la récupération du profil:', fetchError);
      setTokensMsg('Erreur lors de la récupération du profil.', true);
      return;
    }
    
    const currentTokens = profile?.tokens || 0;
    const newTokens = currentTokens + amount;
    
    // Mettre à jour les jetons dans Supabase
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ tokens: newTokens })
      .eq('id', state.session.user.id);
    
    if (updateError) {
      console.error('Erreur lors de la mise à jour des jetons:', updateError);
      setTokensMsg('Erreur lors de l\'ajout des jetons.', true);
      return;
    }
    
    setTokensMsg(`✅ ${amount} jeton(s) ajouté(s) ! Tu as maintenant ${newTokens} jeton(s).`, false);
    els.tokensAmount.value = '10'; // Réinitialiser à 10
  });
}

function setTokensMsg(text, isError = false) {
  if (!els.tokensMessage) return;
  els.tokensMessage.textContent = text;
  els.tokensMessage.classList.toggle('error', isError);
  if (!isError) {
    setTimeout(() => {
      if (els.tokensMessage) els.tokensMessage.textContent = '';
    }, 5000);
  }
}

