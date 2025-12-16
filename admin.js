// Admin badges - gestion CRUD via Supabase
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const state = {
  session: null,
  badges: [],
};

const els = {};

function pseudoToEmail(pseudo) {
  if (!pseudo) return '';
  const cleaned = pseudo
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '');
  return `${cleaned || 'user'}@badgelife.dev`;
}

document.addEventListener('DOMContentLoaded', async () => {
  cacheEls();
  bindAuth();
  bindForm();
  await bootstrapSession();
});

function cacheEls() {
  els.authCard = document.getElementById('admin-auth-card');
  els.app = document.getElementById('admin-app');
  els.loginForm = document.getElementById('admin-login-form');
  els.loginMsg = document.getElementById('admin-message');
  els.logoutBtn = document.getElementById('admin-logout');
  els.badgeList = document.getElementById('badge-list');
  els.badgeForm = document.getElementById('badge-form');
  els.formMsg = document.getElementById('form-message');
  els.id = document.getElementById('badge-id');
  els.name = document.getElementById('badge-name');
  els.emoji = document.getElementById('badge-emoji');
  els.desc = document.getElementById('badge-description');
  els.q = document.getElementById('badge-question');
  els.answerType = document.getElementById('answer-type');
  els.answerText = document.getElementById('answer-text');
  els.boolTrue = document.getElementById('bool-true');
  els.boolFalse = document.getElementById('bool-false');
  els.boolExpected = document.getElementById('bool-expected');
  els.rangeLevels = document.getElementById('range-levels');
  els.multiOptions = document.getElementById('multi-options');
  els.multiLevels = document.getElementById('multi-levels');
  els.displayTemplate = document.getElementById('display-template');
  els.displaySuffix = document.getElementById('display-suffix');
  els.btnDelete = document.getElementById('btn-delete');
  els.btnReset = document.getElementById('btn-reset');
  els.blocks = {
    text: document.getElementById('block-text'),
    boolean: document.getElementById('block-boolean'),
    range: document.getElementById('block-range'),
    multiSelect: document.getElementById('block-multi'),
  };
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

  els.badgeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = buildPayloadFromForm();
    if (!payload.name) return setFormMsg('Nom requis.', true);
    if (!payload.question) return setFormMsg('Question requise.', true);
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
    const id = Number(els.id.value);
    if (!id) return setFormMsg('ID requis pour supprimer.', true);
    setFormMsg('Suppression...');
    const { error } = await supabase.from('badges').delete().eq('id', id);
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
  const selectWithEmoji = 'id,name,description,question,answer,emoji';
  const selectFallback = 'id,name,description,question,answer';

  let { data, error } = await supabase.from('badges').select(selectWithEmoji).order('id');

  if (error) {
    console.warn('Colonne emoji absente ? On retente sans emoji.', error);
    const retry = await supabase.from('badges').select(selectFallback).order('id');
    if (retry.error) {
      setFormMsg(retry.error.message || 'Erreur de chargement.', true);
      return;
    }
    data = retry.data;
    setFormMsg('Colonne emoji absente, affichage sans emoji.', true);
  } else {
    setFormMsg('');
  }

  state.badges = data || [];
  renderBadges();
}

function renderBadges() {
  els.badgeList.innerHTML = '';
  if (!state.badges.length) {
    els.badgeList.innerHTML = '<div class="muted">Aucun badge.</div>';
    return;
  }
  state.badges.forEach(b => {
    const row = document.createElement('div');
    row.className = 'table-row clickable';
    row.innerHTML = `
      <span>${b.id ?? '—'}</span>
      <span>${b.name || ''}</span>
      <span>${b.emoji || ''}</span>
    `;
    row.addEventListener('click', () => fillForm(b));
    els.badgeList.appendChild(row);
  });
}

