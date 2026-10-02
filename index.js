/**
 * Persona Expressions — stickers d'émotion pour TES messages / TON persona.
 * Même principe que l'extension intégrée « Character Expressions », mais côté utilisateur.
 *
 * Stockage des sprites : fichiers uploadés via POST /api/files/upload (dossier utilisateur
 * `user/files/`, servi sur `/user/files/<nom>`). Seuls les NOMS de fichiers sont gardés dans
 * extension_settings.persona_expressions.personas[<avatar du persona>].sprites[<émotion>].
 * (L'API /api/sprites/* est réservée aux dossiers de personnages, d'où ce choix.)
 */
import { EMOTIONS, EMOTIONS_FR, detectEmotion } from './heuristic.js';

const MODULE_NAME = 'persona_expressions';
const LOG = '[Persona Expressions]';
const FILE_PREFIX = 'pexp_';
const DEFAULT_KEY = 'default'; // image par défaut / image unique
const DEFAULT_LLM_PROMPT = 'Ignore previous instructions. Classify the emotion of the last message. Output just one word, e.g. "joy" or "anger". Choose only one of the following labels: {{labels}}';
const HEURISTIC_CONFIDENT = 1.5;
const MAX_IMAGE_SIDE = 1024;

const defaultSettings = Object.freeze({
    enabled: true,
    groups: true,
    detection: 'auto', // auto | heuristic | classifier | llm
    llmPrompt: DEFAULT_LLM_PROMPT,
    fallback: 'neutral',
    avatarFallback: false,
    remember: true,
    size: 150,
    posX: 0,
    posY: 14,
    opacity: 100,
    flip: false,
    anim: 'pop', // pop | fade | slide | none
    hideAfter: 0,
    tapHide: false,
    hideNoSprite: true,
    aboveBar: false,
    layer: 'front', // front = devant les bulles, coupé par la barre d'envoi | behind = derrière le chat
    personas: {},
});

/** @type {any} */
let personasModule = null;
let settings = null;
let currentEmotion = 'neutral';
let shownKey = null;
let shownSrc = null;
let userHidden = false;
let timerHidden = false;
let hideTimer = null;
let moveMode = false;
let detectToken = 0;
let lastHandled = '';
let classifierDownUntil = 0;
let reopenToggles = [];
let selectedPersonaInPanel = null;

/* ------------------------------------------------------------------ utilitaires */

const ctx = () => SillyTavern.getContext();
const $ = (sel) => window.jQuery(sel);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const save = () => ctx().saveSettingsDebounced();
const labelFr = (l) => EMOTIONS_FR[l] || l;
const toast = (kind, msg) => { try { window.toastr?.[kind]?.(msg, 'Persona Expressions'); } catch { /* ignore */ } };

function loadSettings() {
    const ext = ctx().extensionSettings;
    ext[MODULE_NAME] = ext[MODULE_NAME] || {};
    for (const [k, v] of Object.entries(defaultSettings)) {
        if (ext[MODULE_NAME][k] === undefined) ext[MODULE_NAME][k] = typeof v === 'object' ? structuredClone(v) : v;
    }
    settings = ext[MODULE_NAME];
}

function hashString(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
}

/** Clé du persona actuel = nom du fichier d'avatar (même clé que power_user.personas). */
function getCurrentPersonaKey() {
    try {
        const v = personasModule?.user_avatar;
        if (v) return v;
    } catch { /* ignore */ }
    const sel = document.querySelector('#user_avatar_block .avatar-container.selected');
    if (sel?.getAttribute('data-avatar-id')) return sel.getAttribute('data-avatar-id');
    return ctx().powerUserSettings?.default_persona || null;
}

function personaName(key) {
    const names = ctx().powerUserSettings?.personas || {};
    return names[key] || key;
}

function getPersonaList() {
    const names = ctx().powerUserSettings?.personas || {};
    return Object.keys(names).map(k => ({ key: k, name: names[k] || k }))
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

function getRecord(key, create = false) {
    if (!key) return null;
    if (!settings.personas[key] && create) settings.personas[key] = { simple: false, sprites: {} };
    const rec = settings.personas[key];
    if (rec && !rec.sprites) rec.sprites = {};
    return rec || null;
}

const spriteUrl = (file) => `/user/files/${encodeURIComponent(file)}`;

function personaAvatarUrl(key) {
    try { return ctx().getThumbnailUrl('persona', key); } catch { return `/User Avatars/${encodeURIComponent(key)}`; }
}

/** Sprite à afficher pour (persona, émotion) avec la chaîne de repli. */
function resolveSprite(key, emotion) {
    const rec = getRecord(key);
    const sprites = rec?.sprites || {};
    let file = null;
    if (rec) {
        if (rec.simple) {
            file = sprites[DEFAULT_KEY];
        } else {
            file = sprites[emotion]
                || sprites[settings.fallback]
                || sprites[DEFAULT_KEY]
                || null;
        }
    }
    if (file) return spriteUrl(file);
    if (settings.avatarFallback && key) return personaAvatarUrl(key);
    return null;
}

/* ------------------------------------------------------------------ holder */

function ensureHolder() {
    let holder = document.getElementById('persona-expression-holder');
    if (holder) return holder;
    holder = document.createElement('div');
    holder.id = 'persona-expression-holder';
    holder.setAttribute('aria-hidden', 'true');
    holder.innerHTML = '<div class="pexp-move-label">Déplacer</div><div class="pexp-inner"><img class="pexp-image" id="persona-expression-image" alt="" draggable="false"></div>';
    document.body.appendChild(holder); // directement sous <body> : hors de tout wrapper transformé

    const done = document.createElement('button');
    done.id = 'pexp-move-done';
    done.type = 'button';
    done.textContent = '✔ Terminer le déplacement';
    done.addEventListener('click', () => setMoveMode(false));
    document.body.appendChild(done);

    const img = holder.querySelector('img');
    img.addEventListener('click', () => {
        if (moveMode || !settings.tapHide) return;
        userHidden = true;
        refreshVisibility();
    });
    img.addEventListener('load', () => layout());
    bindDrag(holder);
    return holder;
}

function probeSafeArea() {
    let p = document.getElementById('pexp-safe-probe');
    if (!p) {
        p = document.createElement('div');
        p.id = 'pexp-safe-probe';
        p.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;'
            + 'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px);';
        document.body.appendChild(p);
    }
    const cs = getComputedStyle(p);
    return { top: parseFloat(cs.paddingTop) || 0, right: parseFloat(cs.paddingRight) || 0, bottom: parseFloat(cs.paddingBottom) || 0, left: parseFloat(cs.paddingLeft) || 0 };
}

/** Calcule les bornes de déplacement (px) pour le holder courant. */
function getBounds(holder) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const safe = probeSafeArea();
    const w = holder.offsetWidth;
    const h = holder.offsetHeight;
    // Placement libre : tout l'écran (0 % = bord gauche / bas, 100 % = bord droit / haut du sticker collé au bord)
    const minL = safe.left;
    const maxL = Math.max(minL, vw - w - safe.right);
    let minB = 0;
    if (settings.aboveBar) { // option : interdit de passer sous la barre d'envoi
        const form = document.getElementById('form_sheld');
        if (form && form.offsetHeight > 0) {
            const r = form.getBoundingClientRect();
            if (r.top > 0 && r.top < vh) minB = Math.max(minB, vh - r.top + 4);
        }
    }
    const maxB = Math.max(minB, vh - h - safe.top);
    return { minL, maxL, minB, maxB, w, h };
}

