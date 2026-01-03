// Module partagé pour les calculs de points de skills des badges
// Utilisé par app.js et admin.js pour éviter la duplication de code

/**
 * Vérifie si un label correspond à un niveau "mystère" ou "expert"
 * @param {string} label - Le label à vérifier
 * @returns {boolean} - true si c'est un niveau mystère/expert
 */
export function isMysteryLevel(label) {
  if (typeof label !== 'string') return false;
  const lower = label.toLowerCase();
  return lower.includes('mystère') || lower.includes('mystere') || lower.includes('secret') || lower.includes('expert');
}

/**
 * Trouve le niveau avec la valeur la plus élevée pour un champ donné
 * @param {Array} levels - Tableau des niveaux
 * @param {string} field - Champ à comparer ('min', 'max', etc.)
 * @returns {Object|null} - Le niveau avec la valeur la plus élevée
 */
export function pickHighestLevel(levels, field) {
  if (!Array.isArray(levels) || !levels.length) return null;
  let best = null;
  levels.forEach(l => {
    const val = Number(l?.[field]);
    if (Number.isNaN(val)) {
      if (!best) best = l;
      return;
    }
    if (!best) {
      best = l;
      return;
    }
    const bestVal = Number(best?.[field]);
    if (Number.isNaN(bestVal) || val >= bestVal) {
      best = l;
    }
  });
  return best;
}

/**
 * Extrait le numéro d'un label de skill (ex: "Skill 1" => 1)
 * @param {string} label - Le label à analyser
 * @returns {number|null} - Le numéro extrait ou null
 */