function fillForm(b) {
  els.id.value = b.id ?? '';
  els.name.value = b.name ?? '';
  els.emoji.value = b.emoji ?? '';
  els.desc.value = b.description ?? '';
  els.q.value = b.question ?? '';
  els.displayTemplate.value = '';
  els.displaySuffix.value = '';
  // Parse answer
  let parsed = null;
  if (typeof b.answer === 'string') {
    try { parsed = JSON.parse(b.answer); } catch (_) { parsed = null; }
  }
  if (!parsed || typeof parsed !== 'object' || !parsed.type) {
    // Réponse texte simple
    els.answerType.value = 'text';
    showBlock('text');
    els.answerText.value = b.answer ?? '';
    return;
  }
  els.displayTemplate.value = parsed.displayTemplate ?? '';
  els.displaySuffix.value = parsed.displaySuffix ?? '';
  const type = parsed.type;
  els.answerType.value = type;
  showBlock(type);
  if (type === 'boolean') {
    els.boolTrue.value = (parsed.trueLabels || []).join(',');
    els.boolFalse.value = (parsed.falseLabels || []).join(',');
    els.boolExpected.value = parsed.expected === false ? 'false' : 'true';
  } else if (type === 'range') {
    const lines = (parsed.levels || []).map(l => `${l.label || ''}|${l.min ?? ''}|${l.max ?? ''}`).join('\n');
    els.rangeLevels.value = lines;
  } else if (type === 'multiSelect') {
    const optLines = (parsed.options || []).map(o => `${o.value || ''}|${o.label || ''}`).join('\n');
    const lvlLines = (parsed.levels || []).map(l => `${l.label || ''}|${l.min ?? ''}`).join('\n');
    els.multiOptions.value = optLines;
    els.multiLevels.value = lvlLines;
  } else {
    // fallback texte
    els.answerText.value = b.answer ?? '';
  }
}

function buildPayloadFromForm() {
  const idVal = Number(els.id.value);
  const payload = {
    name: els.name.value.trim(),
    description: els.desc.value.trim(),
    question: els.q.value.trim(),
    emoji: els.emoji.value.trim(),
  };
  if (!Number.isNaN(idVal) && els.id.value.trim()) payload.id = idVal;

  const type = els.answerType.value;
  const displayTemplate = els.displayTemplate.value.trim();
  const displaySuffix = els.displaySuffix.value.trim();

  if (type === 'text') {
    payload.answer = els.answerText.value.trim();
    return payload;
  }

  if (type === 'boolean') {
    const trueLabels = splitCsv(els.boolTrue.value);
    const falseLabels = splitCsv(els.boolFalse.value);
    const expected = els.boolExpected.value === 'true';
    payload.answer = JSON.stringify({
      type: 'boolean',
      trueLabels,
      falseLabels,
      expected,
      ...(displayTemplate ? { displayTemplate } : {}),
      ...(displaySuffix ? { displaySuffix } : {}),
    });
    return payload;
  }

  if (type === 'range') {
    const levels = parseRangeLevels(els.rangeLevels.value);
    payload.answer = JSON.stringify({
      type: 'range',
      levels,
      ...(displayTemplate ? { displayTemplate } : {}),
      ...(displaySuffix ? { displaySuffix } : {}),
    });
    return payload;
  }

  if (type === 'multiSelect') {
    const options = parseOptions(els.multiOptions.value);
    const levels = parseMultiLevels(els.multiLevels.value);
    payload.answer = JSON.stringify({
      type: 'multiSelect',
      options,
      levels,
      ...(displayTemplate ? { displayTemplate } : {}),
      ...(displaySuffix ? { displaySuffix } : {}),
    });
    return payload;
  }

  payload.answer = '';
  return payload;
}

function parseRangeLevels(text) {
  return text.split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(line => {
      const [label = '', min = '', max = ''] = line.split('|');
      return { label: label.trim(), min: Number(min), max: Number(max) };
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
    .map(line => {
      const [label = '', min = ''] = line.split('|');
      return { label: label.trim(), min: Number(min) };
    })
    .filter(l => l.label && !Number.isNaN(l.min));
}

function splitCsv(val) {
  return val.split(',').map(s => s.trim()).filter(Boolean);
}

function showBlock(type) {
  Object.keys(els.blocks).forEach(key => {
    els.blocks[key].classList.toggle('hidden', key !== type);
  });
}

function resetForm() {
  els.badgeForm.reset();
  els.answerType.value = 'text';
  showBlock('text');
  els.formMsg.textContent = '';
}

function setAuthMsg(msg, error = false) {
  els.loginMsg.textContent = msg || '';
  els.loginMsg.classList.toggle('error', error);
}

function setFormMsg(msg, error = false) {
  els.formMsg.textContent = msg || '';
  els.formMsg.classList.toggle('error', error);
}

