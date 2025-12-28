# Analyse complète du calendrier et des jetons

## 📋 Vue d'ensemble du système

Le système de calendrier fonctionne sur une base **hebdomadaire** (du lundi au dimanche). Chaque jour où l'utilisateur se connecte, il peut récupérer **2 jetons**. Si l'utilisateur se connecte tous les 7 jours de la semaine, il obtient un **bonus de 3 jetons** le dimanche (au lieu des 2 jetons normaux).

---

## 🔄 Flux principal au chargement de la page

1. **`fetchProfile()`** : Charge le profil utilisateur depuis la base de données
2. **`loadConnectionDays()`** : Charge les jours de connexion et les jetons déjà réclamés
3. **`checkAndGrantTokens()`** : Vérifie et enregistre la connexion du jour
4. **`checkAndUpdateConnectionDay()`** : Ajoute aujourd'hui dans la liste des jours connectés
5. **`renderCalendar()`** : Affiche le calendrier avec les jours disponibles

---

## ⚠️ PROBLÈMES IDENTIFIÉS

### 🔴 PROBLÈME 1 : Calcul incorrect du lundi dans `getWeekStartDate()`

**Localisation** : Ligne 5439-5446

**Le problème** :
```javascript
function getWeekStartDate(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0 = dimanche, 1 = lundi, etc.
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  return monday;
}
```

**Explication** : La fonction modifie directement l'objet `d` avec `d.setDate()`, ce qui peut causer des problèmes si la date change de mois. De plus, la logique de calcul est complexe et peut être source d'erreurs.

**Impact** : Si le calcul du lundi est incorrect, toute la logique de la semaine sera fausse, et les utilisateurs pourraient réclamer des jetons plusieurs fois ou ne pas pouvoir les réclamer.

---

### 🔴 PROBLÈME 2 : Double rendu du calendrier

**Localisation** : 
- Ligne 5845 dans `checkAndUpdateConnectionDay()`
- Ligne 5740 dans `loadConnectionDays()` (commentaire dit "Ne PAS rendre")

**Le problème** : Le calendrier peut être rendu plusieurs fois lors du chargement, ce qui peut causer :
- Des problèmes de performance
- Des événements de clic dupliqués
- Des incohérences d'affichage

**Impact** : L'interface peut clignoter ou ne pas s'afficher correctement.

---

### 🔴 PROBLÈME 3 : Logique de réinitialisation de semaine incomplète

**Localisation** : Lignes 5536-5582 dans `loadConnectionDays()`

**Le problème** : Quand une nouvelle semaine est détectée :
1. Les données locales sont réinitialisées (lignes 5551-5554)
2. Mais `state.profile.claimed_daily_tokens` n'est PAS réinitialisé (ligne 5559)
3. Puis les données sont filtrées plus tard (ligne 5640)

**Risque** : Si le filtrage échoue ou si les données de Supabase ne sont pas à jour, des dates d'anciennes semaines pourraient rester dans le système.

**Impact** : Un utilisateur pourrait voir des jours "réclamés" qui ne devraient plus l'être, ou l'inverse.

---

### 🔴 PROBLÈME 4 : Vérification du dimanche incohérente

**Localisation** : 
- Ligne 5886 : `const isSunday = (dayIndex) => dayIndex === 6;` (dans `renderCalendar()`)
- Ligne 6020 : `const isSunday = dayOfWeek === 0;` (dans le gestionnaire de clic)
- Ligne 6298 : Calcul manuel du dimanche (dans `handleClaimBonus()`)

**Le problème** : 
- Dans `renderCalendar()`, le dimanche est l'index 6 (7ème jour du tableau)
- Dans le gestionnaire de clic, le dimanche est vérifié avec `day.getDay() === 0` (JavaScript standard)
- Ces deux méthodes peuvent donner des résultats différents selon le contexte

**Impact** : Le bonus du dimanche pourrait ne pas fonctionner correctement ou être disponible au mauvais moment.

---

### 🔴 PROBLÈME 5 : Sauvegarde dans Supabase peut échouer silencieusement

**Localisation** : Lignes 6168-6233 dans `claimDailyTokens()`

**Le problème** : Si la sauvegarde dans Supabase échoue :
1. Les jetons sont déjà ajoutés localement (ligne 6150)
2. L'interface est déjà mise à jour (ligne 6159)
3. Si l'erreur est détectée, on annule les changements (lignes 6224-6232)

**Risque** : Si l'erreur n'est pas correctement gérée, l'utilisateur pourrait voir des jetons qui ne sont pas réellement sauvegardés, ou perdre des jetons après un refresh.

**Impact** : Perte de jetons ou incohérence entre l'affichage et la base de données.

---

### 🟡 PROBLÈME 6 : Filtrage des dates peut être lent

**Localisation** : Ligne 5450-5462 dans `filterDatesByCurrentWeek()`

