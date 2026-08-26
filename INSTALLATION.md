# Installation de SQUADRA sur un nouvel ordinateur

Ce guide explique comment faire fonctionner SQUADRA après avoir copié le dossier du projet sur un autre Mac. À faire **une seule fois par ordinateur**.

## Pourquoi une installation est nécessaire

SQUADRA a besoin de **Node.js** pour tourner : c'est un programme qui permet d'exécuter le petit serveur local (`server.js`) qui affiche l'application et lit/écrit tes données. Ce n'est pas un fichier du projet — c'est un logiciel à part, propre à chaque ordinateur, comme Photoshop ou Word.

## Étape 1 — Vérifier si Node.js est déjà installé

Ouvre l'application **Terminal** (Cmd + Espace, tape "Terminal", Entrée), puis tape :

```bash
node -v
```

- Si ça affiche un numéro de version (ex : `v24.19.0`) → Node.js est déjà installé, passe directement à l'**Étape 3**.
- Si ça affiche `command not found` → continue à l'Étape 2.

## Étape 2 — Installer Node.js

On installe Node.js via **nvm** (Node Version Manager), sans Homebrew et sans mot de passe administrateur.

**2.1 — Installer nvm**

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
```

**2.2 — Fermer puis rouvrir le Terminal** (pour que la commande `nvm` soit reconnue), ou exécuter directement :

```bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
```

**2.3 — Installer Node.js**

```bash
nvm install --lts
```

**2.4 — Vérifier que ça a fonctionné**

```bash
node -v
```

Un numéro de version doit s'afficher (ex : `v24.19.0`).

## Étape 3 — Lancer SQUADRA

Dans le Terminal, va dans le dossier du projet (remplace le chemin par l'emplacement réel sur cet ordinateur) :

```bash
cd chemin/vers/le/dossier/Softeam_SQUADRA
node server.js
```

Le Terminal doit afficher :

```
SQUADRA disponible sur http://localhost:3000
```

Ouvre ensuite [http://localhost:3000](http://localhost:3000) dans ton navigateur — l'application s'affiche.

**Pour arrêter l'application** : reviens sur la fenêtre du Terminal et appuie sur `Ctrl + C`.

## À savoir

- Tant que le Terminal reste ouvert avec `node server.js` lancé, l'app reste accessible dans le navigateur. Si tu fermes le Terminal, il faut refaire l'Étape 3 pour la relancer.
- Tes données réelles vivent dans le dossier `data/` (fichiers `consultants.json` et `prestations.json`), séparées de l'outil. Si tu copies le dossier du projet en incluant `data/`, tes données viennent avec.
- Ce dossier `data/` n'est jamais envoyé sur Git ni ailleurs — il reste uniquement sur les ordinateurs où tu l'as toi-même copié.
