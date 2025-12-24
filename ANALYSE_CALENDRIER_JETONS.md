# Analyse de la logique du calendrier et des jetons journaliers

## 📋 Vue d'ensemble

Cette analyse examine toutes les fonctions liées au système de calendrier et à l'obtention des jetons journaliers dans l'application BadgeLife.

---

## 🔍 Fonctions principales identifiées

### 1. Fonctions de gestion des connexions

#### `checkAndGrantTokens()` (ligne 1019)
- **Rôle** : Fonction principale appelée au chargement du profil
- **Actions** :
  - Met à jour le jour de connexion via `checkAndUpdateConnectionDay()`
  - Met à jour l'affichage des jetons
- **Note** : Ne distribue PAS automatiquement les jetons (ils doivent être réclamés manuellement)

#### `checkAndUpdateConnectionDay()` (ligne 4753)
- **Rôle** : Enregistre que l'utilisateur s'est connecté aujourd'hui
- **Actions** :
  - Vérifie si on est dans une nouvelle semaine (réinitialise si nécessaire)
  - Ajoute la date d'aujourd'hui à `connectionDays` si pas déjà présente
  - Vérifie si tous les 7 jours sont connectés (active le bonus si oui)
  - Sauvegarde dans Supabase
  - Met à jour le calendrier

#### `loadConnectionDays()` (ligne 4626)
- **Rôle** : Charge les jours de connexion depuis le profil Supabase
- **Actions** :
  - Détecte si on est dans une nouvelle semaine (réinitialise si nécessaire)
  - Charge `connection_days` depuis le profil
  - Charge et filtre `claimed_daily_tokens` pour ne garder que la semaine actuelle
  - Charge depuis localStorage en backup si la colonne n'existe pas
  - Vérifie si le bonus hebdomadaire est disponible
  - Rend le calendrier

---

### 2. Fonctions de réclamation des jetons

#### `claimDailyTokens(dayStr)` (ligne 5027)
- **Rôle** : Réclame 2 jetons pour un jour spécifique
- **Sécurité** :
  - Verrou `isClaimingTokens` pour éviter les appels multiples
  - Vérifie que le jour est connecté
  - Vérifie que le jour est dans la semaine actuelle
  - Vérifie que les jetons n'ont pas déjà été réclamés (dans state ET profil)
- **Actions** :
  - Ajoute 2 jetons au total
  - Ajoute la date à `claimedDailyTokens`
  - Met à jour immédiatement le state local (avant Supabase)
  - Sauvegarde dans Supabase
  - Affiche une animation et une notification

#### `handleClaimBonus()` (ligne 5256)
- **Rôle** : Réclame le bonus de 3 jetons (si tous les jours sont connectés)
- **Sécurité** :
  - Même système de verrou que `claimDailyTokens()`
  - Vérifie que tous les 7 jours sont connectés
  - Vérifie que le bonus n'a pas déjà été réclamé
- **Actions** :
  - Ajoute 3 jetons au total
  - Marque le bonus comme réclamé
  - Ajoute la date du dimanche à `claimedDailyTokens`
  - Met à jour immédiatement le state local
  - Sauvegarde dans Supabase
  - Affiche une animation de confettis et une notification

---

### 3. Fonctions d'affichage

#### `renderCalendar()` (ligne 4821)
- **Rôle** : Affiche le calendrier des 7 jours de la semaine
- **Logique** :
  - Génère les 7 jours (lundi à dimanche)
  - Pour chaque jour, détermine l'état :
    - `not-available` : Pas connecté ce jour
    - `available` : Connecté, jetons disponibles (+2)
    - `claimed` : Jetons déjà récupérés
    - `bonus-available` : Bonus hebdomadaire disponible (dimanche, +3)
    - `bonus-claimed` : Bonus déjà récupéré
  - Attache un gestionnaire de clic pour réclamer les jetons
  - Utilise la délégation d'événements pour éviter les duplications

#### `updateCalendarBadge()` (ligne 5445)
- **Rôle** : Met à jour la pastille sur le bouton calendrier (affiche le nombre de jetons disponibles)
- **Logique** :
  - Compte les jours connectés mais non réclamés
  - Ajoute 1 si le bonus hebdomadaire est disponible
  - Affiche/cache la pastille selon le résultat

---

### 4. Fonctions utilitaires

#### `getWeekStartDate(date)` (ligne 4588)
- **Rôle** : Calcule le lundi de la semaine pour une date donnée
- **Logique** : Ajuste pour que lundi = jour 1 (pas dimanche)

#### `filterDatesByCurrentWeek(dateArray, currentWeekStartStr)` (ligne 4599)
- **Rôle** : Filtre un tableau de dates pour ne garder que celles de la semaine actuelle
- **Utilisation** : Évite la duplication de code dans plusieurs fonctions

#### `isDateInCurrentWeek(dateStr, currentWeekStartStr)` (ligne 4614)
- **Rôle** : Vérifie si une date est dans la semaine actuelle
- **Note** : Logique similaire à `filterDatesByCurrentWeek()` mais pour une seule date

---

## ⚠️ Problèmes identifiés

### 1. Code dupliqué dans la vérification des dates

**Problème** : La logique de vérification "est-ce que c'est dans la semaine actuelle" est répétée à plusieurs endroits :

- Dans `loadConnectionDays()` (lignes 4692-4702) : Filtre les dates réclamées
- Dans `checkAndUpdateConnectionDay()` (ligne 4784) : Filtre les jours de connexion
- Dans `claimDailyTokens()` (lignes 5082-5090) : Filtre les dates réclamées (2 fois)
- Dans `renderCalendar()` (lignes 4864-4868) : Filtre les dates réclamées
- Dans le gestionnaire de clic de `renderCalendar()` (lignes 4984-4987) : Filtre les dates réclamées