function layout() {
    const holder = document.getElementById('persona-expression-holder');
    if (!holder || !settings) return;
    const vw = window.innerWidth;
    const size = clamp(Number(settings.size) || 150, 40, Math.max(60, vw * 0.92));
    holder.style.setProperty('--pexp-opacity', String(clamp(settings.opacity, 5, 100) / 100));
    holder.style.width = `${size}px`;
    const b = getBounds(holder);
    const left = b.minL + (clamp(settings.posX, 0, 100) / 100) * (b.maxL - b.minL);
    const bottom = b.minB + (clamp(settings.posY, 0, 100) / 100) * (b.maxB - b.minB);
    holder.style.left = `${Math.round(left * 10) / 10}px`;
    holder.style.bottom = `${Math.round(bottom * 10) / 10}px`;
    syncPxControls(Math.round(left), Math.round(bottom));
    holder.classList.toggle('pexp-front', settings.layer !== 'behind');
    holder.classList.toggle('pexp-behind', settings.layer === 'behind');
    // Couche « devant » : le sticker est devant les bulles mais passe SOUS la barre d'envoi (on le coupe à son bord haut)
    let clip = '';
    if (settings.layer !== 'behind') {
        const form = document.getElementById('form_sheld');
        if (form && form.offsetHeight > 0) {
            const formTop = form.getBoundingClientRect().top;
            const holderBottomY = window.innerHeight - bottom;
            const overlap = Math.min(holder.offsetHeight, Math.max(0, holderBottomY - formTop));
            if (overlap > 0) clip = `inset(-24px -24px ${Math.round(overlap)}px -24px)`;
        }
    }
    holder.style.clipPath = clip;
    holder.style.webkitClipPath = clip;
    holder.classList.toggle('pexp-flip', !!settings.flip);
    holder.classList.toggle('pexp-tap', !!settings.tapHide);
}

function syncPxControls(left, bottom) {
    const x = document.getElementById('pexp_px_x');
    const y = document.getElementById('pexp_px_y');
    if (x && document.activeElement !== x) x.value = left;
    if (y && document.activeElement !== y) y.value = bottom;
}

/** Place le sticker à des coordonnées en pixels (X depuis la gauche, Y depuis le bas) → converties en %. */
function setPositionFromPx({ x = null, y = null }) {
    const holder = ensureHolder();
    const b = getBounds(holder);
    if (x !== null && Number.isFinite(x)) settings.posX = b.maxL > b.minL ? Math.round(clamp((x - b.minL) / (b.maxL - b.minL), 0, 1) * 10000) / 100 : 0;
    if (y !== null && Number.isFinite(y)) settings.posY = b.maxB > b.minB ? Math.round(clamp((y - b.minB) / (b.maxB - b.minB), 0, 1) * 10000) / 100 : 0;
    layout();
    syncPositionControls();
    save();
}

