# 🚀 Démarrage rapide - App Store

## Commandes essentielles

### 1. Installation initiale

```bash
# Installer Node.js si pas déjà fait (depuis nodejs.org)

# Installer Capacitor globalement
npm install -g @capacitor/cli

# Installer les dépendances du projet
npm install

# Installer Capacitor et la plateforme iOS
npm install @capacitor/core @capacitor/cli @capacitor/ios
npx cap init
```

Lors de `npx cap init`, répondez :
- **App name**: BadgeLife
- **App ID**: com.badgelife.app
- **Web dir**: . (point)

### 2. Ajouter iOS

```bash
npx cap add ios
```

### 3. Ouvrir dans Xcode

```bash
npx cap open ios
```

### 4. Après chaque modification de code

```bash
npx cap sync ios
```

### 5. Tester sur simulateur

```bash
npx cap run ios
```

## ✅ Checklist avant soumission

- [ ] Compte développeur Apple créé (99$/an)
- [ ] App configurée dans App Store Connect
- [ ] Icône 1024x1024px prête
- [ ] Captures d'écran pour différentes tailles d'iPhone
- [ ] Description et mots-clés rédigés
- [ ] Politique de confidentialité (si nécessaire)
- [ ] Testé sur appareil réel
- [ ] Configuration Supabase vérifiée pour production

## 📱 Tailles d'icônes requises

- **App Store** : 1024x1024px (PNG, sans transparence)
- **App** : Xcode génère automatiquement les différentes tailles

## 🎨 Tailles de captures d'écran

- iPhone 6.7" : 1290 x 2796 pixels
- iPhone 6.5" : 1242 x 2688 pixels  
- iPhone 5.5" : 1242 x 2208 pixels

## ⚠️ Important

1. **Ne commitez JAMAIS** vos clés API Supabase dans le repo
2. Testez toujours sur un appareil réel avant de soumettre
3. Vérifiez que toutes les fonctionnalités fonctionnent hors ligne si nécessaire
4. Le processus de révision Apple peut prendre 1-7 jours

## 🆘 Problèmes courants

### "Command not found: cap"
```bash
npm install -g @capacitor/cli
```

### Erreur de signature dans Xcode
- Vérifiez que votre Team est configurée dans "Signing & Capabilities"
- Assurez-vous d'avoir un compte développeur Apple valide

### L'app ne se charge pas
- Vérifiez que `npx cap sync ios` a été exécuté
- Vérifiez les chemins dans `capacitor.config.ts`

## 📞 Besoin d'aide ?

Consultez le guide complet : `GUIDE_APP_STORE.md`

