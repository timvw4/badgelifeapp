# Guide de structure simple - Pour débutants

## 🎯 Vue d'ensemble

Ce guide explique de manière très simple comment le projet est organisé et à quoi sert chaque fichier.

---

## 📂 Organisation des dossiers

```
site web/
│
├── 📄 Fichiers principaux (à la racine)
│   ├── index.html          → Page principale
│   ├── admin.html          → Page admin
│   ├── styles.css          → Styles visuels
│   └── README.md           → Ce fichier d'aide
│
├── ⚙️ Fichiers JavaScript (à la racine)
│   ├── app.js              → Cerveau principal
│   ├── config.js           → Configuration
│   └── ... (autres fichiers JS)
│
├── 📁 icons/               → Images et icônes
├── 📁 docs/                → Documentation
└── 📁 sql/                 → Scripts base de données
```

---

## 🔍 À quoi sert chaque fichier ?

### Fichiers HTML (pages web)

| Fichier | Rôle | Quand le modifier |
|---------|------|-------------------|
| `index.html` | Page principale de l'app | Pour changer la structure de la page |
| `admin.html` | Page d'administration | Pour changer la page admin |

### Fichiers JavaScript principaux

| Fichier | Rôle | Quand le modifier |
|---------|------|-------------------|
| `app.js` | **Le plus important** - Gère tout | Pour ajouter des fonctionnalités principales |
| `config.js` | Configuration Supabase | Pour changer les clés de connexion |
| `admin.js` | Logique de la page admin | Pour modifier le comportement admin |
| `utils.js` | Fonctions utiles partagées | Pour ajouter des fonctions communes |

### Fichiers JavaScript spécialisés

| Fichier | Rôle | Quand le modifier |
|---------|------|-------------------|
| `badgeCalculations.js` | Calcule rangs et points | Pour changer le système de rangs |
| `badgeSuspicions.js` | Gère les soupçons | Pour modifier la logique des soupçons |
| `subscriptions.js` | Gère les abonnements | Pour changer comment fonctionnent les abonnements |
| `subscriptionUI.js` | Interface des abonnements | Pour changer l'affichage des abonnements |
| `subscriptionNotifications.js` | Crée les notifications | Pour modifier la création de notifications |
| `notificationUI.js` | Affiche les notifications | Pour changer l'affichage des notifications |

### Fichiers CSS

| Fichier | Rôle | Quand le modifier |
|---------|------|-------------------|
| `styles.css` | Tous les styles visuels | Pour changer les couleurs, tailles, etc. |

---

## 🗂️ Dossiers

### `icons/`
Contient toutes les images et icônes utilisées dans l'application.

**Exemples** :
- `logobl.png` → Logo principal
- `logobadgelifeB.png` → Logo BadgeLife
- `badge.png` → Icône de badge
- etc.

### `docs/`
Contient toute la documentation technique du projet.

**Fichiers** :
- `RAPPORT_ANALYSE_NOTIFICATIONS.md` → Analyse des notifications
- `ANALYSE_FICHIERS_REDONDANTS.md` → Analyse des fichiers
- `GUIDE_SANTE_PROJET.md` → Guide de maintenance
- `GUIDE_STRUCTURE_SIMPLE.md` → Ce fichier
- `notes/` → Notes personnelles

### `sql/`
Contient les scripts SQL pour la base de données.

**Structure** :
- `migrations/` → Scripts de migration (à exécuter dans Supabase)
- `test_notification_creation.sql` → Script de test

---

## 🎨 Comment modifier l'apparence ?

### Changer les couleurs

1. Ouvre `styles.css`
2. Cherche `--primary-color` (couleur principale)
3. Change la valeur (ex: `#6366f1` → `#ff0000`)

### Changer les polices

1. Ouvre `styles.css`
2. Cherche `font-family`
3. Change la police (ex: `'Inter'` → `'Arial'`)

### Changer les images

1. Remplace les fichiers dans `icons/`
2. Garde le même nom de fichier
3. Ou change le nom dans `index.html` et `styles.css`

---

## ⚙️ Comment ajouter une fonctionnalité ?

### Exemple : Ajouter un bouton "Partager"

1. **Dans `index.html`** : Ajoute le bouton HTML
   ```html
   <button id="share-btn">Partager</button>
   ```

2. **Dans `app.js`** : Ajoute la logique
   ```javascript
   const shareBtn = document.getElementById('share-btn');
   shareBtn.addEventListener('click', () => {
     // Code pour partager
   });
   ```

3. **Dans `styles.css`** : Ajoute les styles
   ```css
   #share-btn {
     background: blue;
     color: white;
   }
   ```

---

## 🔗 Comment les fichiers communiquent entre eux ?

### Flux principal

```
index.html
    ↓ (importe)
app.js
    ↓ (importe)
config.js, subscriptions.js, notificationUI.js, etc.
    ↓ (utilise)
Supabase (base de données)
```

### Exemple concret

1. **`index.html`** charge `app.js` : `<script src="./app.js">`
2. **`app.js`** importe `config.js` : `import { SUPABASE_URL } from './config.js'`
3. **`app.js`** importe `subscriptions.js` : `import * as Subscriptions from './subscriptions.js'`
4. **`subscriptions.js`** utilise Supabase pour récupérer les données

---

## 📝 Conseils pour débutants

### Par où commencer ?

1. **Commence par `index.html`** : Vois la structure de la page
2. **Regarde `app.js`** : Comprends comment tout fonctionne
3. **Explore les autres fichiers** : Chaque fichier a un rôle précis

### Comment déboguer ?

1. **Ouvre la console** : Appuie sur F12 dans le navigateur
2. **Regarde les erreurs** : Elles sont en rouge
3. **Utilise `console.log()`** : Pour voir ce qui se passe
   ```javascript
   console.log('Ma variable:', maVariable);
   ```

### Comment tester ?

1. **Ouvre l'application** dans le navigateur
2. **Teste chaque fonctionnalité** : Connexion, création de badge, etc.
3. **Vérifie la console** : Pas d'erreurs en rouge

---

## 🆘 Besoin d'aide ?

1. **Lis le README.md** : Instructions complètes
2. **Regarde la documentation** : Dans `docs/`
3. **Vérifie la console** : Les erreurs sont souvent explicites
4. **Cherche dans le code** : Utilise Ctrl+F pour trouver des mots-clés

---

**Bon courage ! 💪**

*Guide créé pour faciliter la compréhension du projet*