function bindDrag(holder) {
    let drag = null;
    holder.addEventListener('pointerdown', (e) => {
        if (!moveMode) return;
        e.preventDefault();
        const b = getBounds(holder);
        drag = { id: e.pointerId, x: e.clientX, y: e.clientY, left: parseFloat(holder.style.left) || 0, bottom: parseFloat(holder.style.bottom) || 0, b };
        holder.classList.add('pexp-dragging');
        try { holder.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    });
    holder.addEventListener('pointermove', (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        e.preventDefault();
        const left = clamp(drag.left + (e.clientX - drag.x), drag.b.minL, drag.b.maxL);
        const bottom = clamp(drag.bottom - (e.clientY - drag.y), drag.b.minB, drag.b.maxB);
        holder.style.left = `${left}px`;
        holder.style.bottom = `${bottom}px`;
    });
    const end = (e) => {
        if (!drag || (e && e.pointerId !== drag.id)) return;
        const b = drag.b;
        const left = parseFloat(holder.style.left) || 0;
        const bottom = parseFloat(holder.style.bottom) || 0;
        settings.posX = b.maxL > b.minL ? Math.round(clamp((left - b.minL) / (b.maxL - b.minL), 0, 1) * 10000) / 100 : 0;
        settings.posY = b.maxB > b.minB ? Math.round(clamp((bottom - b.minB) / (b.maxB - b.minB), 0, 1) * 10000) / 100 : 0;
        drag = null;
        holder.classList.remove('pexp-dragging');
        syncPositionControls();
        save();
    };
    holder.addEventListener('pointerup', end);
    holder.addEventListener('pointercancel', end);
}

function setMoveMode(on) {
    moveMode = !!on;
    const holder = ensureHolder();
    holder.classList.toggle('pexp-move', moveMode);
    document.getElementById('pexp-move-done')?.classList.toggle('pexp-show', moveMode);
    $('#pexp_move_btn').toggleClass('pexp-active', moveMode).text(moveMode ? 'Terminer' : 'Déplacer');
    if (moveMode) {
        // referme les panneaux ouverts (Extensions, etc., sauf épinglés) pour voir et saisir le sticker
        reopenToggles = [];
        document.querySelectorAll('.drawer-content.openDrawer:not(.pinnedOpen)').forEach((panel) => {
            const toggle = panel.parentElement?.querySelector(':scope > .drawer-toggle');
            if (toggle) { toggle.click(); reopenToggles.push(toggle); }
        });
        // en mode déplacement on montre toujours un sticker (image réelle ou placeholder)
        userHidden = false;
        timerHidden = false;
    } else if (reopenToggles.length) {
        reopenToggles.forEach(t => t.click());
        reopenToggles = [];
    }
    refreshVisibility();
    layout();
}

function refreshVisibility() {
    const holder = ensureHolder();
    const enabledHere = settings.enabled && (settings.groups || !ctx().groupId) && (ctx().chatId || moveMode);
    const hasSrc = !!shownSrc;
    const visible = (enabledHere && hasSrc && !userHidden && !timerHidden) || moveMode;
    holder.classList.toggle('pexp-visible', !!visible);
    holder.setAttribute('aria-hidden', visible ? 'false' : 'true');
}

function playAnimation() {
    const inner = document.querySelector('#persona-expression-holder .pexp-inner');
    if (!inner) return;
    inner.classList.remove('pexp-anim-pop', 'pexp-anim-fade', 'pexp-anim-slide');
    if (settings.anim && settings.anim !== 'none') {
        void inner.offsetWidth; // reflow pour relancer l'animation
        inner.style.setProperty('--pexp-anim-ms', '350ms');
        document.getElementById('persona-expression-holder').style.setProperty('--pexp-anim-ms', '350ms');
        inner.classList.add(`pexp-anim-${settings.anim}`);
    }
}

function armHideTimer() {
    clearTimeout(hideTimer);
    hideTimer = null;
    const n = Number(settings.hideAfter) || 0;
    if (n > 0 && !moveMode) {
        hideTimer = setTimeout(() => { timerHidden = true; refreshVisibility(); }, n * 1000);
    }
}

/**
 * Affiche (persona, émotion). Précharge l'image avant de l'afficher (pas de flash).
 * @param {{reveal?: boolean}} [opts] reveal = ré-affiche même si masqué (tap / minuteur)
 */
function render({ reveal = false } = {}) {
    if (!settings) return;
    const holder = ensureHolder();
    const key = getCurrentPersonaKey();
    shownKey = key;
    const src = resolveSprite(key, currentEmotion);
    if (reveal) { userHidden = false; timerHidden = false; }

    const apply = (finalSrc, changed) => {
        shownSrc = finalSrc;
        const img = holder.querySelector('img');
        if (finalSrc) {
            if (img.getAttribute('src') !== finalSrc) img.src = finalSrc;
        } else {
            img.removeAttribute('src');
        }
        layout();
        refreshVisibility();
        if (finalSrc && (changed || reveal)) { playAnimation(); armHideTimer(); }
        $('#pexp_current_label').text(`${personaName(key) || '—'} · ${labelFr(currentEmotion)}`);
    };

    if (!src) { apply(null, false); return; }
    if (src === shownSrc && holder.querySelector('img').getAttribute('src') === src) { apply(src, false); return; }

    const pre = new Image();
    pre.onload = () => { if (shownKey === key) apply(src, true); };
    pre.onerror = () => { console.warn(LOG, 'image illisible', src); if (shownKey === key) apply(null, false); };
    pre.src = src;
}

function setEmotion(label, { reveal = true, manual = false } = {}) {
    const l = String(label || '').trim().toLowerCase();
    currentEmotion = EMOTIONS.includes(l) ? l : 'neutral';
    render({ reveal });
    return currentEmotion;
}

/* ------------------------------------------------------------------ détection */

function sampleText(text) {
    let t = String(text || '');
    try { t = ctx().substituteParams(t); } catch { /* ignore */ }
    t = t.replace(/[*"]/g, '').trim();
    if (t.length > 500) t = t.slice(0, 250) + ' ' + t.slice(-250);
    return t;
}

async function builtinExpressionsApi() {
    const api = ctx().extensionSettings?.expressions?.api;
    return typeof api === 'number' ? api : 99; // 0 = local, 1 = extras, 2 = llm, 3 = webllm, 99 = aucun
}

async function classifierLabel(text, { force = false } = {}) {
    if (Date.now() < classifierDownUntil && !force) return null;
    const api = await builtinExpressionsApi();
    try {
        if (api === 0 || api === 1) {
            // Réutilise l'extension intégrée (gère extras / traduction / échantillonnage).
            const mod = await import('/scripts/extensions/expressions/index.js');
            const label = await withTimeout(mod.getExpressionLabel(text, api), 8000);
            if (label && EMOTIONS.includes(String(label).toLowerCase())) return String(label).toLowerCase();
            return null;
        }
        if (api === 99 && !force) return null; // l'utilisateur n'a pas activé de classifieur : on ne télécharge rien
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 6000);
        try {
            const res = await fetch('/api/extra/classify', {
                method: 'POST',
                headers: ctx().getRequestHeaders(),
                body: JSON.stringify({ text }),
                signal: ac.signal,
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const label = String(data?.classification?.[0]?.label || '').toLowerCase();
            return EMOTIONS.includes(label) ? label : null;
        } finally { clearTimeout(timer); }
    } catch (err) {
        console.warn(LOG, 'classifieur indisponible, repli sur l\'heuristique', err?.message || err);
        classifierDownUntil = Date.now() + 2 * 60 * 1000;
        return null;
    }
}

function withTimeout(p, ms) {
    return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

async function llmLabel(text) {
    const c = ctx();
    if (c.onlineStatus === 'no_connection') return null;
    const labels = EMOTIONS.map(x => `"${x}"`).join(', ');
    let prompt = String(settings.llmPrompt || DEFAULT_LLM_PROMPT);
    prompt = c.substituteParamsExtended ? c.substituteParamsExtended(prompt, { labels }) : prompt.replace('{{labels}}', labels);
    try {
        const out = String(await withTimeout(c.generateRaw({ prompt: text, systemPrompt: prompt }), 25000) || '').toLowerCase();
        const sorted = [...EMOTIONS].sort((a, b) => b.length - a.length);
        for (const l of sorted) if (new RegExp(`\\b${l}\\b`).test(out)) return l;
        for (const l of sorted) if (out.includes(l)) return l;
    } catch (err) {
        console.warn(LOG, 'classification LLM échouée', err?.message || err);
    }
    return null;
}

/**
 * Détecte l'émotion d'un texte selon le mode choisi. Toujours une étiquette valide.
 * @returns {Promise<{label: string, source: string}>}
 */
async function detect(text, mode = settings.detection) {
    const sample = sampleText(text);
    if (!sample) return { label: 'neutral', source: 'vide' };
    const h = detectEmotion(sample);
    if (mode === 'heuristic') return { label: h.label, source: 'heuristique' };
    if (mode === 'auto' && h.score >= HEURISTIC_CONFIDENT) return { label: h.label, source: 'heuristique' };
    let label = null;
    let source = '';
    if (mode === 'llm') { label = await llmLabel(sample); source = 'LLM'; }
    else { label = await classifierLabel(sample, { force: mode === 'classifier' }); source = 'classifieur'; }
    if (label) return { label, source };
    return { label: h.label, source: 'heuristique (repli)' };
}

/** Détection immédiate si possible (sans await) pour éviter toute latence. */
function needsAsync(text, mode = settings.detection) {
    if (mode === 'heuristic') return false;
    if (mode === 'auto') return detectEmotion(sampleText(text)).score < HEURISTIC_CONFIDENT && (ctx().extensionSettings?.expressions?.api === 0 || ctx().extensionSettings?.expressions?.api === 1);
    return true;
}

/* ------------------------------------------------------------------ événements */

let saveTimer = null;
/** ST sauvegarde le chat AVANT MESSAGE_SENT : on re-sauvegarde (retardé) pour garder l'émotion mémorisée. */
function saveChatSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        try {
            const sp = ctx().streamingProcessor;
            if (sp && !sp.isFinished) return; // la génération en cours sauvegardera elle-même
            ctx().saveChat?.();
        } catch (err) { console.debug(LOG, 'sauvegarde du chat ignorée', err?.message); }
    }, 1200);
}

function onUserMessage(messageId) {
    try {
        if (!settings?.enabled) return;
        const c = ctx();
        if (c.groupId && !settings.groups) return;
        const id = Number(messageId);
        const msg = c.chat?.[id];
        if (!msg || !msg.is_user || msg.is_system) return;
        const sig = `${c.chatId}|${id}|${msg.mes}`;
        if (sig === lastHandled) return; // MESSAGE_SENT + USER_MESSAGE_RENDERED = un seul traitement
        lastHandled = sig;
        const token = ++detectToken;
        const apply = (label) => {
            if (token !== detectToken) return; // un message plus récent a pris la main
            const l = setEmotion(label, { reveal: true });
            if (settings.remember) {
                msg.extra = msg.extra || {};
                msg.extra.persona_expression = l;
                saveChatSoon();
            }
        };
        if (!needsAsync(msg.mes)) {
            apply(detectEmotion(sampleText(msg.mes)).label); // synchrone
        } else {
            detect(msg.mes).then(r => apply(r.label)).catch(err => console.warn(LOG, err));
        }
    } catch (err) {
        console.error(LOG, err);
    }
}

/** Dernier message utilisateur du chat : restaure l'émotion mémorisée sinon « neutral ». */
function restoreFromChat() {
    detectToken++;
    let label = 'neutral';
    if (settings.remember) {
        const chat = ctx().chat || [];
        for (let i = chat.length - 1; i >= 0; i--) {
            if (chat[i]?.is_user && !chat[i]?.is_system) {
                const v = chat[i]?.extra?.persona_expression;
                if (v && EMOTIONS.includes(v)) label = v;
                break;
            }
        }
    }
    userHidden = false;
    timerHidden = false;
    setEmotion(label, { reveal: true });
}

function syncPersona() {
    if (!settings) return;
    const key = getCurrentPersonaKey();
    if (key && key !== shownKey) {
        currentEmotion = settings.fallback || 'neutral';
        userHidden = false;
        timerHidden = false;
        render({ reveal: true });
        refreshPersonaSelect();
    }
}

/* ------------------------------------------------------------------ upload / stockage */

function readAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = () => reject(fr.error || new Error('lecture impossible'));
        fr.readAsDataURL(file);
    });
}

