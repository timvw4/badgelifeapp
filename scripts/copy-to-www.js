const fs = require('fs-extra');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const wwwDir = path.join(projectRoot, 'www');

const filesToCopy = [
  'index.html',
  'admin.html',
  'app.js',
  'admin.js',
  'badgeCalculations.js',
  'badgeSuspicions.js',
  'config.js',
  'utils.js',
  'notifications.js',
  'notificationUI.js',
  'subscriptions.js',
  'subscriptionUI.js',
  'styles.css'
];

const foldersToCopy = [
  'icons',
  'sql'
];

async function copyToWww() {
  console.log('📦 Copie des fichiers vers www...');

  try {
    // Créer le dossier www s'il n'existe pas
    await fs.ensureDir(wwwDir);

    // Copier les fichiers individuels
    for (const file of filesToCopy) {
      const sourcePath = path.join(projectRoot, file);
      const destPath = path.join(wwwDir, file);
      
      // Vérifier que le fichier source existe
      if (await fs.pathExists(sourcePath)) {
        try {
          await fs.copy(sourcePath, destPath, { overwrite: true });
          console.log(`✅ ${file}`);
        } catch (err) {
          console.error(`❌ Erreur lors de la copie de ${file}:`, err.message);
        }
      } else {
        console.warn(`⚠️  ${file} n'existe pas, ignoré`);
      }
    }

    // Copier les dossiers
    for (const folder of foldersToCopy) {
      const sourcePath = path.join(projectRoot, folder);
      const destPath = path.join(wwwDir, folder);
      
      if (await fs.pathExists(sourcePath)) {
        try {
          await fs.copy(sourcePath, destPath, { overwrite: true });
          console.log(`✅ ${folder}/`);
        } catch (err) {
          console.error(`❌ Erreur lors de la copie de ${folder}:`, err.message);
        }
      } else {
        console.warn(`⚠️  ${folder} n'existe pas, ignoré`);
      }
    }

    console.log('\n✅ Copie terminée !');
    console.log('💡 Exécutez "npm run sync:ios" pour synchroniser avec iOS');
  } catch (err) {
    console.error('❌ Erreur lors de la copie des fichiers:', err);
    process.exit(1);
  }
}

copyToWww();
