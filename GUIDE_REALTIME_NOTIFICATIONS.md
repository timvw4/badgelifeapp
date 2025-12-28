# Guide : Activer Realtime pour les notifications

## 📋 Étapes pour activer Realtime dans Supabase

### 1. Exécuter le fichier SQL

Exécute le fichier `enable_realtime_notifications.sql` dans l'éditeur SQL de Supabase :

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
```

### 2. Vérifier dans le Dashboard Supabase

1. Va dans ton projet Supabase
2. Clique sur **Database** dans le menu de gauche
3. Clique sur **Replication** (ou **Publications**)
4. Vérifie que la table `notifications` apparaît dans la liste des tables avec Realtime activé

### 3. Vérifier via SQL (optionnel)

Tu peux vérifier que Realtime est activé en exécutant :

```sql
SELECT * FROM pg_publication_tables 
WHERE pubname = 'supabase_realtime' 
AND tablename = 'notifications';
```

Si tu vois une ligne avec `notifications`, c'est que Realtime est activé ✅

## 🔍 Vérifier que le code fonctionne

### Dans la console du navigateur

1. Ouvre la console du navigateur (F12)
2. Connecte-toi à l'application
3. Tu devrais voir des messages de log indiquant que Realtime est connecté

### Test manuel

1. **Test d'abonnement** :
   - Connecte-toi avec un compte A
   - Connecte-toi avec un compte B (dans un autre onglet/navigateur)
   - Depuis le compte B, abonne-toi au compte A
   - La pastille rouge devrait apparaître instantanément sur le compte A (sans recharger la page)

2. **Test de notification de connexion** :
   - Connecte-toi et réclame des jetons journaliers
   - La notification devrait apparaître dans le modal instantanément

3. **Test de soupçon** :
   - Depuis le compte B, soupçonne un badge du compte A
   - La notification devrait apparaître instantanément sur le compte A

## 🐛 Dépannage

### Si Realtime ne fonctionne pas :

1. **Vérifier que la table existe** :
   ```sql
   SELECT * FROM notifications LIMIT 1;
   ```

2. **Vérifier les permissions RLS** :
   - Les policies doivent permettre la lecture des notifications
   - Vérifie dans **Authentication > Policies** que les policies sont correctes

3. **Vérifier la connexion WebSocket** :
   - Ouvre la console du navigateur
   - Regarde s'il y a des erreurs de connexion WebSocket
   - Vérifie que ton projet Supabase a Realtime activé (gratuit jusqu'à 500MB)

4. **Vérifier les logs Supabase** :
   - Va dans **Logs > Realtime** dans le dashboard
   - Regarde s'il y a des erreurs

## ✅ Checklist de vérification

- [ ] Table `notifications` créée
- [ ] Realtime activé sur la table (via SQL)
- [ ] Policies RLS configurées
- [ ] Code JavaScript initialise `setupRealtimeNotificationListener()`
- [ ] Test d'abonnement fonctionne en temps réel
- [ ] Test de notification de connexion fonctionne
- [ ] Pastille rouge se met à jour automatiquement

## 📝 Notes importantes

- Realtime fonctionne uniquement pour les **INSERT**, **UPDATE** et **DELETE**
- Les notifications sont filtrées par `user_id` dans le code (pas besoin de filtre côté serveur)
- Le système écoute tous les événements sur la table `notifications` pour l'utilisateur connecté
- Si tu as plusieurs onglets ouverts avec le même compte, tous se mettront à jour en temps réel