**Le problème** : La fonction crée un nouvel objet `Date` pour chaque date du tableau, puis calcule le début de semaine pour chacune. Si le tableau contient beaucoup de dates (plusieurs semaines), cela peut être lent.

**Impact** : Ralentissement de l'application si beaucoup de données sont stockées.

---

### 🟡 PROBLÈME 7 : localStorage utilisé comme backup mais peut être désynchronisé

**Localisation** : Lignes 5710-5731 dans `loadConnectionDays()`

**Le problème** : 
- localStorage est chargé seulement si `state.claimedDailyTokens.length === 0`
- Mais si les données de Supabase sont filtrées et deviennent vides (autre semaine), localStorage pourrait être chargé avec des données obsolètes
- Les données de localStorage ne sont pas toujours synchronisées avec Supabase

**Impact** : Des données obsolètes pourraient être chargées depuis localStorage.

---

### 🟡 PROBLÈME 8 : Vérification du bonus hebdomadaire peut être incorrecte

**Localisation** : Ligne 5736 dans `loadConnectionDays()`

**Le problème** :
```javascript
state.canClaimBonus = state.connectionDays.length === 7 && !state.weekBonusClaimed;
```

Cette vérification ne tient pas compte du fait que les jours doivent être dans la semaine actuelle. Si `state.connectionDays` contient des jours d'anciennes semaines (non filtrés), le bonus pourrait être disponible incorrectement.

**Impact** : Le bonus pourrait être disponible même si tous les jours de la semaine actuelle ne sont pas connectés.

---

### 🟡 PROBLÈME 9 : `updateCalendarBadge()` ne filtre pas les dates

**Localisation** : Lignes 6456-6482

**Le problème** :
```javascript
availableTokensCount = state.connectionDays.filter(dayStr => 
  !state.claimedDailyTokens.includes(dayStr)
).length;
```

Cette fonction compte les jours connectés qui ne sont pas dans `claimedDailyTokens`, mais elle ne vérifie pas si ces jours sont dans la semaine actuelle. Si des jours d'anciennes semaines sont présents, le badge pourrait afficher un nombre incorrect.

**Impact** : Le badge du calendrier pourrait afficher un nombre incorrect de jetons disponibles.

---

### 🟡 PROBLÈME 10 : Race condition possible lors de clics rapides

**Localisation** : Lignes 6140-6263 dans `claimDailyTokens()`

**Le problème** : Même avec le verrou `isClaimingTokens`, il y a une fenêtre entre :
1. La mise à jour du state local (ligne 6150)
2. Le rendu du calendrier (ligne 6159)
3. La sauvegarde dans Supabase (ligne 6168)

Si l'utilisateur clique très rapidement ou si la connexion est lente, plusieurs requêtes pourraient être envoyées.

**Impact** : Double réclamation possible si la connexion est lente.

---

## ✅ Points positifs

1. **Système de verrou** : Protection contre les doubles clics avec `isClaimingTokens` et `claimingDay`
2. **Mise à jour immédiate** : Le state local est mis à jour avant Supabase pour une meilleure expérience utilisateur
3. **Filtrage automatique** : Les dates des anciennes semaines sont automatiquement nettoyées
4. **Fallback localStorage** : Si la colonne n'existe pas dans Supabase, utilisation de localStorage
5. **Vérifications multiples** : Vérifie à la fois dans le state local ET dans le profil

---

## 🔧 Recommandations prioritaires

### 1. Corriger le calcul du lundi (URGENT)
Simplifier et corriger `getWeekStartDate()` pour éviter les erreurs de calcul.

### 2. Unifier la vérification du dimanche (URGENT)
Créer une fonction unique pour vérifier si c'est le dimanche, utilisée partout.

### 3. Filtrer les dates dans `updateCalendarBadge()` (IMPORTANT)
S'assurer que seules les dates de la semaine actuelle sont comptées.

### 4. Améliorer la gestion des erreurs (IMPORTANT)
S'assurer que les erreurs de sauvegarde sont correctement gérées et que l'utilisateur est informé.

### 5. Optimiser le filtrage des dates (MOYEN)
Créer un cache ou optimiser le calcul pour éviter de recalculer pour chaque date.

### 6. Synchroniser localStorage avec Supabase (MOYEN)
S'assurer que localStorage est toujours synchronisé avec Supabase et nettoyé régulièrement.

---

## 📝 Notes techniques

- Le système utilise des dates au format ISO (YYYY-MM-DD)
- La semaine commence le lundi (pas le dimanche)
- Les jetons sont stockés dans `state.tokens` et `state.profile.tokens`
- Les jours de connexion sont dans `state.connectionDays` et `state.profile.connection_days`
- Les jours réclamés sont dans `state.claimedDailyTokens` et `state.profile.claimed_daily_tokens`

