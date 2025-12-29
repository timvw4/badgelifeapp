# BadgeLife - Ta vie en badges

## 📖 Qu'est-ce que BadgeLife ?

BadgeLife est une application web qui permet de créer et gérer des badges personnalisés pour suivre tes accomplissements et défis personnels. C'est comme un système de gamification pour ta vie quotidienne !

### Fonctionnalités principales

- 🎯 **Création de badges** : Crée des badges personnalisés pour tes objectifs
- 👥 **Communauté** : Suis d'autres utilisateurs et partage tes badges
- 🔔 **Notifications** : Sois informé des abonnements, soupçons et récompenses
- 🪙 **Système de jetons** : Gagne des jetons en te connectant chaque jour
- 🏆 **Rangs** : Monte en niveau selon tes points de compétence
- 🔍 **Soupçons** : Les amis peuvent soupçonner des badges s'ils pensent que tu mens

---

## 📁 Structure du projet

Voici comment les fichiers sont organisés pour que ce soit facile à comprendre :

```
site web/
├── 📄 index.html              # Page principale de l'application
├── 📄 admin.html              # Page d'administration (pour les admins)
├── 📄 styles.css              # Tous les styles (couleurs, mise en page)
│
├── ⚙️ config.js               # Configuration Supabase (URL et clés)
├── ⚙️ app.js                  # Fichier principal - logique de l'application
├── ⚙️ admin.js                # Logique de la page d'administration
├── ⚙️ utils.js                # Fonctions utiles partagées
│
├── 🎯 badgeCalculations.js    # Calculs liés aux badges (rangs, points)
├── 🎯 badgeSuspicions.js      # Gestion des soupçons de badges
│
├── 👥 subscriptions.js       # Logique des abonnements (suivre/utilisateurs)
├── 👥 subscriptionUI.js       # Interface utilisateur pour les abonnements
├── 👥 subscriptionNotifications.js  # Création des notifications
├── 👥 notificationUI.js       # Affichage des notifications
│
├── 📁 icons/                  # Toutes les images et icônes
│   ├── logobl.png
│   ├── logobadgelifeB.png
│   └── ...
│
├── 📁 docs/                   # Documentation du projet
│   ├── RAPPORT_ANALYSE_NOTIFICATIONS.md
│   ├── ANALYSE_FICHIERS_REDONDANTS.md
│   └── GUIDE_SANTE_PROJET.md
│
└── 📁 sql/                    # Fichiers SQL pour la base de données
    ├── migrations/
    │   └── fix_notification_suspicion_indexes.sql
    └── test_notification_creation.sql
```

### Explication simple des fichiers

#### Fichiers HTML
- **`index.html`** : C'est la page que tu vois quand tu ouvres l'application. Elle contient tous les éléments visuels (boutons, formulaires, etc.)
- **`admin.html`** : Page spéciale pour les administrateurs (gestion des badges, utilisateurs, etc.)

#### Fichiers JavaScript principaux
- **`app.js`** : Le cerveau de l'application. Il gère tout : connexion, affichage des badges, interactions utilisateur, etc.
- **`admin.js`** : Le cerveau de la page d'administration
- **`config.js`** : Contient les informations de connexion à Supabase (comme une adresse et une clé)

#### Fichiers JavaScript spécialisés
- **`badgeCalculations.js`** : Calcule les rangs et points des utilisateurs
- **`badgeSuspicions.js`** : Gère quand quelqu'un soupçonne un badge (pense que tu mens)
- **`subscriptions.js`** : Gère les abonnements (suivre/se désabonner)
- **`subscriptionUI.js`** : Affiche les boutons et listes d'abonnements
- **`subscriptionNotifications.js`** : Crée les notifications (quand quelqu'un s'abonne, etc.)
- **`notificationUI.js`** : Affiche les notifications à l'utilisateur
- **`utils.js`** : Fonctions utiles utilisées par plusieurs fichiers

#### Fichiers CSS
- **`styles.css`** : Tous les styles visuels (couleurs, tailles, animations)

#### Dossiers
- **`icons/`** : Toutes les images et icônes utilisées dans l'application
- **`docs/`** : Documentation technique (pour comprendre le code)
- **`sql/`** : Scripts SQL pour la base de données (à exécuter dans Supabase)

---

## 🚀 Installation et démarrage

### Prérequis

