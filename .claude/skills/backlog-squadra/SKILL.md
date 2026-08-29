---
name: backlog-squadra
description: This skill should be used when the user asks to add something to the backlog ("ajoute X au backlog", "note ça pour plus tard"), mark a backlog item as done ("marque X comme fait", "c'est fait"), remove a backlog item, or review the backlog ("montre le backlog", "où en est le backlog", "qu'est-ce qu'il reste à faire"). Manages BACKLOG.md at the project root.
---

# Backlog SQUADRA

Gère le fichier `BACKLOG.md` à la racine du projet — une liste personnelle de sujets à traiter plus tard, qui ne fait pas partie de la documentation produit.

## Format du fichier

Deux sections fixes :

```markdown
## À faire

- [ ] **Titre court** — description en une phrase (pourquoi c'est là, contexte utile).

## Fait

- [x] **Titre court** — description en une phrase.
```

## Règle systématique — demander avant d'invoquer

Ne jamais invoquer ce skill pour ajouter un item sans confirmation explicite déjà obtenue dans la conversation. Ça inclut le cas où c'est Claude lui-même qui repère en cours de travail une limite/dette/idée qui mériterait le backlog (ex: une fonctionnalité laissée incomplète, un écart constaté) : poser la question en clair dans le fil ("je note ça au backlog ?") et attendre un "oui" avant d'invoquer le skill — jamais l'inverse (invoquer puis demander, ou invoquer directement). Même logique que pour un `git push` : une confirmation par action, jamais présumée à partir d'un accord précédent.

## Actions

**Ajouter un item** — uniquement quand l'utilisateur le demande explicitement (ne jamais ajouter un sujet de sa propre initiative, même s'il semble pertinent pendant une conversation). Ajouter une ligne sous `## À faire`, au format `- [ ] **Titre court** — description`. Ne jamais reformuler ou modifier les items déjà présents.

**Marquer comme fait** — retrouver la ligne correspondante sous `## À faire`, la déplacer sous `## Fait` en changeant `[ ]` en `[x]`. Ne pas laisser l'item dupliqué dans les deux sections.

**Supprimer un item** — seulement si l'utilisateur le demande explicitement (différent de "marquer comme fait" : une suppression retire complètement la ligne, sans trace dans `## Fait`).

**Consulter le backlog** — lire `BACKLOG.md` et présenter un résumé clair (pas un simple copier-coller brut du fichier), en distinguant ce qui reste à faire de ce qui est fait.
