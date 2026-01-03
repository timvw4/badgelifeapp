const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const logoSource = path.join(projectRoot, 'icons', 'logo.png');
const iconDest = path.join(projectRoot, 'ios', 'App', 'App', 'Assets.xcassets', 'AppIcon.appiconset', 'AppIcon-512@2x.png');
const contentsJsonPath = path.join(projectRoot, 'ios', 'App', 'App', 'Assets.xcassets', 'AppIcon.appiconset', 'Contents.json');

console.log('🎨 Configuration de l\'icône de l\'application...');

try {
  // Vérifier que le logo existe
  if (!fs.existsSync(logoSource)) {
    console.error('❌ Le fichier logo.png n\'existe pas dans icons/');
    process.exit(1);
  }

  // S'assurer que le dossier de destination existe
  const iconDir = path.dirname(iconDest);
  execSync(`mkdir -p "${iconDir}"`, { stdio: 'inherit' });

  // Copier le logo vers le dossier AppIcon avec cp (plus rapide que fs-extra pour les gros fichiers)
  console.log('📋 Copie de logo.png vers AppIcon...');
  execSync(`cp -f "${logoSource}" "${iconDest}"`, { stdio: 'inherit' });
  console.log('✅ Logo copié avec succès !');

  // Vérifier que Contents.json existe et est correct
  const contentsJson = {
    "images": [
      {
        "filename": "AppIcon-512@2x.png",
        "idiom": "universal",
        "platform": "ios",
        "size": "1024x1024"
      }
    ],
    "info": {
      "author": "xcode",
      "version": 1
    }
  };

  fs.writeFileSync(contentsJsonPath, JSON.stringify(contentsJson, null, 2));
  console.log('✅ Configuration AppIcon mise à jour !');

  console.log('\n✅ Icône de l\'application configurée avec logo.png');
  console.log('💡 Exécutez "npm run sync:ios" pour synchroniser les changements');
} catch (err) {
  console.error('❌ Erreur lors de la configuration de l\'icône:', err.message);
  process.exit(1);
}

