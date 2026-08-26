---
name: verify-squadra-backend
description: Use when the user asks to verify, test, or check the SQUADRA backend/server/API ("teste le backend", "vérifie le serveur", "teste l'API", "verify-squadra backend"). Runs a non-destructive, curl-based check of server.js — static file serving and the /api/data read/write round-trip — with guaranteed cleanup of real data.
---

# Verify SQUADRA — Backend

Vérifie `server.js` uniquement (pas l'interface), via des appels HTTP directs (`curl`). Ne nécessite pas de navigateur. Rapide — à lancer après toute modification de `server.js`, des fonctions `load()`/`save()` dans `main.js`, ou de la structure des données.

## Prérequis

Le serveur doit tourner (`node server.js`, port 3000 par défaut). S'il ne répond pas sur `http://localhost:3000`, le démarrer en arrière-plan avant de continuer (charger nvm si besoin : `export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"`).

## Étapes

1. **Fichiers statiques** — vérifier que `GET /`, `GET /main.js`, `GET /styles/main.css` répondent `200`.
2. **Sauvegarde de sécurité** — `GET /api/data` et garder cette réponse en mémoire : c'est l'état réel de l'utilisateur, à restaurer impérativement à la fin.
3. **Round-trip d'écriture** — construire une copie des données récupérées à l'étape 2, y ajouter un consultant de test clairement identifiable (`name: "TEST_BACKEND_SKILL"`), l'envoyer en `POST /api/data`, puis refaire un `GET /api/data` et vérifier que le consultant de test est bien présent dans la réponse ET dans `data/consultants.json` sur disque.
4. **Robustesse basique** — envoyer un `POST /api/data` avec un corps JSON invalide, vérifier que le serveur répond une erreur `4xx` (pas un crash, pas une corruption des fichiers existants).
5. **Nettoyage obligatoire** — `POST /api/data` avec exactement les données sauvegardées à l'étape 2 (donc sans le consultant de test), puis `GET /api/data` pour confirmer que l'état est identique à celui de départ.

## Rapport

Lister chaque étape avec son résultat (OK / échec). Si une étape échoue, ne pas passer à la suivante tant que ce n'est pas compris. Si le nettoyage (étape 5) échoue, le signaler explicitement à l'utilisateur — une donnée de test pourrait être restée dans `data/consultants.json`.
