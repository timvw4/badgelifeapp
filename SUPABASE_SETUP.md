# Configuration Supabase pour la fonctionnalité Profil Privé/Public

## Ajout de la colonne `is_private`

Pour que la fonctionnalité "Profil: Privé/Public" fonctionne, vous devez ajouter une colonne `is_private` dans la table `profiles` de Supabase.

### Étapes :

1. **Connectez-vous à votre projet Supabase**
2. **Allez dans l'éditeur SQL** (Table Editor > SQL Editor)
3. **Exécutez cette requête SQL** :

```sql
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS is_private BOOLEAN DEFAULT false;
```

### Vérification :

Après avoir exécuté la requête, vérifiez que la colonne existe :
- Allez dans Table Editor > profiles
- La colonne `is_private` devrait apparaître avec une valeur par défaut `false` (profil public)

### Note :

- Si la colonne n'existe pas, le code gérera automatiquement l'erreur et affichera un message
- Par défaut, tous les profils existants seront publics (`is_private = false`)
- Les nouveaux profils seront également publics par défaut