function loadImage(url) {
    return new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error('image illisible'));
        im.src = url;
    });
}

/** Prépare un fichier image : réduit à 1024 px max (sauf GIF/SVG animés), retourne {b64, ext}. */
async function prepareImage(file) {
    const type = (file.type || '').toLowerCase();
    if (!type.startsWith('image/')) throw new Error('Ce fichier n\'est pas une image.');
    const dataUrl = await readAsDataURL(file);
    const extMap = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/avif': 'avif' };
    let ext = extMap[type] || 'png';
    const rawB64 = dataUrl.split(',')[1];
    if (type === 'image/gif' || type === 'image/svg+xml') return { b64: rawB64, ext };
    let img;
    try { img = await loadImage(dataUrl); } catch { return { b64: rawB64, ext }; }
    const maxSide = Math.max(img.naturalWidth, img.naturalHeight);
    if (maxSide <= MAX_IMAGE_SIDE && file.size < 4 * 1024 * 1024) return { b64: rawB64, ext };
    const scale = Math.min(1, MAX_IMAGE_SIDE / maxSide);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const asJpeg = type === 'image/jpeg';
    const out = canvas.toDataURL(asJpeg ? 'image/jpeg' : 'image/png', 0.9);
    ext = asJpeg ? 'jpg' : 'png';
    return { b64: out.split(',')[1], ext };
}

function makeFileName(personaKey, slot, ext) {
    const slug = String(personaKey).replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 24);
    return `${FILE_PREFIX}${slug}_${hashString(personaKey)}_${slot}_${Date.now().toString(36)}.${ext}`;
}

async function deleteStoredFile(file) {
    if (!file) return;
    try {
        await fetch('/api/files/delete', {
            method: 'POST',
            headers: ctx().getRequestHeaders(),
            body: JSON.stringify({ path: `user/files/${file}` }),
        });
    } catch (err) { console.warn(LOG, 'suppression fichier échouée', err); }
}

async function uploadSprite(personaKey, slot, file) {
    const { b64, ext } = await prepareImage(file);
    const name = makeFileName(personaKey, slot, ext);
    const res = await fetch('/api/files/upload', {
        method: 'POST',
        headers: ctx().getRequestHeaders(),
        body: JSON.stringify({ name, data: b64 }),
    });
    if (!res.ok) throw new Error(`Échec de l'envoi (${res.status}) : ${await res.text().catch(() => '')}`);
    const rec = getRecord(personaKey, true);
    const old = rec.sprites[slot];
    rec.sprites[slot] = name;
    save();
    if (old && old !== name) await deleteStoredFile(old);
    return name;
}

async function clearSprite(personaKey, slot) {
    const rec = getRecord(personaKey);
    if (!rec?.sprites[slot]) return;
    const old = rec.sprites[slot];
    delete rec.sprites[slot];
    save();
    await deleteStoredFile(old);
}

async function clearAllSprites(personaKey) {
    const rec = getRecord(personaKey);
    if (!rec) return;
    const files = Object.values(rec.sprites);
    rec.sprites = {};
    save();
    await Promise.all(files.map(deleteStoredFile));
}

function pickFiles(multiple = false) {
    return new Promise((resolve) => {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = 'image/*';
        inp.multiple = multiple;
        inp.style.display = 'none';
        inp.addEventListener('change', () => { resolve([...inp.files]); inp.remove(); });
        inp.addEventListener('cancel', () => { resolve([]); inp.remove(); });
        document.body.appendChild(inp);
        inp.click();
    });
}

/* ------------------------------------------------------------------ panneau de réglages */

