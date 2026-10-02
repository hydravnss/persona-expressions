# Persona Expressions — extension SillyTavern

Le même principe que l'extension intégrée **Character Expressions**, mais pour **toi** : quand tu envoies un message, un sticker de **ton persona** apparaît selon l'émotion de ton message (joie, colère, tristesse…).

- Un jeu de sprites **par persona** (28 émotions + une image par défaut), ou une **image unique** par persona.
- Détection de l'émotion : heuristique locale **français + anglais + emojis** (sans réseau), classifieur de SillyTavern si tu l'as activé, ou LLM de ton API actuelle (au choix).
- Sticker **indépendant** de Character Expressions (`#persona-expression-holder`) : les deux fonctionnent en même temps.
- Placement **libre** : curseurs 0–100 %, coordonnées en pixels, glisser-déposer au doigt sur tout l'écran.
- Interface en français, pensée pour mobile (iPhone Safari).

> Testé sur SillyTavern 1.19.0 avec l'émulation WebKit iPhone 14 Pro (Playwright). **Pas testé sur un vrai iPhone.**

## Installation

1. Dans SillyTavern : **Extensions** (icône des cubes) → **Install extension**.
2. Colle l'URL du dépôt :
   ```
   https://github.com/hydravnss/persona-expressions
   ```
3. Valide, puis recharge la page. Le panneau **Persona Expressions** apparaît dans la liste des extensions.

Mises à jour : bouton « Manage extensions » → mettre à jour (l'extension est en `auto_update`).

## Ajouter des sprites

1. **Extensions → Persona Expressions → Sprites par persona**.
2. Choisis le **persona** dans la liste (★ = persona actuel).
3. Pour chaque émotion, touche le bouton **↑ (Téléverser)** et choisis une image (PNG transparent recommandé, WebP/JPEG/GIF acceptés). **🗑** efface. Toucher la vignette l'affiche à l'écran (persona actuel).
4. **Importer plusieurs images** : sélectionne plusieurs fichiers d'un coup ; le **nom du fichier doit être l'émotion** (`joy.png`, `anger.webp`, `neutral.png`…). `default.png` = image par défaut.
5. **Mode simple** : coche « une seule image pour ce persona » → seule l'image « Image unique » est utilisée, quelle que soit l'émotion.

Émotions (les mêmes 28 que Character Expressions) : admiration, amusement, anger, annoyance, approval, caring, confusion, curiosity, desire, disappointment, disapproval, disgust, embarrassment, excitement, fear, gratitude, grief, joy, love, nervousness, optimism, pride, realization, relief, remorse, sadness, surprise, neutral.

**Chaîne de repli** : image de l'émotion → image de l'« émotion de repli » (par défaut `neutral`) → image **par défaut** → avatar du persona (option) → rien (le sticker se masque).

Les images de plus de 1024 px sont réduites automatiquement avant l'envoi.

### Où sont stockés les sprites ?

L'API `/api/sprites/*` de SillyTavern est réservée aux dossiers de **personnages**. Les sprites de persona sont donc envoyés via `POST /api/files/upload` dans le dossier utilisateur `data/<utilisateur>/user/files/` (servi sur `/user/files/…`), avec des noms du type `pexp_<persona>_<hash>_<émotion>_<horodatage>.png`. Seuls ces **noms de fichiers** sont enregistrés dans `extension_settings.persona_expressions.personas[<fichier avatar du persona>].sprites[<émotion>]`, donc dans `settings.json` : les sprites suivent tes sauvegardes/synchronisations d'utilisateur et ne dépendent pas du dossier de l'extension (qui est écrasé à chaque mise à jour).

## Détection de l'émotion

| Mode | Fonctionnement |
|---|---|
| **Auto** (défaut) | Heuristique FR/EN/emojis ; si le texte n'est pas assez clair **et** que « Character Expressions » est réglé sur le classifieur local/Extras, on demande le classifieur de ST (`getExpressionLabel`). Sinon, l'heuristique décide. |
| Heuristique | Uniquement la détection locale (mots-clés FR/EN, emojis, émoticônes, ponctuation, MAJUSCULES). |
| Classifieur ST | `POST /api/extra/classify` (modèle anglais de ST), repli sur l'heuristique s'il est indisponible. Peu fiable sur du français. |
| LLM | `generateRaw` sur l'API actuelle avec un prompt modifiable (`{{labels}}`), repli sur l'heuristique. Coûte un appel par message. |

Le champ « Texte à analyser » du panneau permet de tester la détection.

L'émotion détectée est mémorisée dans le message (`extra.persona_expression`) et restaurée au rechargement du chat (option).

## Quand le sticker change-t-il ?

- À l'envoi d'un message **utilisateur** (`MESSAGE_SENT` / `USER_MESSAGE_RENDERED`) — jamais pour les messages du bot.
- Au changement de **persona** (y compris persona verrouillé par chat) : sprite « neutre » du nouveau persona.
- Au changement de chat (émotion du dernier message utilisateur, sinon neutre).
- Pour les discussions de **groupe** (option activable/désactivable).

## Commandes

- `/persona-emote joy` (alias `/pemote`) — force l'émotion. `reset` = retour à l'émotion de repli, `hide` / `show` pour masquer/afficher.
- `/persona-emote-detect Je suis trop content !` — renvoie l'émotion détectée (`apply=true` pour l'afficher).
- **Sélecteur rapide** : menu baguette magique → « Émotion du persona », ou bouton « Sélecteur rapide » du panneau.

## Position et affichage

- **Position horizontale / verticale** : curseurs 0–100 % (précis au dixième) avec champs numériques. 0 % horizontal = bord gauche, 0 % vertical = **bas** de l'écran, 100 % = bord opposé (le sticker reste entièrement visible).
- **Coordonnées exactes (px)** : X depuis la gauche, Y depuis le bas.
- **Déplacer** : active le mode glisser-déposer ; ferme le panneau pour voir l'écran, glisse le sticker avec le doigt **n'importe où sur l'écran** (même grand), puis « ✔ Terminer le déplacement ».
- La position est enregistrée en pourcentage (cohérente en rotation / autre taille d'écran). **Réinitialiser la position** remet X = 0 %, Y = 14 %.
- Taille (50–500 px), opacité, retournement horizontal, animation (pop / fondu / glissement / aucune), masquage après N secondes, « toucher le sticker pour le masquer » (le sticker capte alors les taps), masquer si pas de sprite.
- **Couche** : *devant les bulles, sous la barre d'envoi* (défaut : le sticker passe sous la barre, il est recoupé à son bord) ou *derrière le chat* comme Character Expressions.
- Le sticker est un enfant direct de `<body>` en `position: fixed` : aucun wrapper transformé (par ex. `translateY(-12px)` d'un thème CSS) ne le décale. `pointer-events: none` hors mode déplacement : il ne bloque aucun tap.
- Il est compatible avec les zones sûres iOS (encoche / bords) pour la gauche, la droite et le haut.

## Dépannage

- Rien ne s'affiche : vérifie qu'un chat est ouvert, que le persona a au moins une image (ou active l'avatar de repli) et que « Masquer quand il n'y a pas de sprite » n'est pas la cause.
- Sticker caché derrière la barre d'envoi : monte-le (position verticale) ou cocher « Interdire de passer sous la barre d'envoi ».
- Les sprites d'un persona supprimé restent dans `user/files/` ; efface-les depuis le panneau avant de supprimer le persona (bouton « Tout effacer »).

## Licence

MIT
