# Configuration Supabase Realtime

## 1. Activer Realtime via SQL Editor

Pour que Supabase Realtime fonctionne, vous devez activer la publication PostgreSQL pour la table `profiles`. **L'onglet "Replication" n'est pas la bonne section** - il faut utiliser le SQL Editor.

### Méthode 1 : Via SQL Editor (Recommandé)

1. **Connectez-vous à votre projet Supabase**
2. **Allez dans SQL Editor** (dans la barre latérale gauche)
3. **Créez une nouvelle requête** et exécutez ce SQL :

```sql
-- Activer la publication pour la table profiles
ALTER PUBLICATION supabase_realtime ADD TABLE profiles;
```

4. **Vérifiez que ça fonctionne** en exécutant :

```sql
-- Vérifier les tables publiées
SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
```

Vous devriez voir `profiles` dans la liste.

### Méthode 2 : Via l'interface (si disponible)

1. **Allez dans Database > Publications** (dans la barre latérale gauche)
2. **Cliquez sur `supabase_realtime`**
3. **Ajoutez la table `profiles`** à la publication

## 2. Vérifier les politiques RLS (Row Level Security)

Assurez-vous que les politiques RLS permettent la lecture des profils :
- Les utilisateurs doivent pouvoir lire les profils des autres (pour la communauté)
- Les utilisateurs doivent pouvoir mettre à jour leur propre profil

## 3. Comment ça fonctionne

Une fois activé, le code JavaScript écoutera automatiquement les changements sur la table `profiles` et mettra à jour l'interface en temps réel quand :
- Un utilisateur change son statut privé/public
- Un utilisateur met à jour son avatar
- Un utilisateur change son pseudo
- Les points de skills ou le rang changent

## Note importante

L'onglet "Replication" que vous voyez est pour la réplication vers des destinations externes (BigQuery, etc.), **pas pour Supabase Realtime**. Pour Realtime, utilisez le SQL Editor avec la commande `ALTER PUBLICATION`.

