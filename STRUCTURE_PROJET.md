# Structure du projet BadgeLife

## 📁 Structure actuelle

```
site web/
│
├── 📄 FICHIERS PRINCIPAUX
│   ├── index.html                    # Page principale de l'application
│   ├── admin.html                    # Page d'administration
│   ├── styles.css                    # Styles CSS (couleurs, mise en page)
│   ├── README.md                     # Documentation principale
│   └── STRUCTURE_PROJET.md          # Ce fichier
│
├── ⚙️ FICHIERS JAVASCRIPT
│   ├── app.js                        # Fichier principal - logique de l'application
│   ├── admin.js                      # Logique de la page d'administration
│   ├── config.js                     # Configuration Supabase (URL, clés)
│   ├── utils.js                      # Fonctions utilitaires partagées
│   │
│   ├── badgeCalculations.js          # Calculs des rangs et points
│   ├── badgeSuspicions.js            # Gestion des soupçons de badges
│   │
│   ├── subscriptions.js             # Logique métier des abonnements
│   ├── subscriptionUI.js             # Interface utilisateur des abonnements
│   ├── subscriptionNotifications.js  # Création des notifications
│   └── notificationUI.js             # Affichage des notifications
│
├── 📁 icons/                          # Images et icônes
│   ├── logobl.png
│   ├── logobadgelifeB.png
│   ├── tavieenbadge.png
│   ├── badge.png
│   ├── community.png
│   ├── profile.png
│   └── wheel.png
│
├── 📁 docs/                           # Documentation
│   ├── RAPPORT_ANALYSE_NOTIFICATIONS.md
│   ├── ANALYSE_FICHIERS_REDONDANTS.md
│   ├── GUIDE_SANTE_PROJET.md
│   ├── GUIDE_STRUCTURE_SIMPLE.md
│   └── notes/
│       └── moi.txt                    # Notes personnelles
│
└── 📁 sql/                            # Scripts SQL
    ├── migrations/
    │   └── fix_notification_suspicion_indexes.sql
    └── test_notification_creation.sql
```

---

## 📊 Statistiques du projet

- **Fichiers JavaScript** : 11 fichiers
- **Fichiers HTML** : 2 fichiers
- **Fichiers CSS** : 1 fichier
- **Fichiers de documentation** : 5 fichiers
- **Scripts SQL** : 2 fichiers
- **Images** : 7 fichiers

---

## 🔗 Dépendances entre fichiers

### Flux principal

```
index.html
  └─> app.js
      ├─> config.js
      ├─> utils.js
      ├─> badgeCalculations.js
      ├─> badgeSuspicions.js
      ├─> subscriptions.js
      ├─> subscriptionUI.js
      ├─> subscriptionNotifications.js
      └─> notificationUI.js
```

### Flux admin

```
admin.html
  └─> admin.js
      ├─> config.js
      └─> utils.js
```

---

## 📝 Notes importantes

### Fichiers supprimés

- ✅ `subscriptionHelpers.js` - Supprimé (fichier inutilisé, fonctionnalité dupliquée)

### Fichiers organisés

- ✅ Documentation déplacée dans `docs/`
- ✅ Scripts SQL organisés dans `sql/`
- ✅ Notes personnelles déplacées dans `docs/notes/`

### Fichiers à la racine

Les fichiers JavaScript restent à la racine car ils sont importés directement par les fichiers HTML. C'est la structure standard pour une application web simple.

---

## 🎯 Points d'entrée

### Pour les utilisateurs
- **`index.html`** → Page principale de l'application

### Pour les administrateurs
- **`admin.html`** → Page d'administration

### Pour les développeurs
- **`README.md`** → Documentation complète
- **`docs/GUIDE_STRUCTURE_SIMPLE.md`** → Guide simplifié pour débutants
- **`docs/GUIDE_SANTE_PROJET.md`** → Guide de maintenance

---

## 🔧 Maintenance

### Fichiers à modifier pour...

**Changer l'apparence** :
- `styles.css` → Tous les styles visuels

**Ajouter une fonctionnalité** :
- `app.js` → Logique principale
- `index.html` → Structure de la page

**Modifier la configuration** :
- `config.js` → Configuration Supabase

**Changer les abonnements** :
- `subscriptions.js` → Logique métier
- `subscriptionUI.js` → Interface utilisateur

**Modifier les notifications** :
- `subscriptionNotifications.js` → Création
- `notificationUI.js` → Affichage

---

*Structure mise à jour le : 2024-12-29*

