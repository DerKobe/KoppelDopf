// Kartenbilder: klassisches "English pattern"-Blatt von Dmitry Fomin (CC0, Wikimedia Commons),
// mit deutschen Eck-Indizes (B/D/K statt J/Q/K). Rückseite: eigenes Motiv (public/cards/back.jpg).
import * as THREE from 'three';

const BASE_W = 360, BASE_H = 540; // Maße der Original-SVGs
const S = 1.5; // Raster-Faktor, damit die großen Handkarten scharf bleiben
export const CARD_W = BASE_W * S;
export const CARD_H = BASE_H * S;

const SUIT_FILES = { C: 'clubs', S: 'spades', H: 'hearts', D: 'diamonds' };
const RANK_FILES = { '9': '9', '10': '10', J: 'jack', Q: 'queen', K: 'king', A: 'ace' };
const GERMAN_INDEX = { J: 'B', Q: 'D', K: 'K' };
const INK = { red: '#ff5555', black: '#000000' };

const ASSET_VERSION = 2; // erhöhen, wenn sich Kartenbilder ändern (umgeht den Browser-Cache)
const urlFor = (key) => (key === 'back' ? `/cards/back.jpg?v=${ASSET_VERSION}`
  : `/cards/English_pattern_${RANK_FILES[key.slice(1)]}_of_${SUIT_FILES[key[0]]}.svg?v=${ASSET_VERSION}`);

// ---------- Laden ----------
const images = new Map(); // key -> HTMLImageElement (geladen)
const ALL_KEYS = ['back'];
for (const s of 'CSHD') for (const r of ['9', '10', 'J', 'Q', 'K', 'A']) ALL_KEYS.push(s + r);

export const cardsReady = Promise.all(ALL_KEYS.map((key) => new Promise((resolve) => {
  const img = new Image();
  img.decoding = 'async';
  img.onload = () => { images.set(key, img); redraw(key); resolve(); };
  img.onerror = () => { console.warn('Kartenbild fehlt:', key); resolve(); };
  img.src = urlFor(key);
})));

// ---------- Zeichnen ----------
function drawCard(ctx, key) {
  ctx.clearRect(0, 0, CARD_W, CARD_H);
  ctx.fillStyle = key === 'back' ? '#f3ecdc' : '#ffffff';
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  const img = images.get(key);
  if (!img) return; // Platzhalter, bis das Bild geladen ist
  ctx.drawImage(img, 0, 0, CARD_W, CARD_H);
  const rank = key.slice(1);
  if (key !== 'back' && GERMAN_INDEX[rank]) drawGermanIndex(ctx, key[0], GERMAN_INDEX[rank]);
}

// Ersetzt den englischen Rang-Buchstaben in beiden Ecken (Farbsymbol darunter bleibt original).
function drawGermanIndex(ctx, suit, letter) {
  const color = suit === 'H' || suit === 'D' ? INK.red : INK.black;
  for (const flip of [false, true]) {
    ctx.save();
    if (flip) { ctx.translate(CARD_W, CARD_H); ctx.rotate(Math.PI); }
    ctx.scale(S, S);
    // Original-Buchstaben (J/Q/K liegen bei x 20–39, y 30–79, Q-Schwanz bis y 84) übermalen; Farbsymbol ab y 90 bleibt
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(12, 26, 36, 61);
    // Schmale Grotesk wie die Original-Indizes, exakt in deren Feld: zentriert über dem Farbsymbol (Mitte x 29,5),
    // gleiche Ober-/Unterkante wie 9, 10, A, J, Q, K; Breite wie das „A“ (breiteste einzelne Original-Glyphe)
    // normale Breite, auf das schmale Feld gestaucht: so passen die Strichstärken (~4–6 px) zum Original (~5 px);
    // eine „condensed“-Schrift gibt es meist nur fett (Striche ~40 % zu dick)
    ctx.font = '400 100px "Helvetica Neue", Arial, sans-serif';
    const m = ctx.measureText(letter);
    const w = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
    const h = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
    const box = { x: 29.5 - 10.5 + 0.5, y: 30.5, w: 21, h: 49.5 }; // +0,5: Ausgleich der Kantenglättung (nachgemessen)
    const sx = box.w / w, sy = box.h / h;
    ctx.translate(box.x + (box.w - w * sx) / 2, box.y);
    ctx.scale(sx, sy);
    ctx.fillStyle = color;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(letter, m.actualBoundingBoxLeft, m.actualBoundingBoxAscent);
    ctx.restore();
  }
}

// ---------- Öffentliche API ----------
const canvasCache = new Map();
const textureCache = new Map();
const urlCache = new Map();
let maxAniso = 8;
export function setMaxAnisotropy(n) { maxAniso = n; }

function redraw(key) {
  const c = canvasCache.get(key);
  if (!c) return;
  drawCard(c.getContext('2d'), key);
  urlCache.delete(key);
  const tex = textureCache.get(key);
  if (tex) tex.needsUpdate = true;
}

export function getCardCanvas(key) {
  if (canvasCache.has(key)) return canvasCache.get(key);
  const c = document.createElement('canvas');
  c.width = CARD_W;
  c.height = CARD_H;
  canvasCache.set(key, c);
  drawCard(c.getContext('2d'), key);
  return c;
}

export function getCardTexture(key) {
  if (textureCache.has(key)) return textureCache.get(key);
  const tex = new THREE.CanvasTexture(getCardCanvas(key));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  textureCache.set(key, tex);
  return tex;
}

export function getCardDataURL(key) {
  if (!images.has(key)) return urlFor(key);
  if (!urlCache.has(key)) urlCache.set(key, getCardCanvas(key).toDataURL('image/png'));
  return urlCache.get(key);
}
