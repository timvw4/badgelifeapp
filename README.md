# BadgeLife (front statique)

Site vitrine + logique front pour un mini réseau social de badges. Tout est en HTML/CSS/JS pur, hébergeable sur GitHub Pages, avec Supabase pour l’auth et les données publiques.

## 1. Prérequis
- Un compte gratuit Supabase.
- Un dépôt GitHub (pour Pages).
- Un éditeur et un navigateur récent.

## 2. Installer la base Supabase
1. Crée un projet Supabase.
2. Va dans `Project Settings > API` et note **SUPABASE_URL** et **anon public key**.
3. Va dans l’onglet **SQL** et exécute le fichier `supabase_setup.sql` de ce repo (copie/colle).
   - Cela crée les tables `profiles`, `badges`, `user_badges`, ajoute les politiques RLS et insère 3 badges prêts à l’emploi.

## 3. Renseigner les clés dans le front
1. Dans `config.js`, remplace les valeurs :
   ```js
   export const SUPABASE_URL = 'https://<ton-projet>.supabase.co';
   export const SUPABASE_ANON_KEY = '<ta-clef-anon>';
   ```
2. Sauvegarde. Le front parlera à Supabase directement depuis le navigateur.
3. Connexion/inscription se fait **sans email** : l’utilisateur saisit un pseudo et un mot de passe (pas de validation email côté front). Un alias technique `@badgelife.dev` est généré pour Supabase Auth.

## 4. Tester en local
- Ouvre simplement `index.html` dans ton navigateur (double-clic ou via une petite extension “Live Server”).
- Crée un compte avec **pseudo + mot de passe**, connecte-toi, débloque un badge en répondant à la question.

## 5. Déployer sur GitHub Pages
1. Initialise un dépôt Git dans ce dossier, commit, puis pousse vers GitHub.
2. Dans GitHub > Settings > Pages : source = `main` (ou `master`) + dossier racine `/`.
3. Une URL `https://<ton-user>.github.io/<repo>/` sera créée.
4. Dans Supabase > Auth > URL Allow List, ajoute cette URL (pour que l’auth accepte le domaine GitHub Pages).
5. Dans Supabase > Auth > Email, désactive la confirmation d’email (sinon Supabase tentera d’envoyer un mail vers l’alias factice).

## 6. Comment ça marche (très résumé)
- **Connexion / création de compte** : Supabase Auth.
- **Badges** : table `badges` en lecture publique.
- **Gagner un badge** : l’utilisateur répond à la question, le front vérifie la bonne réponse puis enregistre dans `user_badges` (limité à son propre compte par les politiques RLS).
- **Communauté** : liste les profils triés par nombre de badges.

## 7. Personnaliser
- Les badges actuels (avec niveaux) sont définis dans `supabase_setup.sql`. Pour en changer, modifie ce script ou insère directement dans la table `badges` (le champ `answer` peut contenir un petit JSON pour les niveaux / oui-non).
- Mets à jour les styles dans `styles.css`.
- Change le logo dans `icons/badgelife-logo.svg`.

## 8. Besoin d’aide rapide ?
- Si tu vois “Aucun badge” : vérifie que tu as exécuté `supabase_setup.sql`.
- Si l’auth ne marche pas sur GitHub Pages : ajoute bien l’URL de Pages dans Supabase (Allow List).

# badgelifeapp
