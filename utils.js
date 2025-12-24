// Module utilitaire partagé pour les fonctions communes
// Utilisé par app.js et admin.js pour éviter la duplication de code

/**
 * Parse une réponse de badge (qui peut être une string JSON ou déjà un objet)
 * @param {string|Object} answer - La réponse à parser
 * @returns {Object|null} - L'objet parsé ou null si erreur
 */
export function parseBadgeAnswer(answer) {
  if (!answer) return null;
  if (typeof answer === 'string') {
    try {
      return JSON.parse(answer);
    } catch (_) {
      return null;
    }
  }
  return answer || null;
}

/**
 * Effectue une requête SELECT Supabase avec fallback automatique si certaines colonnes n'existent pas
 * Cette fonction simplifie la gestion des colonnes optionnelles en faisant automatiquement un retry
 * @param {Object} supabase - Instance Supabase client
 * @param {string} table - Nom de la table
 * @param {string} columns - Colonnes à sélectionner (format Supabase)
 * @param {string} fallbackColumns - Colonnes de fallback si les premières échouent
 * @param {Function} queryBuilder - Fonction qui construit la requête (reçoit le query builder et doit retourner la requête)
 * @returns {Promise<{data: any, error: any}>} - Résultat de la requête
 */
export async function safeSupabaseSelect(supabase, table, columns, fallbackColumns, queryBuilder = null) {
  // Construire la requête avec les colonnes principales
  let query = supabase.from(table).select(columns);
  
  // Appliquer le query builder si fourni
  if (queryBuilder && typeof queryBuilder === 'function') {
    query = queryBuilder(query);
  }
  
  let { data, error } = await query;
  
  // Si erreur liée à des colonnes manquantes, retry avec fallback
  if (error && error.message && fallbackColumns) {
    const errorMsg = error.message.toLowerCase();
    // Liste des colonnes optionnelles communes
    const optionalColumns = ['emoji', 'is_private', 'tokens', 'last_token_date', 'connection_days', 
                             'week_start_date', 'week_bonus_available', 'week_bonus_claimed', 
                             'claimed_daily_tokens', 'description'];
    
    const hasOptionalColumn = optionalColumns.some(col => errorMsg.includes(col));
    
    if (hasOptionalColumn) {
      // Retry avec les colonnes de fallback
      let retryQuery = supabase.from(table).select(fallbackColumns);
      
      // Réappliquer le query builder
      if (queryBuilder && typeof queryBuilder === 'function') {
        retryQuery = queryBuilder(retryQuery);
      }
      
      const retry = await retryQuery;
      if (!retry.error) {
        return { data: retry.data, error: null };
      }
    }
  }
  
  return { data, error };
}

/**
 * Parse une configuration de badge (alias pour parseBadgeAnswer pour compatibilité)
 * @param {string|Object} answer - La réponse à parser
 * @returns {Object|null} - L'objet parsé ou null si erreur
 */
export function parseConfig(answer) {
  return parseBadgeAnswer(answer);
}

