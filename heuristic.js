/**
 * Persona Expressions — détection d'émotion légère (français + anglais), 100 % locale.
 * Utilisée quand le classifieur de SillyTavern n'est pas disponible, ou en premier
 * quand le texte contient des indices clairs (mode « Auto »).
 */

export const EMOTIONS = [
    'admiration', 'amusement', 'anger', 'annoyance', 'approval', 'caring', 'confusion', 'curiosity',
    'desire', 'disappointment', 'disapproval', 'disgust', 'embarrassment', 'excitement', 'fear',
    'gratitude', 'grief', 'joy', 'love', 'nervousness', 'optimism', 'pride', 'realization', 'relief',
    'remorse', 'sadness', 'surprise', 'neutral',
];

/** Noms français affichés dans l'interface (les clés restent les labels anglais de SillyTavern). */
export const EMOTIONS_FR = {
    admiration: 'admiration', amusement: 'amusement', anger: 'colère', annoyance: 'agacement',
    approval: 'approbation', caring: 'bienveillance', confusion: 'confusion', curiosity: 'curiosité',
    desire: 'désir', disappointment: 'déception', disapproval: 'désapprobation', disgust: 'dégoût',
    embarrassment: 'embarras', excitement: 'excitation', fear: 'peur', gratitude: 'gratitude',
    grief: 'chagrin', joy: 'joie', love: 'amour', nervousness: 'nervosité', optimism: 'optimisme',
    pride: 'fierté', realization: 'prise de conscience', relief: 'soulagement', remorse: 'remords',
    sadness: 'tristesse', surprise: 'surprise', neutral: 'neutre',
};

/**
 * Lexique : [label, poids, alternatives regex]. Le texte est mis en minuscules et sans accents
 * avant la comparaison, donc écrire les motifs SANS accents.
 */
