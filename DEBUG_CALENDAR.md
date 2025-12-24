# Debug Calendrier - Analyse du flux

## Flux d'exécution au chargement

1. `fetchProfile()` (ligne 946)
   - Charge `state.profile.claimed_daily_tokens` depuis Supabase (ligne 983)
   - Appelle `loadConnectionDays()` (ligne 997)
   - Appelle `checkAndGrantTokens()` (ligne 1004)

2. `loadConnectionDays()` (ligne 4651)
   - Vérifie si nouvelle semaine (ligne 4664)
   - Si nouvelle semaine : appelle `resetWeekData()` qui réinitialise TOUT (ligne 4666)
   - Sinon : charge `state.connectionDays` depuis le profil (ligne 4669)
   - Charge `state.claimedDailyTokens` depuis `state.profile.claimed_daily_tokens` (ligne 4698)
   - **PROBLÈME POTENTIEL** : Si `state.claimedDailyTokens.length === 0`, charge depuis localStorage (ligne 4711)
   - Appelle `renderCalendar()` (ligne 4744)

3. `checkAndGrantTokens()` (ligne 1009)
   - Appelle `checkAndUpdateConnectionDay()` (ligne 1014)

4. `checkAndUpdateConnectionDay()` (ligne 4751)
   - Ajoute le jour d'aujourd'hui si nécessaire
   - Appelle `renderCalendar()` (ligne 4820)

## Problèmes identifiés

### Problème 1 : Double appel à renderCalendar()
- `renderCalendar()` est appelé dans `loadConnectionDays()` (ligne 4744)
- `renderCalendar()` est appelé dans `checkAndUpdateConnectionDay()` (ligne 4820)
- Cela pourrait causer des problèmes de synchronisation

### Problème 2 : resetWeekData() réinitialise claimedDailyTokens
- `resetWeekData()` met `state.claimedDailyTokens = []` (ligne 4626)
- Si appelé, cela efface toutes les données même si on est dans la même semaine

### Problème 3 : Chargement depuis localStorage si length === 0
- Si `state.claimedDailyTokens.length === 0`, on charge depuis localStorage (ligne 4711)
- Mais si les données sont dans Supabase mais filtrées (autre semaine), on pourrait charger des données obsolètes

### Problème 4 : renderCalendar() utilise claimedDailyTokensForDisplay
- `renderCalendar()` utilise une variable locale `claimedDailyTokensForDisplay`
- Mais la vérification `isDayClaimed()` utilise `state.claimedDailyTokens`
- Il pourrait y avoir une désynchronisation