const SETTINGS_HTML = `
<div id="pexp_settings" class="extension_container">
  <div class="inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
      <b>Persona Expressions</b>
      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content">
      <div class="pexp-hint">Affiche un sticker de TON persona selon l'émotion de TES messages. Indépendant de « Character Expressions ». <span id="pexp_current_label"></span></div>

      <label class="checkbox_label"><input type="checkbox" id="pexp_enabled"><span>Activer Persona Expressions</span></label>
      <label class="checkbox_label"><input type="checkbox" id="pexp_groups"><span>Actif aussi dans les discussions de groupe</span></label>
      <label class="checkbox_label"><input type="checkbox" id="pexp_remember"><span>Mémoriser l'émotion dans le message (restaurée au rechargement du chat)</span></label>

      <div class="pexp-section">Sprites par persona</div>
      <div class="pexp-row">
        <label for="pexp_persona_select">Persona</label>
        <select id="pexp_persona_select" class="text_pole"></select>
      </div>
      <label class="checkbox_label"><input type="checkbox" id="pexp_simple"><span>Mode simple : une seule image pour ce persona</span></label>
      <div class="pexp-hint" id="pexp_sprite_hint"></div>
      <div class="pexp-row">
        <div class="menu_button" id="pexp_bulk_btn"><i class="fa-solid fa-images"></i>&nbsp;Importer plusieurs images</div>
        <div class="menu_button" id="pexp_clear_all_btn"><i class="fa-solid fa-trash"></i>&nbsp;Tout effacer</div>
      </div>
      <div class="pexp-hint">« Importer plusieurs » : le nom de chaque fichier doit être l'émotion (joy.png, anger.jpg, neutral.webp…) ; <b>default.png</b> = image par défaut.</div>
      <div class="pexp-grid" id="pexp_grid"></div>

      <div class="pexp-section">Détection de l'émotion</div>
      <div class="pexp-row">
        <label for="pexp_detection">Mode</label>
        <select id="pexp_detection" class="text_pole">
          <option value="auto">Auto : heuristique FR/EN, puis classifieur ST si disponible</option>
          <option value="heuristic">Heuristique locale seulement (FR/EN, emojis)</option>
          <option value="classifier">Classifieur ST (/api/extra/classify), repli heuristique</option>
          <option value="llm">LLM de l'API actuelle (generateRaw), repli heuristique</option>
        </select>
      </div>
      <div id="pexp_llm_block">
        <div class="pexp-hint">Prompt LLM ({{labels}} = liste des émotions)</div>
        <textarea id="pexp_llm_prompt" class="text_pole textarea_compact" rows="3"></textarea>
        <div class="menu_button" id="pexp_llm_restore">Restaurer le prompt par défaut</div>
      </div>
      <div class="pexp-row">
        <label for="pexp_fallback">Émotion de repli (si pas d'image)</label>
        <select id="pexp_fallback" class="text_pole"></select>
      </div>
      <label class="checkbox_label"><input type="checkbox" id="pexp_avatar_fallback"><span>Utiliser l'avatar du persona s'il n'y a aucun sprite</span></label>
      <div class="pexp-row">
        <input type="text" id="pexp_probe_text" class="text_pole" placeholder="Texte à analyser (test de détection)…" style="flex:2 1 160px">
        <div class="menu_button" id="pexp_probe_btn">Analyser</div>
      </div>
      <div class="pexp-hint" id="pexp_probe_result"></div>

      <div class="pexp-section">Affichage</div>
      <div class="pexp-row"><label for="pexp_size">Taille (px)</label><input type="range" id="pexp_size" class="pexp-range" min="50" max="500" step="5"><input type="number" id="pexp_size_n" class="text_pole pexp-num" min="50" max="500"></div>
      <div class="pexp-row"><label for="pexp_posX">Position horizontale (% depuis la gauche)</label><input type="range" id="pexp_posX" class="pexp-range" min="0" max="100" step="0.1"><input type="number" id="pexp_posX_n" class="text_pole pexp-num" min="0" max="100" step="0.1"></div>
      <div class="pexp-row"><label for="pexp_posY">Position verticale (% depuis le bas)</label><input type="range" id="pexp_posY" class="pexp-range" min="0" max="100" step="0.1"><input type="number" id="pexp_posY_n" class="text_pole pexp-num" min="0" max="100" step="0.1"></div>
      <div class="pexp-row"><label>Coordonnées exactes (px) : X depuis la gauche · Y depuis le bas</label><input type="number" id="pexp_px_x" class="text_pole pexp-num" step="1" inputmode="numeric"><input type="number" id="pexp_px_y" class="text_pole pexp-num" step="1" inputmode="numeric"></div>
      <div class="pexp-hint">Glisse aussi le sticker avec le doigt n'importe où sur l'écran : bouton « Déplacer ». Position enregistrée en % de l'écran (reste cohérente si la taille de l'écran change).</div>
      <div class="pexp-row"><label for="pexp_opacity">Opacité (%)</label><input type="range" id="pexp_opacity" class="pexp-range" min="10" max="100" step="1"><input type="number" id="pexp_opacity_n" class="text_pole pexp-num" min="10" max="100"></div>
      <div class="pexp-row">
        <label for="pexp_anim">Animation</label>
        <select id="pexp_anim" class="text_pole">
          <option value="pop">Pop (rebond)</option>
          <option value="fade">Fondu</option>
          <option value="slide">Glissement</option>
          <option value="none">Aucune</option>
        </select>
      </div>
      <div class="pexp-row"><label for="pexp_hideAfter">Masquer après N secondes (0 = jamais)</label><input type="number" id="pexp_hideAfter" class="text_pole pexp-num" min="0" max="3600"></div>
      <div class="pexp-row">
        <label for="pexp_layer">Couche</label>
        <select id="pexp_layer" class="text_pole">
          <option value="front">Devant les bulles, sous la barre d'envoi</option>
          <option value="behind">Derrière le chat (comme Character Expressions)</option>
        </select>
      </div>
      <label class="checkbox_label"><input type="checkbox" id="pexp_flip"><span>Retourner horizontalement</span></label>
      <label class="checkbox_label"><input type="checkbox" id="pexp_aboveBar"><span>Interdire de passer sous la barre d'envoi (sinon placement libre sur tout l'écran)</span></label>
      <label class="checkbox_label"><input type="checkbox" id="pexp_hideNoSprite"><span>Masquer quand il n'y a pas de sprite</span></label>
      <label class="checkbox_label"><input type="checkbox" id="pexp_tapHide"><span>Toucher le sticker pour le masquer (le sticker capte alors les taps)</span></label>
      <div class="pexp-row">
        <div class="menu_button" id="pexp_move_btn"><i class="fa-solid fa-up-down-left-right"></i>&nbsp;Déplacer</div>
        <div class="menu_button" id="pexp_reset_pos_btn">Réinitialiser la position</div>
      </div>

      <div class="pexp-section">Tests</div>
      <div class="pexp-row">
        <label for="pexp_test_select">Tester une émotion</label>
        <select id="pexp_test_select" class="text_pole"></select>
        <div class="menu_button" id="pexp_test_btn">Tester</div>
      </div>
      <div class="pexp-row">
        <div class="menu_button" id="pexp_show_btn">Afficher / masquer</div>
        <div class="menu_button" id="pexp_picker_btn">Sélecteur rapide</div>
        <div class="menu_button" id="pexp_reset_btn"><i class="fa-solid fa-rotate-left"></i>&nbsp;Réinitialiser les réglages</div>
      </div>
      <div class="pexp-hint">Commande : <code>/persona-emote joy</code> · <code>/persona-emote-detect texte</code>. « Réinitialiser » ne supprime pas les sprites.</div>
    </div>
  </div>
</div>`;