const LEXICON = [
    ['anger', 2, "furieu[xse]*|enerve[es]*|en colere|colere|rage|merde|putain|connard|connasse|degage|ferme[- ]la|je te deteste|je deteste|j'en ai marre|ras[- ]le[- ]bol|je (te )?hais|angry|furious|pissed|damn|fuck\\w*|shut up|i hate|bastard|asshole|stupid|idiot|imbecile|salaud|salope|ta gueule|enfoire"],
    ['annoyance', 1.5, "agace[es]*|ca m'enerve|chiant[es]*|saoule|relou|pfff+|ugh+|annoying|annoyed|tsk|rah+|bref|soupir|lourd|you again|vraiment\\?|seriously\\?"],
    ['joy', 1.5, "content[es]*|heureu[xse]*|joie|joyeu[xse]*|super|genial|trop bien|yay+|youpi|ravi[es]*|enchante[es]*|sourire|ca me fait plaisir|plaisir|happy|glad|great|awesome|wonderful|fantastic|delighted|nice|excellent|parfait|magnifique journee|j'adore ca"],
    ['amusement', 2, "mdr+|lol+|ptdr+|ha(ha)+|he(he)+|hi(hi)+|xd+|lmao|rofl|je rigole|marrant[es]*|drole|hilarant|funny|hilarious|mort de rire"],
    ['love', 2.5, "je t'aime|je t'adore|amour|mon coeur|mon ange|cheri[es]*|bisous?|calins?|love you|i love|darling|sweetheart|honey|babe|mon amour|ma belle|mon beau|adore[sz]? (te|vous)|kiss(es)?"],
    ['desire', 2, "envie de toi|j'ai envie|je te veux|desire|want you|i want|tentant|irresistible|craving|je meurs d'envie|seduisant|sexy|hot"],
    ['admiration', 2, "waouh|wahou|woah|wow+|magnifique|impressionnant[es]*|incroyable|bravo|felicitations|admire|amazing|impressive|stunning|bluffant|extraordinaire|splendide|chapeau|well done|brilliant"],
    ['approval', 0.8, "d'accord|ok(ay)?|oui|bien sur|exactement|tout a fait|carrement|ca marche|agreed?|sure|yes|yep|yeah|exactly|fine by me|deal|c'est bon|entendu|volontiers|avec plaisir|why not|pourquoi pas"],
    ['disapproval', 1.2, "non|nan|nope|pas d'accord|jamais|hors de question|impossible|certainement pas|no way|absolutely not|i disagree|i don't think so|n'importe quoi|c'est faux|mauvaise idee|bad idea|pas question"],
    ['caring', 2, "ca va\\?|tu vas bien|t'es sur\\?|inquiet pour toi|prends? soin|ne t'inquiete pas|ne t'en fais pas|je suis la|courage|repose[- ]toi|are you ok|are you okay|take care|don't worry|i'm here|i am here|es-tu blesse|tu as besoin|besoin d'aide|je m'occupe de toi|doucement"],
    ['confusion', 2, "je ne comprends pas|comprends? pas|je suis perdu[es]*|perdu[es]*|bizarre|comment ca|hein\\?|quoi\\?|euh+|huh|confused|don't understand|do not understand|i'm lost|que veux-tu dire|sens pas|what do you mean|c'est quoi ce"],
    ['curiosity', 1.5, "pourquoi|comment|qu'est[- ]ce|c'est quoi|raconte|dis[- ]moi|intrigue[es]*|curieu[xse]*|why|how|tell me|what is|what's|i wonder|je me demande|explique|explain|show me|montre[- ]moi|qui est|where|ou est|c'est qui"],
    ['disappointment', 2, "decu[es]*|deception|dommage|zut|tant pis|quel dommage|disappointed|too bad|bummer|je m'attendais a mieux|pas ce que j'esperais|ca m'a decu|dommage que|oh non"],
    ['disgust', 2.5, "degoutant[es]*|beurk|berk|ecoeurant[es]*|immonde|degueu\\w*|repugnant|gross|disgusting|ew+|yuck|nasty|revoltant|infect"],
    ['embarrassment', 2, "honte|gene[es]*|rougis|embarrasse[es]*|timide|awkward|embarrassed|mal a l'aise|trop gene|ridicule|je suis rouge|gener"],
    ['excitement', 2, "trop hate|j'ai hate|impatient[es]*|on y va|allez|excited|can't wait|cannot wait|let's go|lets go|vite vite|yes yes|hourra|c'est parti|go go go|enfin ca commence|j'ai trop envie"],
    ['fear', 2.5, "peur|effraye[es]*|terrifie[es]*|au secours|a l'aide|panique|flippe|aa+h+|help me|help!|scared|afraid|terrified|frightened|horrifie[es]*|cours|fuis|run!|monstre|j'ai la trouille|trouille"],
    ['gratitude', 2.5, "merci|remercie|reconnaissant[es]*|thanks?|thank you|thx|grateful|je te dois|gracias|c'est gentil|trop aimable|appreciate"],
    ['grief', 2.5, "deuil|il est mort|elle est morte|ils sont morts|je l'ai perdu[e]?|pleure|larmes|sanglot\\w*|je n'en peux plus|brise[es]*|devaste[es]*|mourning|sobbing|cry(ing)?|heartbroken|le coeur brise|desespoir|desespere[es]*|funerailles|enterrement"],
    ['nervousness', 2, "stresse[es]*|nerveu[xse]*|anxieu[xse]*|angoisse[es]*|j'ai peur que|inquiet[es]*|tremble|hesite|nervous|anxious|worried|stressed|je panique un peu|le trac|appréhende|apprehende|mal au ventre"],
    ['optimism', 2, "espoir|esperer?|ca va aller|positif|optimiste|confiance|tout ira bien|avenir|hope|it'll be fine|it will be fine|bright side|look forward|j'ai foi|croire en|ca ira|on va y arriver|we can do this|je suis sur que ca va"],
    ['pride', 2, "fier[es]*|fierte|j'ai reussi|victoire|j'ai gagne|je l'ai fait|proud|i did it|i won|achieved|accompli|mission accomplie|je suis le meilleur|champion"],
    ['realization', 2, "ah oui|ahh+|ah d'accord|je comprends|ca y est|je vois|maintenant je comprends|oh!|je realise|i see|now i get it|oh i see|aha+|eureka|it hits me|je viens de comprendre|tout s'explique|donc c'est ca|so that's why|ca fait tilt|ah ok"],
    ['relief', 2.5, "ouf+|soulage[es]*|enfin|heureusement|quel soulagement|phew+|finally|relieved|thank god|thank goodness|sauve[es]*|sain et sauf|c'est fini|plus de peur"],
    ['remorse', 2.5, "desole[es]*|pardon|excuse[sz]?[- ]moi|mes excuses|je m'excuse|regrette|ma faute|sorry|apologi[sz]e|my bad|forgive me|i regret|c'est de ma faute|je suis coupable|ashamed|pardonne[- ]moi"],
    ['sadness', 2, "triste[s]?|tristesse|deprime[es]*|malheureu[xse]*|seul[es]*|pleurer|cafard|sad|unhappy|lonely|depressed|miss you|tu me manques|manque[sz]? (beaucoup)?|vide|mal au coeur|je me sens mal|j'ai mal|chagrin|melancolie|morose|down|sans espoir|hopeless"],
    ['surprise', 2, "sans blague|serieux\\?|pas possible|what\\?!|oh mon dieu|oh my god|omg|oh la la|stupefait|surpris[es]*|surprise|incroyable\\?|tu plaisantes|no way|vraiment\\?!|c'est pas vrai|really\\?!|hein\\?!|whoa+|quoi\\?!"],
];

