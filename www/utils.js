// Fonctions utilitaires partagées
import { ADMIN_USER_IDS } from './config.js';

/**
 * Convertit un pseudo en email (alias factice mais valide pour Supabase Auth)
 * @param {string} pseudo - Le pseudo de l'utilisateur
 * @returns {string} - Email généré à partir du pseudo
 */
export function pseudoToEmail(pseudo) {
  if (!pseudo || typeof pseudo !== 'string') return 'user@badgelife.dev';
  const cleaned = pseudo
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._-]/g, '');
  return `${cleaned || 'user'}@badgelife.dev`;
}

/**
 * Valide si une chaîne est un email valide
 * @param {string} email - L'email à valider
 * @returns {boolean} - true si l'email est valide
 */
export function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  // Expression régulière simple pour valider un email
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email.trim());
}

/**
 * Vérifie si un utilisateur est un administrateur
 * @param {Object} user - L'objet utilisateur de Supabase
 * @returns {boolean} - true si l'utilisateur est admin
 */
export function isAdminUser(user) {
  if (!user || !user.id) return false;
  return Array.isArray(ADMIN_USER_IDS) && ADMIN_USER_IDS.includes(user.id);
}

/**
 * Parse une réponse de badge (qui peut être une string JSON ou déjà un objet)
 * @param {string|Object} answer - La réponse à parser
 * @returns {Object|null} - L'objet parsé ou null si erreur
 */
export function parseBadgeAnswer(answer) {
  if (!answer) return null;
  if (typeof answer === 'object') return answer;
  if (typeof answer !== 'string') return null;
  try {
    return JSON.parse(answer);
  } catch (e) {
    return null;
  }
}

/**
 * Parse la configuration d'un badge (alias pour parseBadgeAnswer)
 * @param {string|Object} answer - La configuration à parser
 * @returns {Object|null} - L'objet parsé ou null si erreur
 */
export function parseConfig(answer) {
  return parseBadgeAnswer(answer);
}

/**
 * Effectue un SELECT Supabase avec gestion automatique des colonnes optionnelles
 * Si la première requête échoue (colonne manquante), essaie avec les colonnes de fallback
 * @param {Object} supabase - Client Supabase
 * @param {string} table - Nom de la table
 * @param {string} selectWithOptional - Colonnes à sélectionner (peut inclure des colonnes optionnelles)
 * @param {string} selectFallback - Colonnes de fallback (sans les colonnes optionnelles)
 * @param {Function} queryBuilder - Fonction pour construire la requête (optionnel)
 * @returns {Promise<{data: any, error: any}>} - Résultat de la requête Supabase
 */
export async function safeSupabaseSelect(supabase, table, selectWithOptional, selectFallback, queryBuilder = null) {
  // Essayer d'abord avec toutes les colonnes (y compris optionnelles)
  let query = supabase.from(table).select(selectWithOptional);
  if (queryBuilder) {
    query = queryBuilder(query);
  }
  const { data, error } = await query;
  
  // Si succès, retourner le résultat
  if (!error) {
    return { data, error: null };
  }
  
  // Si erreur et qu'on a un fallback, essayer avec les colonnes de fallback
  if (selectFallback && selectFallback !== selectWithOptional) {
    let fallbackQuery = supabase.from(table).select(selectFallback);
    if (queryBuilder) {
      fallbackQuery = queryBuilder(fallbackQuery);
    }
    const { data: fallbackData, error: fallbackError } = await fallbackQuery;
    return { data: fallbackData, error: fallbackError };
  }
  
  // Sinon, retourner l'erreur originale
  return { data, error };
}

