# Guide de réinitialisation complète des règles Supabase (RLS)

## ⚠️ Est-ce risqué de tout remettre à zéro ?

### ✅ Ce qui est SÉCURISÉ (ne sera PAS supprimé) :
- **Toutes vos données** : Les tables et toutes les informations qu'elles contiennent restent intactes
- **Les utilisateurs** : Tous les comptes utilisateurs sont préservés
- **Les connexions** : Les utilisateurs connectés ne seront pas déconnectés
- **La structure des tables** : Les colonnes, types de données, etc. ne changent pas

### ⚠️ Ce qui sera TEMPORAIREMENT affecté :
- **Les politiques de sécurité (RLS)** : Elles seront supprimées puis recréées
- **Pendant quelques minutes** : Votre application pourrait ne pas fonctionner correctement
- **Les opérations sur la base de données** : Certaines requêtes pourraient échouer temporairement

### ✅ Après la réinitialisation :
- Tout devrait fonctionner normalement
- Vous aurez uniquement les politiques nécessaires (plus propre)
- Moins de confusion avec les anciens scripts

## 📋 Procédure étape par étape

### Étape 1 : Sauvegarder (recommandé mais pas obligatoire)

Si vous voulez être 100% sûr, vous pouvez exporter vos données :
1. Dans Supabase, allez dans **Table Editor**
2. Pour chaque table importante, cliquez sur **Export** (optionnel)

> 💡 **Note** : Ce n'est pas obligatoire car les données ne seront pas supprimées, seulement les règles de sécurité.

### Étape 2 : Voir ce qui existe actuellement

1. Ouvrez le fichier `sql/00_voir_etat_actuel.sql` dans Supabase SQL Editor
2. Exécutez-le pour voir toutes les politiques actuelles
3. Notez ce que vous voyez (pour référence)

### Étape 3 : Nettoyer et recréer les politiques

1. Ouvrez le fichier `sql/01_reinitialisation_complete_rls.sql`
2. **Lisez bien les commentaires** dans le script
3. Exécutez le script dans Supabase SQL Editor
4. Le script va :
   - Supprimer toutes les anciennes politiques
   - Recréer uniquement les politiques nécessaires pour votre application

### Étape 4 : Vérifier que tout fonctionne

1. Testez votre application
2. Essayez de créer une notification
3. Essayez de lire vos notifications
4. Si quelque chose ne fonctionne pas, consultez les logs Supabase

## 🎯 Quelles politiques seront créées ?

Le script va créer les politiques minimales nécessaires pour :

### Table `notifications` :
- **INSERT** : Permet à tous (authentifiés ou non) de créer des notifications
- **SELECT** : Permet aux utilisateurs authentifiés de lire leurs propres notifications
- **UPDATE** : Permet aux utilisateurs authentifiés de modifier leurs propres notifications

### Table `profiles` :
- **SELECT** : Permet à tous de lire les profils publics
- **INSERT** : Permet aux utilisateurs authentifiés de créer leur profil
- **UPDATE** : Permet aux utilisateurs authentifiés de modifier leur propre profil

### Table `user_badges` :
- **SELECT** : Permet aux utilisateurs authentifiés de lire leurs propres badges
- **INSERT** : Permet aux utilisateurs authentifiés de créer leurs badges
- **UPDATE** : Permet aux utilisateurs authentifiés de modifier leurs propres badges

### Table `subscriptions` :
- **SELECT** : Permet aux utilisateurs authentifiés de lire leurs abonnements
- **INSERT** : Permet aux utilisateurs authentifiés de créer des abonnements
- **DELETE** : Permet aux utilisateurs authentifiés de supprimer leurs abonnements

### Table `badge_suspicions` :
- **SELECT** : Permet aux utilisateurs authentifiés de lire les soupçons
- **INSERT** : Permet aux utilisateurs authentifiés de créer des soupçons
- **UPDATE** : Permet aux utilisateurs authentifiés de modifier leurs soupçons

### Table `badges` :
- **SELECT** : Permet à tous de lire la liste des badges (catalogue)
- **INSERT/UPDATE/DELETE** : Réservé aux administrateurs (si nécessaire)

## ⏱️ Temps estimé

- **Voir l'état actuel** : 1 minute
- **Nettoyer et recréer** : 2-3 minutes
- **Vérifier** : 2-3 minutes

**Total : environ 5-10 minutes**

## 🆘 En cas de problème

Si après la réinitialisation quelque chose ne fonctionne plus :

1. Vérifiez les logs Supabase : **Logs** → **Postgres Logs**
2. Regardez les erreurs dans la console de votre navigateur (F12)
3. Vérifiez que RLS est bien activé sur toutes les tables
4. Si nécessaire, vous pouvez exécuter à nouveau le script de réinitialisation

## ✅ Avantages de cette réinitialisation

- **Plus simple** : Moins de scripts, moins de confusion
- **Plus propre** : Seulement les politiques nécessaires
- **Plus facile à maintenir** : Un seul script à gérer
- **Moins d'erreurs** : Pas de politiques conflictuelles