/** Emojis → [label, poids]. */
const EMOJI = {
    '😂': ['amusement', 3], '🤣': ['amusement', 3], '😆': ['amusement', 2.5], '😹': ['amusement', 2.5],
    '😄': ['joy', 3], '😁': ['joy', 3], '😀': ['joy', 3], '😃': ['joy', 3], '😊': ['joy', 2.5], '🙂': ['joy', 1.5], '😌': ['relief', 2],
    '🥰': ['love', 3], '😍': ['love', 3], '😘': ['love', 3], '❤️': ['love', 3], '❤': ['love', 3], '💕': ['love', 3], '💖': ['love', 3], '💗': ['love', 3], '😻': ['love', 3],
    '😏': ['desire', 2], '😈': ['desire', 2], '🔥': ['excitement', 1.5],
    '🤩': ['excitement', 3], '🎉': ['excitement', 2.5], '🥳': ['excitement', 3], '✨': ['admiration', 1.5], '👏': ['admiration', 2.5], '🤯': ['surprise', 2.5],
    '😮': ['surprise', 3], '😲': ['surprise', 3], '😯': ['surprise', 2], '😳': ['embarrassment', 3], '🙈': ['embarrassment', 2],
    '😢': ['sadness', 3], '😞': ['sadness', 2.5], '☹️': ['sadness', 2.5], '🙁': ['sadness', 2], '🥺': ['sadness', 2.5], '😔': ['sadness', 2.5], '💔': ['grief', 3], '😭': ['grief', 3],
    '😡': ['anger', 3], '😠': ['anger', 3], '🤬': ['anger', 3.5], '👿': ['anger', 2.5], '😤': ['annoyance', 2.5], '🙄': ['annoyance', 2.5], '😒': ['annoyance', 2],
    '😨': ['fear', 3], '😱': ['fear', 3], '😰': ['nervousness', 3], '😬': ['nervousness', 2.5], '😅': ['nervousness', 1.5],
    '🤢': ['disgust', 3], '🤮': ['disgust', 3.5], '😖': ['disgust', 1.5],
    '🤔': ['curiosity', 2], '😕': ['confusion', 2.5], '😵‍💫': ['confusion', 3], '🤨': ['confusion', 2],
    '🙏': ['gratitude', 3], '🤗': ['caring', 3], '😇': ['optimism', 1.5], '👍': ['approval', 2.5], '👌': ['approval', 2], '👎': ['disapproval', 3], '🙅': ['disapproval', 2.5],
    '😎': ['pride', 2], '💪': ['pride', 2.5], '😪': ['relief', 1.5], '😓': ['remorse', 1.5], '🥹': ['gratitude', 2.5],
};

