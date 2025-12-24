# Analyse des duplications entre fichiers

## 🔍 Duplications identifiées

### 1. Fonction `pseudoToEmail()` - ⚠️ DUPLIQUÉE

**Fichiers concernés :**
- `app.js` (ligne 91-99)
- `admin.js` (ligne 16-24)

**Code dupliqué :**
```javascript
function pseudoToEmail(pseudo) {
  if (!pseudo) return '';
  const cleaned = pseudo
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '');
  return `${cleaned || 'user'}@badgelife.dev`;
}
```

**Utilisations :**
- `app.js` : lignes 505, 527 (connexion et inscription)
- `admin.js` : ligne 105 (connexion admin)

**Recommandation :** Déplacer dans `utils.js` et exporter pour partage entre les deux fichiers.

---

### 2. Fonction `isAdminUser()` - ⚠️ DUPLIQUÉE

**Fichiers concernés :**
- `app.js` (ligne 4409-4412)
- `admin.js` (ligne 214-217)

**Code dupliqué :**
```javascript
function isAdminUser(user) {
  if (!user || !user.id) return false;
  return Array.isArray(ADMIN_USER_IDS) && ADMIN_USER_IDS.includes(user.id);
}
```

**Utilisations :**
- `app.js` : lignes 516, 569, 758 (vérification des droits admin)
- `admin.js` : lignes 111, 190 (vérification des droits admin)

**Recommandation :** Déplacer dans `utils.js` et exporter pour partage entre les deux fichiers.

---

## ✅ Fonctions déjà partagées (pas de duplication)

### Fonctions dans `utils.js` (déjà partagées) :
- ✅ `parseBadgeAnswer()` - utilisée par app.js et admin.js
- ✅ `parseConfig()` - utilisée par app.js
- ✅ `safeSupabaseSelect()` - utilisée par app.js et admin.js

### Fonctions dans `badgeCalculations.js` (déjà partagées) :
- ✅ `isMysteryLevel()` - utilisée par app.js et admin.js
- ✅ `pickHighestLevel()` - utilisée par admin.js
- ✅ `extractSkillNumber()` - utilisée par admin.js
- ✅ `calculateMaxSkillPoints()` - utilisée par admin.js
- ✅ `calculateSkillsTotals()` - utilisée par admin.js (via wrapper)

**Note :** `admin.js` utilise un wrapper local pour `calculateSkillsTotals()` mais cela est acceptable car il adapte la fonction au contexte local.

---

## 📊 Résumé

| Fonction | Fichier 1 | Fichier 2 | Statut | Action recommandée |
|----------|-----------|-----------|--------|-------------------|
| `pseudoToEmail()` | app.js | admin.js | ⚠️ Dupliquée | Déplacer dans utils.js |
| `isAdminUser()` | app.js | admin.js | ⚠️ Dupliquée | Déplacer dans utils.js |

---

## 🔧 Plan d'action

1. **Ajouter `pseudoToEmail()` dans `utils.js`**
   - Exporter la fonction
   - Importer dans `app.js` et `admin.js`
   - Supprimer les définitions locales

2. **Ajouter `isAdminUser()` dans `utils.js`**
   - Exporter la fonction
   - Importer dans `app.js` et `admin.js`
   - Supprimer les définitions locales

3. **Vérifier les imports**
   - S'assurer que `ADMIN_USER_IDS` est accessible depuis `utils.js` (via import depuis config.js)

---

## ⚠️ Points d'attention

- `isAdminUser()` utilise `ADMIN_USER_IDS` qui est importé depuis `config.js`
- Il faudra importer `ADMIN_USER_IDS` dans `utils.js` pour que la fonction fonctionne
- Les deux fonctions sont simples et n'ont pas de dépendances complexes, donc le déplacement sera facile