export function extractSkillNumber(label) {
  if (typeof label !== 'string') return null;
  const m = label.toLowerCase().match(/skill\s*(\d+)|niv\s*(\d+)|niveau\s*(\d+)/);
  if (!m) return null;
  const n = Number(m[1] || m[2] || m[3]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Calcule les points de skills pour un badge en fonction de sa configuration
 * @param {Object} parsed - Configuration parsée du badge (answer JSON)
 * @param {boolean} isLowSkill - Si le badge est un "low skill"
 * @param {boolean} isGhost - Si le badge est un badge fantôme
 * @returns {number} - Les points de skills (négatif si low skill)
 */
export function calculateSkillPointsForBadge(parsed, isLowSkill = false, isGhost = false) {
  let badgeSkill = 0;
  
  // Si c'est un badge fantôme avec skillPoints défini, l'utiliser directement
  if (isGhost && typeof parsed?.skillPoints === 'number' && parsed.skillPoints > 0) {
    badgeSkill = parsed.skillPoints;
  } else if (!parsed || typeof parsed !== 'object' || !parsed.type) {
    // Badge sans niveaux (text, boolean simple)
    badgeSkill = 1;
  } else if (parsed.type === 'boolean') {
    // Badge boolean : vérifier si skillPoints est défini
    if (typeof parsed.skillPoints === 'number' && parsed.skillPoints > 0) {
      badgeSkill = parsed.skillPoints;
    } else {
      badgeSkill = 1; // Comportement par défaut
    }
  } else if (parsed.type === 'range' && Array.isArray(parsed.levels) && parsed.levels.length > 0) {
    // Badge avec niveaux (range)
    const topLevel = pickHighestLevel(parsed.levels, 'max');
    if (topLevel) {
      const label = topLevel.label || '';
      if (isMysteryLevel(label)) {
        badgeSkill = 10; // Expert = 10 points
      } else {
        // Utiliser points personnalisé si disponible, sinon position+1
        if (typeof topLevel.points === 'number' && topLevel.points > 0) {
          badgeSkill = topLevel.points;
        } else {
          const pos = parsed.levels.findIndex(l => (l?.label || '').toLowerCase() === label.toLowerCase());
          badgeSkill = pos >= 0 ? pos + 1 : 1;
        }
      }
    } else {
      // Si aucun niveau trouvé, utiliser le nombre de niveaux ou 1
      badgeSkill = parsed.levels.length > 0 ? parsed.levels.length : 1;
    }
  } else if (parsed.type === 'multiSelect') {
    // Mode "skills par option"
    if (parsed.multiSkillMode === 'option' && parsed.optionSkills && typeof parsed.optionSkills === 'object') {
      let bestSkill = 0;
      Object.values(parsed.optionSkills).forEach(v => {
        const label = String(v || '').trim();
        if (!label || label.toLowerCase() === 'bloquer' || label.toLowerCase() === 'aucun') return;
        if (isMysteryLevel(label)) {
          bestSkill = 10;
        } else {
          // Trouver le niveau correspondant pour obtenir les points personnalisés
          if (Array.isArray(parsed.levels)) {
            const level = parsed.levels.find(l => (l?.label || '').toLowerCase() === label.toLowerCase());
            if (level) {
              // Utiliser points personnalisé si disponible, sinon position+1
              if (typeof level.points === 'number' && level.points > 0) {
                if (level.points > bestSkill) bestSkill = level.points;
              } else {
                const pos = parsed.levels.findIndex(l => (l?.label || '').toLowerCase() === label.toLowerCase());
                const skillValue = pos >= 0 ? pos + 1 : 1;
                if (skillValue > bestSkill) bestSkill = skillValue;
              }
            } else {
              bestSkill = Math.max(bestSkill, 1);
            }
          } else {
            bestSkill = Math.max(bestSkill, 1);
          }
        }
      });
      badgeSkill = bestSkill > 0 ? bestSkill : 1; // Au moins 1 point si aucune option valide
    } else if (Array.isArray(parsed.levels) && parsed.levels.length > 0) {
      // Mode classique (par nombre de coches)
      const topLevel = pickHighestLevel(parsed.levels, 'min');
      if (topLevel) {
        const label = topLevel.label || '';
        if (isMysteryLevel(label)) {
          badgeSkill = 10;
        } else {
          // Utiliser points personnalisé si disponible, sinon position+1
          if (typeof topLevel.points === 'number' && topLevel.points > 0) {
            badgeSkill = topLevel.points;
          } else {
            const pos = parsed.levels.findIndex(l => (l?.label || '').toLowerCase() === label.toLowerCase());
            badgeSkill = pos >= 0 ? pos + 1 : 1;
          }
        }
      } else {
        // Si aucun niveau trouvé, utiliser le nombre de niveaux ou 1
        badgeSkill = parsed.levels.length > 0 ? parsed.levels.length : 1;
      }
    } else {
      badgeSkill = 1; // Badge sans niveaux
    }
  } else if (parsed.type === 'singleSelect') {
    const levels = Array.isArray(parsed.levels) ? parsed.levels : [];
    if (levels.length > 0) {
      // Badge sélection unique avec niveaux
      const topLevel = levels[levels.length - 1];
      if (topLevel) {
        const label = topLevel.label || '';
        if (isMysteryLevel(label)) {
          badgeSkill = 10;
        } else {
          // Utiliser points personnalisé si disponible, sinon position+1
          if (typeof topLevel.points === 'number' && topLevel.points > 0) {
            badgeSkill = topLevel.points;
          } else {
            const pos = levels.findIndex(l => (l?.label || '').toLowerCase() === label.toLowerCase());
            badgeSkill = pos >= 0 ? pos + 1 : 1;
          }
        }
      } else {
        // Si aucun niveau trouvé, utiliser le nombre de niveaux ou 1
        badgeSkill = levels.length > 0 ? levels.length : 1;
      }
    } else if (parsed.optionSkills && typeof parsed.optionSkills === 'object') {
      // Skills par option
      let bestSkill = 0;
      Object.values(parsed.optionSkills).forEach(v => {
        const label = String(v || '').trim();
        if (!label || label.toLowerCase() === 'bloquer' || label.toLowerCase() === 'aucun') return;
        if (isMysteryLevel(label)) {
          bestSkill = 10;
        } else {
          bestSkill = Math.max(bestSkill, 1);
        }
      });
      badgeSkill = bestSkill > 0 ? bestSkill : 1; // Au moins 1 point si aucune option valide
    } else {
      badgeSkill = 1; // Badge sans niveaux
    }
  } else if (parsed.type === 'text') {
    // Badge text simple
    badgeSkill = 1;
  } else {
    // Badge sans niveaux ou type inconnu
    badgeSkill = 1;
  }
  
  // S'assurer que badgeSkill n'est jamais 0
  if (badgeSkill === 0) {
    badgeSkill = 1;
  }
  
  return badgeSkill;
}

/**
 * Calcule le maximum de points de skills pour un badge (utilisé dans l'admin)
 * @param {Object} parsed - Configuration parsée du badge
 * @param {boolean} isLowSkill - Si le badge est un "low skill"
 * @returns {number} - Les points maximum (négatif si low skill)
 */
export function calculateMaxSkillPoints(parsed, isLowSkill = false) {
  if (!parsed || typeof parsed !== 'object' || !parsed.type) {
    // Badge sans niveaux (text, boolean simple)
    return isLowSkill ? -1 : 1;
  }
  
  const isGhost = parsed?.isGhost === true;
  const maxSkill = calculateSkillPointsForBadge(parsed, false, isGhost);
  
  // Appliquer le multiplicateur low skill (x2 en négatif)
  if (isLowSkill) {
    return -Math.abs(maxSkill) * 2;
  }
  return maxSkill;
}

/**
 * Calcule les totaux de skills pour une liste de badges (utilisé dans l'admin)
 * @param {Array} badges - Liste des badges
 * @param {Function} parseBadgeAnswer - Fonction pour parser la réponse du badge (optionnel, utilise JSON.parse par défaut)
 * @returns {Object} - { totalSkills, totalLowSkills }
 */
export function calculateSkillsTotals(badges, parseBadgeAnswer = null) {
  let totalSkills = 0;
  let totalLowSkills = 0;
  
  // Fonction par défaut pour parser
  const parseAnswer = parseBadgeAnswer || ((answer) => {
    if (typeof answer === 'string') {
      try { return JSON.parse(answer); } catch (_) { return null; }
    }
    return answer;
  });
  
  badges.forEach(badge => {
    // Parser la réponse du badge
    const parsed = parseAnswer(badge.answer);
    // Les badges fantômes sont maintenant inclus dans le calcul
    const isGhost = parsed?.isGhost === true;
    const isLowSkill = Boolean(badge.low_skill);
    const badgeSkill = calculateSkillPointsForBadge(parsed, false, isGhost);
    
    if (isLowSkill) {
      totalLowSkills += Math.abs(badgeSkill) * 2; // Low skills = valeur x2 en négatif
    } else {
      totalSkills += badgeSkill;
    }
  });
  
  return { totalSkills, totalLowSkills };
}