/** Émoticônes ASCII → [label, poids]. */
const EMOTICONS = [
    [/(^|\s)[:;=]-?\)+(?=\s|$|[.,!?])/g, 'joy', 2],
    [/(^|\s)[:;=]-?d+(?=\s|$|[.,!?])/g, 'joy', 2.5],
    [/(^|\s)[:;=]-?\(+(?=\s|$|[.,!?])/g, 'sadness', 2],
    [/(^|\s)[:;=]'-?\((?=\s|$|[.,!?])/g, 'grief', 2.5],
    [/(^|\s)[:;=]-?[o0](?=\s|$|[.,!?])/g, 'surprise', 2],
    [/(^|\s)<3(?=\s|$|[.,!?])/g, 'love', 3],
    [/(^|\s)>:-?\((?=\s|$|[.,!?])/g, 'anger', 2.5],
    [/(^|\s)[:;=]-?[/\\](?=\s|$|[.,!?])/g, 'confusion', 1.5],
];

let compiled = null;

function compile() {
    if (compiled) return compiled;
    compiled = LEXICON.map(([label, weight, alts]) => [label, weight, new RegExp(`(?:^|[^a-z0-9])(?:${alts})(?![a-z0-9])`, 'g')]);
    return compiled;
}

/** Minuscules, sans accents, apostrophes normalisées, markup RP (*…*) conservé comme du texte. */
export function normalizeText(text) {
    return String(text ?? '')
        .replace(/[\u2018\u2019\u02BC`´]/g, "'")
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

/**
 * @param {string} text
 * @returns {{label: string, score: number, scores: Record<string, number>}}
 */
export function detectEmotion(text) {
    const raw = String(text ?? '');
    const scores = {};
    const add = (label, v) => { scores[label] = (scores[label] || 0) + v; };

    let norm = normalizeText(raw).replace(/[*_~"«»]/g, ' ');

    // Négations simples (français / anglais), traitées avant le lexique
    const negations = [
        [/(?:^|[^a-z])pas (?:tres |du tout |vraiment |trop )?(?:content|contente|heureux|heureuse|ravi|ravie|joyeux|joyeuse)(?![a-z])/g, 'sadness', 2],
        [/(?:^|[^a-z])(?:not|n't|never) (?:very |really |so )?(?:happy|glad|fine|ok|okay|good)(?![a-z])/g, 'sadness', 2],
        [/(?:^|[^a-z])pas d'accord(?![a-z])/g, 'disapproval', 2.5],
        [/(?:^|[^a-z])(?:i )?(?:don't|do not|dont) (?:agree|think so)(?![a-z])/g, 'disapproval', 2.5],
        [/(?:^|[^a-z])(?:ca )?(?:ne )?va pas(?![a-z])|(?:^|[^a-z])(?:pas |ne )(?:vais |va )?(?:bien|super|top)(?![a-z])/g, 'sadness', 1.5],
        [/(?:^|[^a-z])pas (?:tres |du tout |vraiment )?(?:fier|fiere)(?![a-z])/g, 'remorse', 2],
        [/(?:^|[^a-z])(?:ca )?(?:ne )?(?:me )?(?:plait|plais) pas(?![a-z])/g, 'disapproval', 2],
    ];
    for (const [re, label, w] of negations) {
        norm = norm.replace(re, () => { add(label, w); return ' '; });
    }

    for (const [label, weight, re] of compile()) {
        re.lastIndex = 0;
        const m = norm.match(re);
        if (m) add(label, weight * Math.min(m.length, 2));
    }

    // Emojis (sur le texte brut)
    for (const ch of Object.keys(EMOJI)) {
        if (raw.includes(ch)) {
            const [label, w] = EMOJI[ch];
            add(label, w);
        }
    }
    for (const [re, label, w] of EMOTICONS) {
        re.lastIndex = 0;
        if (re.test(norm)) add(label, w);
    }

    // Ponctuation / forme
    const trimmed = norm.trim();
    const bangs = (raw.match(/!/g) || []).length;
    if (/[?!]{2,}/.test(raw) && /\?!|!\?/.test(raw)) add('surprise', 1.5);
    if (bangs >= 2) {
        if (scores.anger) add('anger', 1);
        else if (scores.fear) add('fear', 1);
        else if (scores.joy || scores.excitement || scores.amusement) add('excitement', 1.2);
        else add('excitement', 0.6);
    }
    const letters = raw.replace(/[^A-Za-zÀ-ÿ]/g, '');
    if (letters.length >= 6 && raw.replace(/[^A-ZÀ-Ý]/g, '').length / letters.length > 0.7) {
        add(scores.joy || scores.excitement ? 'excitement' : 'anger', 1.2);
    }
    if (/\?\s*[*"]*\s*$/.test(raw.trim()) && !scores.confusion && !scores.curiosity) add('curiosity', 0.8);
    if (/(\.{3}|…)\s*[*"]*\s*$/.test(raw.trim())) { add('sadness', 0.4); add('nervousness', 0.4); }
    if (/^(salut|bonjour|bonsoir|coucou|hello|hi|hey)\b/.test(trimmed)) add('joy', 0.6);

    let label = 'neutral';
    let best = 0;
    // L'ordre de EMOTIONS sert de départage
    for (const e of EMOTIONS) {
        const v = scores[e] || 0;
        if (v > best + 1e-9) { best = v; label = e; }
    }
    return { label, score: best, scores };
}