function optionHtml(value, text, selected) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = text;
    if (selected) o.selected = true;
    return o;
}

function fillEmotionSelect(sel, selected, { withDefault = false } = {}) {
    const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
    if (!el) return;
    el.innerHTML = '';
    for (const e of EMOTIONS) el.appendChild(optionHtml(e, `${labelFr(e)} (${e})`, e === selected));
}

function refreshPersonaSelect() {
    const el = document.getElementById('pexp_persona_select');
    if (!el) return;
    const current = getCurrentPersonaKey();
    const list = getPersonaList();
    if (!selectedPersonaInPanel || !list.some(p => p.key === selectedPersonaInPanel)) selectedPersonaInPanel = current || list[0]?.key || null;
    el.innerHTML = '';
    for (const p of list) {
        const mark = p.key === current ? ' ★ (actuel)' : '';
        el.appendChild(optionHtml(p.key, `${p.name}${mark}`, p.key === selectedPersonaInPanel));
    }
    renderGrid();
}

function renderGrid() {
    const grid = document.getElementById('pexp_grid');
    if (!grid) return;
    grid.innerHTML = '';
    const key = selectedPersonaInPanel;
    const rec = key ? getRecord(key) : null;
    $('#pexp_simple').prop('checked', !!rec?.simple);
    $('#pexp_sprite_hint').text(rec?.simple
        ? 'Mode simple : seule l\'image « par défaut » est utilisée, quelle que soit l\'émotion.'
        : 'Chaîne de repli : image de l\'émotion → image de l\'émotion de repli → image par défaut → avatar (option).');
    if (!key) { grid.textContent = 'Aucun persona.'; return; }

    const slots = rec?.simple ? [DEFAULT_KEY] : [DEFAULT_KEY, ...EMOTIONS];
    for (const slot of slots) {
        const file = rec?.sprites?.[slot];
        const cell = document.createElement('div');
        cell.className = 'pexp-cell' + (slot === DEFAULT_KEY ? ' pexp-cell-default' : '');
        cell.dataset.slot = slot;

        const thumb = document.createElement('img');
        thumb.className = 'pexp-thumb' + (file ? '' : ' pexp-empty');
        thumb.alt = slot;
        thumb.title = file ? 'Toucher pour prévisualiser' : 'Aucune image';
        thumb.src = file ? spriteUrl(file) : 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><text x="32" y="42" font-size="30" text-anchor="middle" fill="#888">+</text></svg>');
        thumb.dataset.action = 'preview';
        cell.appendChild(thumb);

        const lab = document.createElement('div');
        lab.className = 'pexp-cell-label';
        if (slot === DEFAULT_KEY) { lab.textContent = rec?.simple ? 'Image unique' : 'Par défaut'; }
        else { lab.textContent = labelFr(slot); const s = document.createElement('small'); s.textContent = slot; lab.appendChild(s); }
        cell.appendChild(lab);

        const btns = document.createElement('div');
        btns.className = 'pexp-cell-btns';
        const up = document.createElement('div');
        up.className = 'menu_button fa-solid fa-upload';
        up.title = 'Téléverser';
        up.dataset.action = 'upload';
        const del = document.createElement('div');
        del.className = 'menu_button fa-solid fa-trash';
        del.title = 'Effacer';
        del.dataset.action = 'clear';
        btns.append(up, del);
        cell.appendChild(btns);
        grid.appendChild(cell);
    }
}

async function handleUploadForSlot(personaKey, slot) {
    const files = await pickFiles(false);
    if (!files.length) return;
    try {
        await uploadSprite(personaKey, slot, files[0]);
    } catch (err) {
        console.error(LOG, err);
        toast('error', String(err.message || err));
    }
    renderGrid();
    if (personaKey === getCurrentPersonaKey()) render({ reveal: true });
}

async function handleBulk(personaKey) {
    const files = await pickFiles(true);
    if (!files.length) return;
    let ok = 0;
    const bad = [];
    for (const f of files) {
        const base = f.name.replace(/\.[^.]+$/, '').trim().toLowerCase();
        const slot = base === DEFAULT_KEY || base === 'default' || base === 'defaut' ? DEFAULT_KEY : base;
        if (slot !== DEFAULT_KEY && !EMOTIONS.includes(slot)) { bad.push(f.name); continue; }
        try { await uploadSprite(personaKey, slot, f); ok++; } catch (err) { console.error(LOG, err); bad.push(f.name); }
    }
    if (ok) toast('success', `${ok} image(s) importée(s).`);
    if (bad.length) toast('warning', `Ignoré(s) (nom ≠ émotion) : ${bad.slice(0, 5).join(', ')}${bad.length > 5 ? '…' : ''}`);
    renderGrid();
    if (personaKey === getCurrentPersonaKey()) render({ reveal: true });
}

function syncPositionControls() {
    for (const k of ['size', 'posX', 'posY', 'opacity']) {
        $(`#pexp_${k}`).val(settings[k]);
        $(`#pexp_${k}_n`).val(settings[k]);
    }
}

function syncAllControls() {
    $('#pexp_enabled').prop('checked', settings.enabled);
    $('#pexp_groups').prop('checked', settings.groups);
    $('#pexp_remember').prop('checked', settings.remember);
    $('#pexp_detection').val(settings.detection);
    $('#pexp_llm_prompt').val(settings.llmPrompt);
    $('#pexp_llm_block').toggle(settings.detection === 'llm');
    fillEmotionSelect('#pexp_fallback', settings.fallback);
    fillEmotionSelect('#pexp_test_select', 'joy');
    $('#pexp_avatar_fallback').prop('checked', settings.avatarFallback);
    $('#pexp_anim').val(settings.anim);
    $('#pexp_layer').val(settings.layer);
    $('#pexp_hideAfter').val(settings.hideAfter);
    $('#pexp_flip').prop('checked', settings.flip);
    $('#pexp_aboveBar').prop('checked', settings.aboveBar);
    $('#pexp_hideNoSprite').prop('checked', settings.hideNoSprite);
    $('#pexp_tapHide').prop('checked', settings.tapHide);
    syncPositionControls();
    refreshPersonaSelect();
}