**Solution recommandée** : Utiliser systématiquement `filterDatesByCurrentWeek()` partout où c'est possible.

---

### 2. Vérifications redondantes dans `claimDailyTokens()`

**Problème** : La fonction `claimDailyTokens()` vérifie plusieurs fois si les jetons ont été réclamés :

- Ligne 5073-5078 : Initialise les tableaux
- Lignes 5082-5094 : Filtre et vérifie dans state ET profil
- Lignes 5120-5133 : Re-vérifie après rechargement du profil

**Note** : Ces vérifications sont nécessaires pour la sécurité, mais pourraient être mieux organisées.

---

### 3. Logique similaire entre `filterDatesByCurrentWeek()` et `isDateInCurrentWeek()`

**Problème** : Ces deux fonctions font essentiellement la même chose :
- `filterDatesByCurrentWeek()` : Filtre un tableau de dates
- `isDateInCurrentWeek()` : Vérifie une seule date

**Solution recommandée** : `isDateInCurrentWeek()` pourrait utiliser `filterDatesByCurrentWeek()` en interne pour éviter la duplication :

```javascript
function isDateInCurrentWeek(dateStr, currentWeekStartStr) {
  const filtered = filterDatesByCurrentWeek([dateStr], currentWeekStartStr);
  return filtered.length > 0;
}
```

---

### 4. Double vérification dans `renderCalendar()`

**Problème** : Dans `renderCalendar()`, on vérifie si un jour est réclamé à deux endroits :

- Lignes 4863-4869 : Lors de la génération des jours
- Lignes 4979-4994 : Dans le gestionnaire de clic

**Note** : C'est normal car on vérifie d'abord pour l'affichage, puis pour l'action. Mais on pourrait simplifier.

---

### 5. Calcul du dimanche dans `handleClaimBonus()`

**Problème** : La fonction calcule le dimanche manuellement (lignes 5286-5288), mais il y a déjà une fonction `isSunday()` dans `renderCalendar()` (ligne 4850).

**Note** : Ce n'est pas vraiment une duplication car `isSunday()` dans `renderCalendar()` vérifie l'index du jour (0-6), tandis que `handleClaimBonus()` calcule la date du dimanche.

---

## ✅ Points positifs

1. **Système de verrou** : Excellente protection contre les doubles clics avec `isClaimingTokens` et `claimingDay`
2. **Mise à jour immédiate du state** : Le state local est mis à jour avant Supabase pour une meilleure UX
3. **Filtrage automatique des semaines** : Les dates des anciennes semaines sont automatiquement nettoyées
4. **Fallback localStorage** : Si la colonne n'existe pas dans Supabase, utilisation de localStorage
5. **Vérifications multiples** : Vérifie à la fois dans le state local ET dans le profil pour éviter les problèmes de synchronisation

---

## 🔧 Recommandations d'amélioration

### 1. Créer une fonction utilitaire pour vérifier si un jour est réclamé

```javascript
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
```

Cette fonction pourrait être utilisée dans `renderCalendar()` et `claimDailyTokens()`.

---

### 2. Simplifier `isDateInCurrentWeek()` en utilisant `filterDatesByCurrentWeek()`

```javascript
function isDateInCurrentWeek(dateStr, currentWeekStartStr) {
  const filtered = filterDatesByCurrentWeek([dateStr], currentWeekStartStr);
  return filtered.length > 0;
}
```

---

### 3. Extraire la logique de réinitialisation de semaine

Créer une fonction `resetWeekData()` qui serait appelée dans `loadConnectionDays()` et `checkAndUpdateConnectionDay()` :

```javascript
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
```

---

## 📊 Résumé des fonctions

| Fonction | Ligne | Rôle | Duplications |
|----------|-------|------|--------------|
| `checkAndGrantTokens()` | 1019 | Point d'entrée principal | ❌ Non |
| `checkAndUpdateConnectionDay()` | 4753 | Enregistre la connexion du jour | ⚠️ Logique de réinitialisation similaire |
| `loadConnectionDays()` | 4626 | Charge les données depuis Supabase | ⚠️ Logique de réinitialisation similaire |
| `renderCalendar()` | 4821 | Affiche le calendrier | ⚠️ Vérifications répétées |
| `claimDailyTokens()` | 5027 | Réclame 2 jetons | ⚠️ Vérifications multiples |
| `handleClaimBonus()` | 5256 | Réclame 3 jetons bonus | ❌ Non |
| `updateCalendarBadge()` | 5445 | Met à jour la pastille | ❌ Non |
| `getWeekStartDate()` | 4588 | Calcule le lundi | ❌ Non |
| `filterDatesByCurrentWeek()` | 4599 | Filtre les dates | ❌ Non |
| `isDateInCurrentWeek()` | 4614 | Vérifie une date | ⚠️ Logique similaire à `filterDatesByCurrentWeek()` |

---

## 🎯 Conclusion

Le code est globalement bien structuré avec de bonnes pratiques de sécurité (verrous, vérifications multiples). Cependant, il y a quelques opportunités d'amélioration :

1. **Réduire la duplication** : Utiliser `filterDatesByCurrentWeek()` plus systématiquement
2. **Simplifier `isDateInCurrentWeek()`** : Utiliser `filterDatesByCurrentWeek()` en interne
3. **Extraire la logique de réinitialisation** : Créer une fonction dédiée
4. **Créer une fonction utilitaire** : Pour vérifier si un jour est réclamé

Ces améliorations rendraient le code plus maintenable et réduiraient le risque d'erreurs.

