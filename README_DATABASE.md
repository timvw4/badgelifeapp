# Guide de gestion de la base de données Supabase

Ce guide vous explique comment vérifier et maintenir votre base de données Supabase pour éviter les colonnes inutiles.

## 📋 Scripts disponibles

### 1. `check_database_structure.sql`
**Utilisation** : Vérifier la structure actuelle de votre base de données
- Liste toutes les colonnes de chaque table
- Indique si chaque colonne est utilisée dans le code (✅) ou potentiellement inutile (⚠️)
- **Exécuter en premier** pour voir l'état actuel

### 2. `complete_database_setup.sql`
**Utilisation** : Mettre à jour votre base de données avec toutes les colonnes nécessaires
- Ajoute toutes les colonnes manquantes de manière sûre (avec `IF NOT EXISTS`)
- Initialise les valeurs par défaut pour les utilisateurs existants
- Crée les tables `ideas` et `idea_votes` si elles n'existent pas
- **Exécuter si vous voulez vous assurer d'avoir toutes les colonnes nécessaires**

### 3. `cleanup_database.sql`
**Utilisation** : Supprimer les colonnes inutiles (⚠️ À utiliser avec précaution)
- Contient des exemples de suppression de colonnes
- **Ne pas exécuter directement** - décommenter et modifier selon vos besoins
- **Toujours vérifier avec `check_database_structure.sql` avant de supprimer**

## 🔍 Processus recommandé

### Étape 1 : Vérifier l'état actuel
```sql
-- Exécuter dans Supabase > SQL Editor
-- Copier-coller le contenu de check_database_structure.sql
```

### Étape 2 : Comparer avec les colonnes attendues

#### Table `profiles`
Colonnes attendues :
- `id` (uuid, PK)
- `username` (text)
- `badge_count` (integer)
- `avatar_url` (text, nullable)
- `skill_points` (integer)
- `rank` (text)
- `is_private` (boolean)
- `tokens` (integer)
- `last_token_date` (date, nullable)
- `created_at` (timestamptz)

#### Table `user_badges`
Colonnes attendues :
- `user_id` (uuid, FK)
- `badge_id` (uuid, FK)
- `success` (boolean)
- `level` (text, nullable)
- `user_answer` (text, nullable)
- `was_ever_unlocked` (boolean)
- `created_at` (timestamptz)

#### Table `badges`
Colonnes attendues :
- `id` (uuid, PK)
- `name` (text)
- `description` (text, nullable)
- `question` (text)
- `answer` (text)
- `emoji` (text, nullable)
- `theme` (text, nullable)
- `created_at` (timestamptz)

#### Table `ideas`
Colonnes attendues :
- `id` (uuid, PK)
- `user_id` (uuid, FK)
- `title` (text)
- `emoji` (text, nullable)
- `description` (text)
- `created_at` (timestamptz)

#### Table `idea_votes`
Colonnes attendues :
- `idea_id` (uuid, FK)
- `user_id` (uuid, FK)
- `vote` (integer: 1 ou -1)
- `created_at` (timestamptz)

### Étape 3 : Ajouter les colonnes manquantes
```sql
-- Exécuter complete_database_setup.sql
-- Ce script est sûr et n'écrasera pas les données existantes
```

### Étape 4 : Nettoyer les colonnes inutiles (optionnel)
```sql
-- 1. Vérifier d'abord avec check_database_structure.sql
-- 2. Identifier les colonnes marquées "⚠️ Potentiellement inutile"
-- 3. Vérifier dans votre code qu'elles ne sont vraiment pas utilisées
-- 4. Modifier cleanup_database.sql pour supprimer ces colonnes
-- 5. Exécuter avec précaution
```

## ⚠️ Précautions importantes

1. **Toujours faire une sauvegarde** avant de modifier la structure
2. **Tester en environnement de développement** avant la production
3. **Vérifier deux fois** qu'une colonne n'est pas utilisée avant de la supprimer
4. **Les scripts utilisent `IF NOT EXISTS`** pour éviter les erreurs si les colonnes existent déjà

## 🔄 Ordre d'exécution recommandé

1. **Première fois** : Exécuter `supabase_setup.sql` (si pas déjà fait)
2. **Vérification** : Exécuter `check_database_structure.sql`
3. **Mise à jour** : Exécuter `complete_database_setup.sql`
4. **Vérification finale** : Ré-exécuter `check_database_structure.sql` pour confirmer

## 📝 Notes

- Les scripts utilisent `ADD COLUMN IF NOT EXISTS` pour éviter les erreurs
- Les valeurs par défaut sont définies pour les nouvelles colonnes
- Les utilisateurs existants sont mis à jour avec des valeurs par défaut appropriées
- Les politiques RLS (Row Level Security) sont configurées pour les nouvelles tables