Pour utiliser ce projet, tu as besoin de :
- Un compte **Supabase** (gratuit) : [https://supabase.com](https://supabase.com)
- Un **serveur web** pour héberger les fichiers (ou utiliser un serveur local)

### Étapes d'installation

#### 1. Cloner ou télécharger le projet

Si tu as Git installé :
```bash
git clone [URL_DU_PROJET]
cd "site web"
```

Sinon, télécharge le projet et décompresse-le.

#### 2. Configurer Supabase

1. Crée un compte sur [Supabase](https://supabase.com)
2. Crée un nouveau projet
3. Va dans **Settings** → **API**
4. Copie l'**URL du projet** et la **clé anon public**

#### 3. Configurer les clés dans le projet

Ouvre le fichier **`config.js`** et remplace les valeurs :

```javascript
export const SUPABASE_URL = 'TON_URL_SUPABASE_ICI';
export const SUPABASE_ANON_KEY = 'TA_CLE_ANON_ICI';
```

#### 4. Créer les tables dans Supabase

Tu dois créer les tables dans ta base de données Supabase. Les scripts SQL sont dans le dossier `sql/`.

**Tables principales à créer** :
- `profiles` : Informations des utilisateurs
- `badges` : Liste des badges disponibles
- `user_badges` : Badges possédés par les utilisateurs
- `subscriptions` : Abonnements entre utilisateurs
- `notifications` : Notifications des utilisateurs
- `badge_suspicions` : Soupçons sur les badges

> 💡 **Note** : Si tu n'as pas encore créé les tables, contacte le développeur ou consulte la documentation Supabase pour créer le schéma de base de données.

#### 5. Exécuter les migrations SQL

Si tu as des fichiers SQL dans `sql/migrations/`, exécute-les dans l'éditeur SQL de Supabase :

1. Va dans Supabase → **SQL Editor**
2. Ouvre le fichier `sql/migrations/fix_notification_suspicion_indexes.sql`
3. Copie-colle le contenu dans l'éditeur SQL
4. Clique sur **Run**

#### 6. Lancer l'application

**Option A : Serveur local simple**

Si tu as Python installé :
```bash
# Python 3
python -m http.server 8000

# Python 2
python -m SimpleHTTPServer 8000
```

Puis ouvre ton navigateur à : `http://localhost:8000`

**Option B : Utiliser un serveur web**

Tu peux aussi utiliser :
- **VS Code** avec l'extension "Live Server"
- **Node.js** avec `npx serve`
- N'importe quel serveur web (Apache, Nginx, etc.)

**Option C : Hébergement en ligne**

Tu peux héberger sur :
- **Netlify** (gratuit) : [https://netlify.com](https://netlify.com)
- **Vercel** (gratuit) : [https://vercel.com](https://vercel.com)
- **GitHub Pages** (gratuit) : [https://pages.github.com](https://pages.github.com)

---

## ⚙️ Configuration

### Configuration Supabase

Le fichier **`config.js`** contient les paramètres principaux :

```javascript
// URL de ton projet Supabase
export const SUPABASE_URL = 'https://ton-projet.supabase.co';

// Clé publique (anon key) - c'est normal qu'elle soit visible
export const SUPABASE_ANON_KEY = 'ta_cle_ici';

// Liste des IDs des administrateurs
export const ADMIN_USER_IDS = [
  'uuid-admin-1',
  'uuid-admin-2'
];
```

### Configuration des administrateurs

Pour ajouter un administrateur :

1. Connecte-toi à l'application
2. Va dans **Mon profil**
3. Copie ton **ID utilisateur** (UUID)
4. Ajoute-le dans `config.js` dans le tableau `ADMIN_USER_IDS`

---

## 🎮 Utilisation

### Pour les utilisateurs

1. **Créer un compte** : Clique sur "Créer un compte" et choisis un pseudo
2. **Se connecter** : Utilise ton pseudo et mot de passe
3. **Créer des badges** : Va dans "Créer un badge" et remplis le formulaire
4. **Suivre des utilisateurs** : Va dans "Communauté" et clique sur "S'abonner"
5. **Voir les notifications** : Clique sur l'icône de cloche en haut à droite

### Pour les administrateurs

1. Connecte-toi avec un compte admin
2. Va sur `/admin.html` (ou clique sur le bouton admin si disponible)
3. Tu peux gérer les badges, utilisateurs, etc.

---

## 🔧 Maintenance et améliorations

### Fichiers importants à connaître

- **`app.js`** : Si tu veux modifier le comportement principal de l'application
- **`styles.css`** : Si tu veux changer l'apparence (couleurs, tailles, etc.)
- **`index.html`** : Si tu veux modifier la structure de la page
- **`config.js`** : Si tu veux changer la configuration Supabase

### Ajouter une nouvelle fonctionnalité

1. **Créer un nouveau fichier JavaScript** si nécessaire (ex: `maFonctionnalite.js`)
2. **L'importer dans `app.js`** : `import * as MaFonctionnalite from './maFonctionnalite.js';`
3. **L'utiliser dans le code** : `MaFonctionnalite.maFonction();`

### Modifier les styles

Ouvre **`styles.css`** et modifie les valeurs. Par exemple :
- Pour changer la couleur principale, cherche `--primary-color`
- Pour changer les polices, cherche `font-family`

---

## 📚 Documentation

### Documentation disponible

Dans le dossier **`docs/`**, tu trouveras :

- **`GUIDE_STRUCTURE_SIMPLE.md`** : ⭐ **COMMENCE ICI** - Guide simplifié pour comprendre la structure
- **`RAPPORT_ANALYSE_NOTIFICATIONS.md`** : Analyse complète du système de notifications
- **`ANALYSE_FICHIERS_REDONDANTS.md`** : Analyse des fichiers du projet
- **`GUIDE_SANTE_PROJET.md`** : Guide pour maintenir le projet en bonne santé

> 💡 **Conseil pour débutants** : Commence par lire `docs/GUIDE_STRUCTURE_SIMPLE.md` pour comprendre facilement comment le projet est organisé !

### Comprendre le code

Si tu es débutant, voici quelques conseils :

1. **Commence par `index.html`** : C'est la structure de la page
2. **Regarde `app.js`** : C'est le point d'entrée, tu verras comment tout fonctionne
3. **Explore les fichiers spécialisés** : Chaque fichier a un rôle précis
4. **Utilise la console du navigateur** : Appuie sur F12 pour voir les erreurs et logs

---

## 🐛 Dépannage

### Problèmes courants

#### L'application ne se charge pas
- Vérifie que `config.js` contient les bonnes valeurs Supabase
- Ouvre la console du navigateur (F12) pour voir les erreurs
- Vérifie que tous les fichiers sont présents

#### Erreur "Table does not exist"
- Tu dois créer les tables dans Supabase
- Vérifie que les migrations SQL ont été exécutées

#### Les notifications ne fonctionnent pas
- Vérifie que la table `notifications` existe
- Exécute le fichier `sql/migrations/fix_notification_suspicion_indexes.sql`
- Vérifie les policies RLS dans Supabase

#### Je ne peux pas me connecter
- Vérifie que ton compte existe dans Supabase
- Vérifie que l'authentification est activée dans Supabase
- Regarde la console du navigateur pour les erreurs

---

## 📝 Notes importantes

### Sécurité

- Les clés dans `config.js` sont des **clés publiques** (anon key), c'est normal qu'elles soient visibles
- Ne partage **jamais** ta clé secrète (service role key) de Supabase
- Les mots de passe sont gérés par Supabase (sécurisés)

### Performance

- L'application utilise **Realtime** de Supabase pour les mises à jour instantanées
- Les notifications se mettent à jour automatiquement sans recharger la page

### Compatibilité

- L'application fonctionne sur **tous les navigateurs modernes**
- Optimisée pour mobile (responsive design)
- Fonctionne en mode hors ligne partiel (avec cache)

---

## 🤝 Contribution

Si tu veux contribuer au projet :

1. **Fais une copie** du projet (fork)
2. **Crée une branche** pour ta fonctionnalité
3. **Teste bien** avant de proposer des changements
4. **Documente** tes modifications

---

## 📄 Licence

[À compléter selon ta licence]

---

## 👤 Auteur

[Ton nom ou organisation]

---

## 🙏 Remerciements

- **Supabase** pour l'infrastructure backend
- Tous les contributeurs du projet

---

## 📞 Support

Si tu as des questions ou des problèmes :

1. Vérifie la documentation dans `docs/`
2. Regarde les erreurs dans la console du navigateur (F12)
3. Contacte le développeur ou ouvre une issue

---

**Bon développement ! 🚀**

*Dernière mise à jour : 2024-12-29*