function bindSettings() {
    const bindCheck = (id, key, after) => $(`#pexp_${id}`).on('input', function () {
        settings[key] = !!this.checked; save(); after?.();
    });
    bindCheck('enabled', 'enabled', () => { refreshVisibility(); if (settings.enabled) render({ reveal: true }); });
    bindCheck('groups', 'groups', () => { refreshVisibility(); render(); });
    bindCheck('remember', 'remember');
    bindCheck('avatar_fallback', 'avatarFallback', () => render({ reveal: true }));
    bindCheck('flip', 'flip', layout);
    bindCheck('aboveBar', 'aboveBar', layout);
    bindCheck('hideNoSprite', 'hideNoSprite', () => render());
    bindCheck('tapHide', 'tapHide', layout);

    for (const k of ['size', 'posX', 'posY', 'opacity']) {
        const handler = (src) => function () {
            const min = Number(this.min); const max = Number(this.max);
            const v = clamp(Number(this.value), min, max);
            if (Number.isNaN(v)) return;
            settings[k] = v;
            $(`#pexp_${k}${src === 'n' ? '' : '_n'}`).val(v);
            layout(); save();
        };
        $(`#pexp_${k}`).on('input', handler('r'));
        $(`#pexp_${k}_n`).on('input', handler('n'));
    }

    $('#pexp_px_x').on('input', function () { setPositionFromPx({ x: parseFloat(this.value) }); });
    $('#pexp_px_y').on('input', function () { setPositionFromPx({ y: parseFloat(this.value) }); });

    $('#pexp_detection').on('change', function () {
        settings.detection = this.value; save();
        $('#pexp_llm_block').toggle(settings.detection === 'llm');
    });
    $('#pexp_llm_prompt').on('input', function () { settings.llmPrompt = this.value; save(); });
    $('#pexp_llm_restore').on('click', () => { settings.llmPrompt = DEFAULT_LLM_PROMPT; $('#pexp_llm_prompt').val(DEFAULT_LLM_PROMPT); save(); });
    $('#pexp_fallback').on('change', function () { settings.fallback = this.value; save(); render({ reveal: false }); });
    $('#pexp_layer').on('change', function () { settings.layer = this.value; save(); layout(); });
    $('#pexp_anim').on('change', function () { settings.anim = this.value; save(); });
    $('#pexp_hideAfter').on('input', function () { settings.hideAfter = clamp(Number(this.value) || 0, 0, 3600); save(); armHideTimer(); });

    $('#pexp_persona_select').on('change', function () { selectedPersonaInPanel = this.value; renderGrid(); });
    $('#pexp_simple').on('input', function () {
        if (!selectedPersonaInPanel) return;
        getRecord(selectedPersonaInPanel, true).simple = !!this.checked;
        save(); renderGrid();
        if (selectedPersonaInPanel === getCurrentPersonaKey()) render({ reveal: true });
    });

    $('#pexp_grid').on('click', '[data-action]', async function () {
        const slot = this.closest('.pexp-cell')?.dataset.slot;
        const key = selectedPersonaInPanel;
        if (!slot || !key) return;
        const action = this.dataset.action;
        if (action === 'upload') await handleUploadForSlot(key, slot);
        else if (action === 'clear') {
            await clearSprite(key, slot); renderGrid();
            if (key === getCurrentPersonaKey()) render({ reveal: true });
        } else if (action === 'preview') {
            const file = getRecord(key)?.sprites?.[slot];
            if (!file) { toast('info', 'Aucune image pour cet emplacement.'); return; }
            if (key !== getCurrentPersonaKey()) { toast('info', 'Aperçu limité au persona actuel : sélectionne-le dans ST pour le voir à l\'écran.'); return; }
            setEmotion(slot === DEFAULT_KEY ? 'neutral' : slot);
        }
    });
    $('#pexp_bulk_btn').on('click', () => selectedPersonaInPanel && handleBulk(selectedPersonaInPanel));
    $('#pexp_clear_all_btn').on('click', async () => {
        const key = selectedPersonaInPanel;
        if (!key) return;
        const ok = await ctx().callGenericPopup(`Effacer TOUTES les images de « ${personaName(key)} » ?`, ctx().POPUP_TYPE.CONFIRM);
        if (!ok) return;
        await clearAllSprites(key); renderGrid();
        if (key === getCurrentPersonaKey()) render({ reveal: true });
    });

    $('#pexp_move_btn').on('click', () => setMoveMode(!moveMode));
    $('#pexp_reset_pos_btn').on('click', () => { settings.posX = defaultSettings.posX; settings.posY = defaultSettings.posY; syncPositionControls(); layout(); save(); });
    $('#pexp_test_btn').on('click', () => { setEmotion($('#pexp_test_select').val()); });
    $('#pexp_show_btn').on('click', () => {
        if (userHidden || timerHidden) render({ reveal: true });
        else { userHidden = true; refreshVisibility(); }
    });
    $('#pexp_picker_btn').on('click', openPicker);
    $('#pexp_probe_btn').on('click', async () => {
        const text = String($('#pexp_probe_text').val() || '');
        if (!text.trim()) return;
        const r = await detect(text);
        $('#pexp_probe_result').text(`→ ${labelFr(r.label)} (${r.label}) — source : ${r.source}`);
        setEmotion(r.label);
    });
    $('#pexp_reset_btn').on('click', async () => {
        const ok = await ctx().callGenericPopup('Réinitialiser tous les réglages (position, taille, détection…) ? Les sprites sont conservés.', ctx().POPUP_TYPE.CONFIRM);
        if (!ok) return;
        for (const [k, v] of Object.entries(defaultSettings)) {
            if (k === 'personas') continue;
            settings[k] = v;
        }
        save(); syncAllControls(); layout(); render({ reveal: true });
    });

    // Rafraîchit la liste de personas à l'ouverture du tiroir
    $('#pexp_settings .inline-drawer-toggle').on('click', () => setTimeout(refreshPersonaSelect, 50));
}

/* ------------------------------------------------------------------ sélecteur rapide */

