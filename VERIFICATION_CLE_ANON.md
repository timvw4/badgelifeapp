# Vérification de la clé anon - Guide étape par étape

## Problème actuel
Erreur 403 "new row violates row-level security policy" malgré les politiques RLS correctement configurées.

## Vérifications à faire dans Supabase

### 1. Vérifier la clé anon dans Supabase
1. Allez dans **Supabase Dashboard**
2. Cliquez sur **Settings** (⚙️) dans le menu de gauche
3. Cliquez sur **API**
4. Dans la section **Project API keys**, trouvez **anon public**
5. **Copiez cette clé**

### 2. Comparer avec config.js
1. Ouvrez votre fichier `config.js` dans votre projet
2. Comparez la valeur de `SUPABASE_ANON_KEY` avec la clé copiée dans Supabase
3. **Elles doivent être IDENTIQUES**

### 3. Si les clés sont différentes
- Remplacez la clé dans `config.js` par celle de Supabase
- Rechargez l'application
- Testez à nouveau

### 4. Vérifier les paramètres d'authentification
1. Dans Supabase, allez dans **Authentication** → **Settings**
2. Vérifiez que :
   - **Enable email signup** est activé (si vous utilisez l'email)
   - **Enable phone signup** est activé (si vous utilisez le téléphone)
   - Les autres paramètres sont correctement configurés

### 5. Vérifier les logs Supabase
1. Dans Supabase, allez dans **Logs** → **Postgres Logs**
2. Regardez les erreurs récentes
3. Cherchez des erreurs liées à RLS ou aux permissions

## Test de la clé anon

Si vous voulez tester si la clé anon fonctionne, vous pouvez essayer cette requête dans l'éditeur SQL :

```sql
-- Test avec la clé anon (remplacez les IDs par des valeurs réelles)
-- Cette requête devrait fonctionner si RLS est correctement configuré

INSERT INTO notifications (
  user_id, 
  type, 
  show_badge, 
  is_read, 
  badge_id, 
  suspicious_user_id
)
VALUES (
  '05987e83-b147-4f73-8c82-ec8007e168e4'::UUID,
  'suspicion_individual',
  true,
  false,
  'd092b299-6628-4161-af13-3929a40aadfc'::UUID,
  '13afe477-ecd9-4c4e-8962-d6621c973d4a'::UUID
)
RETURNING *;
```

**Note** : Cette requête s'exécute avec le rôle `postgres` (admin), donc elle contourne RLS. Si elle fonctionne, cela confirme que le problème vient de RLS/politiques, pas des données.

## Prochaines étapes

1. ✅ Vérifiez que les clés correspondent
2. ✅ Vérifiez les paramètres d'authentification
3. ✅ Regardez les logs Supabase
4. ✅ Testez l'insertion manuelle dans SQL Editor

Si tout est correct mais que l'erreur persiste, le problème peut venir de :
- La session utilisateur qui n'est pas correctement passée au client Supabase
- Un problème de timing (la session n'est pas encore chargée quand on crée la notification)
- Un problème avec la façon dont le client Supabase est initialisé

