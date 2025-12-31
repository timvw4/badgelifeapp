# Guide pour publier BadgeLife sur l'App Store

## 📱 Vue d'ensemble

Pour publier votre application web sur l'App Store, vous devez la convertir en application native iOS en utilisant **Capacitor** (recommandé) ou **Cordova**.

## 🚀 Étape 1 : Préparer le projet

### 1.1 Créer un package.json

Créez un fichier `package.json` à la racine de votre projet :

```json
{
  "name": "badgelife",
  "version": "1.0.0",
  "description": "BadgeLife - Ta vie en badge",
  "main": "index.html",
  "scripts": {
    "build": "echo 'Build completed'",
    "serve": "npx http-server . -p 8080"
  },
  "keywords": [],
  "author": "",
  "license": "ISC",
  "dependencies": {},
  "devDependencies": {}
}
```

### 1.2 Installer Node.js et npm

Si ce n'est pas déjà fait, installez Node.js depuis [nodejs.org](https://nodejs.org/)

## 📦 Étape 2 : Installer Capacitor

### 2.1 Installation globale

```bash
npm install -g @capacitor/cli
```

### 2.2 Initialiser Capacitor dans votre projet

```bash
cd "/Users/timvw/Desktop/site web"
npm init -y
npm install @capacitor/core @capacitor/cli
npx cap init
```

Lors de l'initialisation, vous devrez répondre à :
- **App name**: BadgeLife
- **App ID**: com.badgelife.app (ou votre propre ID)
- **Web dir**: . (point, car vos fichiers sont à la racine)

### 2.3 Ajouter la plateforme iOS

```bash
npm install @capacitor/ios
npx cap add ios
```

## 🍎 Étape 3 : Configuration iOS

### 3.1 Ouvrir le projet dans Xcode

```bash
npx cap open ios
```

Cela ouvrira Xcode avec votre projet iOS.

### 3.2 Configurer l'App ID et le Bundle Identifier

Dans Xcode :
1. Sélectionnez le projet dans le navigateur
2. Allez dans l'onglet "Signing & Capabilities"
3. Configurez votre **Team** (votre compte développeur Apple)
4. Vérifiez que le **Bundle Identifier** est unique (ex: `com.badgelife.app`)

### 3.3 Configurer les icônes et splash screens

Dans Xcode :
1. Dans `App/App/Assets.xcassets`, ajoutez vos icônes :
   - AppIcon : 1024x1024px (requis pour l'App Store)
   - Différentes tailles pour l'appareil

2. Pour les splash screens, utilisez vos images existantes dans le dossier `icons/`

### 3.4 Configurer les permissions

Si votre app utilise :
- **Notifications** : Ajoutez dans `Info.plist` les permissions nécessaires
- **Caméra** : Pour les photos de profil
- **Stockage** : Pour sauvegarder les données

## 🔧 Étape 4 : Configuration Capacitor

### 4.1 Créer capacitor.config.ts

Créez un fichier `capacitor.config.ts` à la racine :

```typescript
import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.badgelife.app',
  appName: 'BadgeLife',
  webDir: '.',
  server: {
    androidScheme: 'https'
  },
  ios: {
    contentInset: 'automatic'
  }
};

export default config;
```

### 4.2 Synchroniser les fichiers

Après chaque modification de votre code web :

```bash
npx cap sync ios
```

## 📝 Étape 5 : Adapter le code pour iOS

### 5.1 Gérer les chemins de fichiers

Dans votre code, utilisez des chemins relatifs ou absolus corrects pour iOS.

### 5.2 Tester sur simulateur

```bash
npx cap run ios
```

Ou ouvrez Xcode et lancez sur un simulateur.

## 🏪 Étape 6 : Préparer pour l'App Store

### 6.1 Créer un compte développeur Apple

1. Allez sur [developer.apple.com](https://developer.apple.com)
2. Créez un compte développeur (99$/an)
3. Acceptez les accords

### 6.2 Configurer App Store Connect

1. Connectez-vous à [appstoreconnect.apple.com](https://appstoreconnect.apple.com)
2. Créez une nouvelle app :
   - **Nom** : BadgeLife
   - **Langue principale** : Français
   - **Bundle ID** : Celui configuré dans Xcode
   - **SKU** : Identifiant unique (ex: badgelife-001)

### 6.3 Créer un certificat de distribution

Dans Xcode :
1. Allez dans **Product > Archive**
2. Xcode créera automatiquement un certificat de distribution
3. Suivez les instructions pour valider l'archive

### 6.4 Préparer les métadonnées

Dans App Store Connect, préparez :
- **Description** : Description de votre app
- **Mots-clés** : Mots-clés pour la recherche
- **Captures d'écran** : 
  - iPhone 6.7" (1290 x 2796 pixels)
  - iPhone 6.5" (1242 x 2688 pixels)
  - iPhone 5.5" (1242 x 2208 pixels)
- **Icône** : 1024x1024px
- **Avis de confidentialité** : URL de votre politique de confidentialité

### 6.5 Soumettre pour révision

1. Dans Xcode, archivez votre app
2. Téléversez vers App Store Connect
3. Dans App Store Connect, soumettez pour révision

## ⚠️ Points importants

### Configuration Supabase

Assurez-vous que votre configuration Supabase fonctionne en production :
- Vérifiez les URLs dans `config.js`
- Configurez les domaines autorisés dans Supabase
- Testez l'authentification sur un appareil réel

### Performance

- Optimisez les images
- Minimisez les requêtes réseau
- Testez la connexion hors ligne si nécessaire

### Sécurité

- Ne commitez jamais vos clés API
- Utilisez des variables d'environnement
- Configurez correctement les permissions iOS

## 📚 Ressources utiles

- [Documentation Capacitor](https://capacitorjs.com/docs)
- [Guide Apple App Store](https://developer.apple.com/app-store/review/guidelines/)
- [Xcode Documentation](https://developer.apple.com/xcode/)

## 🔄 Workflow de développement

1. Développez votre app web normalement
2. Testez dans le navigateur
3. Exécutez `npx cap sync ios` pour synchroniser
4. Testez sur simulateur/device : `npx cap run ios`
5. Archivez et soumettez quand prêt

## 💡 Alternatives

Si Capacitor est trop complexe, vous pouvez aussi :
- **PWA (Progressive Web App)** : Publier comme PWA (pas sur App Store mais installable)
- **Cordova** : Alternative plus ancienne à Capacitor
- **React Native** : Si vous voulez réécrire en natif (beaucoup plus de travail)

---

**Note** : Le processus complet peut prendre plusieurs semaines, surtout la première fois. Prévoyez du temps pour les révisions Apple.