function openPicker() {
    const key = getCurrentPersonaKey();
    const root = document.createElement('div');
    root.innerHTML = `<h3>Émotion de ${'' }</h3><div class="pexp-hint">Choisis l'émotion affichée pour ton persona (jusqu'à ton prochain message).</div><div class="pexp-picker-grid"></div>`;
    root.querySelector('h3').textContent = `Émotion de ${personaName(key) || 'ton persona'}`;
    const grid = root.querySelector('.pexp-picker-grid');
    const rec = getRecord(key);
    const addItem = (label, text, file, action) => {
        const item = document.createElement('div');
        item.className = 'pexp-picker-item' + (label === currentEmotion ? ' pexp-active' : '');
        item.dataset.pexpPick = action || label;
        if (file) { const im = document.createElement('img'); im.src = spriteUrl(file); im.alt = ''; item.appendChild(im); }
        else { const ph = document.createElement('div'); ph.className = 'pexp-picker-ph'; ph.textContent = '◌'; item.appendChild(ph); }
        const sp = document.createElement('span'); sp.textContent = text; item.appendChild(sp);
        grid.appendChild(item);
    };
    for (const e of EMOTIONS) addItem(e, labelFr(e), rec?.sprites?.[e] || null);
    addItem('__hide', 'Masquer', null, '__hide');
    root.addEventListener('click', (ev) => {
        const it = ev.target.closest('[data-pexp-pick]');
        if (!it) return;
        const v = it.dataset.pexpPick;
        if (v === '__hide') { userHidden = true; refreshVisibility(); }
        else setEmotion(v);
        document.querySelector('dialog[open].popup .popup-button-ok, .popup[open] .popup-button-ok')?.click();
    });
    ctx().callGenericPopup(root, ctx().POPUP_TYPE.TEXT, '', { okButton: 'Fermer', cancelButton: false, allowVerticalScrolling: true, wide: false });
}

function addWandButton() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu || document.getElementById('pexp_wand_container')) return;
    const c = document.createElement('div');
    c.id = 'pexp_wand_container';
    c.className = 'extension_container';
    c.innerHTML = '<div id="pexp_wand_button" class="list-group-item flex-container flexGap5" title="Choisir l\'émotion de ton persona"><div class="fa-solid fa-face-smile extensionsMenuExtensionButton"></div><span>Émotion du persona</span></div>';
    menu.appendChild(c);
    c.querySelector('#pexp_wand_button').addEventListener('click', () => {
        $('#extensionsMenu').hide?.();
        openPicker();
    });
}

/* ------------------------------------------------------------------ commandes slash */

function registerSlashCommands() {
    const c = ctx();
    const { SlashCommandParser, SlashCommand, SlashCommandArgument, SlashCommandNamedArgument, SlashCommandEnumValue, ARGUMENT_TYPE } = c;
    if (!SlashCommandParser?.addCommandObject || !SlashCommand?.fromProps) { console.warn(LOG, 'API des commandes slash indisponible'); return; }
    const enumList = () => EMOTIONS.map(e => new SlashCommandEnumValue(e, labelFr(e)));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'persona-emote',
        aliases: ['pemote'],
        helpString: 'Force l\'émotion affichée pour le persona actuel (Persona Expressions). Sans argument ou avec <code>reset</code> : retour à l\'émotion de repli. <code>hide</code> / <code>show</code> pour masquer / afficher.',
        returns: 'l\'émotion appliquée',
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({ name: 'persona', description: 'afficher les sprites de ce persona (nom ou avatar) — par défaut le persona actuel', typeList: [ARGUMENT_TYPE.STRING], isRequired: false }),
        ],
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({ description: 'étiquette d\'émotion (ou reset / hide / show)', typeList: [ARGUMENT_TYPE.STRING], isRequired: false, enumProvider: enumList }),
        ],
        callback: async (args, value) => {
            const v = String(value || '').trim().toLowerCase();
            if (v === 'hide') { userHidden = true; refreshVisibility(); return 'hidden'; }
            if (v === 'show') { render({ reveal: true }); return currentEmotion; }
            if (v && v !== 'reset' && !EMOTIONS.includes(v)) {
                toast('warning', `Émotion inconnue : « ${v} ». Valeurs : ${EMOTIONS.join(', ')}`);
                return '';
            }
            detectToken++;
            return setEmotion(!v || v === 'reset' ? settings.fallback : v, { reveal: true, manual: true });
        },
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'persona-emote-detect',
        aliases: ['pemote-detect'],
        helpString: 'Détecte l\'émotion d\'un texte avec le mode de Persona Expressions (et l\'applique si <code>apply=true</code>).',
        returns: 'l\'étiquette d\'émotion',
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({ name: 'apply', description: 'afficher aussi le sticker', typeList: [ARGUMENT_TYPE.BOOLEAN], defaultValue: 'false', isRequired: false }),
        ],
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({ description: 'texte à analyser', typeList: [ARGUMENT_TYPE.STRING], isRequired: true }),
        ],
        callback: async (args, value) => {
            const r = await detect(String(value || ''));
            if (String(args?.apply).toLowerCase() === 'true') setEmotion(r.label);
            return r.label;
        },
    }));
}

/* ------------------------------------------------------------------ init */

async function init() {
    loadSettings();
    try { personasModule = await import('/scripts/personas.js'); } catch (err) { console.debug(LOG, 'personas.js indisponible, repli DOM', err?.message); }

    ensureHolder();
    $('#extensions_settings2').append(SETTINGS_HTML);
    bindSettings();
    syncAllControls();
    addWandButton();
    registerSlashCommands();

    const { eventSource, eventTypes } = ctx();
    eventSource.on(eventTypes.MESSAGE_SENT, onUserMessage);
    eventSource.on(eventTypes.USER_MESSAGE_RENDERED, onUserMessage);
    eventSource.on(eventTypes.MESSAGE_EDITED, (id) => {
        const chat = ctx().chat || [];
        if (Number(id) === chat.length - 1 || chat.slice(Number(id) + 1).every(m => !m.is_user)) { lastHandled = ''; onUserMessage(id); }
    });
    eventSource.on(eventTypes.PERSONA_CHANGED, () => { lastHandled = ''; syncPersona(); refreshPersonaSelect(); });
    eventSource.on(eventTypes.CHAT_CHANGED, () => {
        lastHandled = '';
        restoreFromChat();
        // le persona verrouillé du chat est appliqué juste après CHAT_CHANGED : on resynchronise
        setTimeout(syncPersona, 400);
        setTimeout(syncPersona, 1500);
        refreshPersonaSelect();
    });
    eventSource.on(eventTypes.MESSAGE_DELETED, () => { lastHandled = ''; });

    let rl = null;
    const relayout = () => { clearTimeout(rl); rl = setTimeout(layout, 60); };
    window.addEventListener('resize', relayout);
    window.addEventListener('orientationchange', relayout);
    window.visualViewport?.addEventListener('resize', relayout);
    const form = document.getElementById('form_sheld');
    if (form && 'ResizeObserver' in window) new ResizeObserver(relayout).observe(form);
    setInterval(syncPersona, 2000);

    restoreFromChat();
    globalThis.personaExpressions = { setEmotion, detect, render, resolveSprite, getCurrentPersonaKey, get settings() { return settings; }, get state() { return { currentEmotion, shownSrc, userHidden, timerHidden, moveMode, shownKey }; } };
    console.log(LOG, 'chargé');
}

jQuery(async () => {
    try { await init(); } catch (err) { console.error(LOG, 'échec d\'initialisation', err); }
});
