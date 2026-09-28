// Prozedural gezeichnetes klassisches französisches Blatt (deutsche Indizes: B, D, K, A).
import * as THREE from 'three';

export const CARD_W = 360;
export const CARD_H = 540;
const RED = '#c0182a';
const BLACK = '#161616';
const GOLD = '#d9a520';

const suitColor = (s) => (s === 'H' || s === 'D' ? RED : BLACK);

// ---------- Farbsymbole (Koordinaten im Bereich -50..50) ----------
function suitPath(ctx, suit) {
  ctx.beginPath();
  switch (suit) {
    case 'H':
      ctx.moveTo(0, 46);
      ctx.bezierCurveTo(-8, 32, -50, 10, -50, -16);
      ctx.bezierCurveTo(-50, -42, -16, -52, 0, -26);
      ctx.bezierCurveTo(16, -52, 50, -42, 50, -16);
      ctx.bezierCurveTo(50, 10, 8, 32, 0, 46);
      break;
    case 'D':
      ctx.moveTo(0, -52);
      ctx.quadraticCurveTo(14, -20, 40, 0);
      ctx.quadraticCurveTo(14, 20, 0, 52);
      ctx.quadraticCurveTo(-14, 20, -40, 0);
      ctx.quadraticCurveTo(-14, -20, 0, -52);
      break;
    case 'S':
      ctx.moveTo(0, -50);
      ctx.bezierCurveTo(10, -34, 50, -14, 50, 12);
      ctx.bezierCurveTo(50, 36, 18, 42, 5, 24);
      ctx.quadraticCurveTo(8, 42, 18, 50);
      ctx.lineTo(-18, 50);
      ctx.quadraticCurveTo(-8, 42, -5, 24);
      ctx.bezierCurveTo(-18, 42, -50, 36, -50, 12);
      ctx.bezierCurveTo(-50, -14, -10, -34, 0, -50);
      break;
    case 'C':
      // alle Teilflächen im Uhrzeigersinn, damit 'nonzero' keine Löcher erzeugt
      ctx.moveTo(22, -24);
      ctx.arc(0, -24, 22, 0, Math.PI * 2);
      ctx.moveTo(-2, 8);
      ctx.arc(-24, 8, 22, 0, Math.PI * 2);
      ctx.moveTo(46, 8);
      ctx.arc(24, 8, 22, 0, Math.PI * 2);
      ctx.rect(-10, -10, 20, 26);
      ctx.moveTo(4, 14);
      ctx.quadraticCurveTo(4, 40, 18, 50);
      ctx.lineTo(-18, 50);
      ctx.quadraticCurveTo(-4, 40, -4, 14);
      break;
  }
  ctx.closePath();
}

export function drawSuit(ctx, suit, x, y, size, rot = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(size / 100, size / 100);
  suitPath(ctx, suit);
  ctx.fillStyle = suitColor(suit);
  ctx.fill('nonzero');
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function paper(ctx) {
  roundRect(ctx, 2, 2, CARD_W - 4, CARD_H - 4, 26);
  const g = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
  g.addColorStop(0, '#fffdf6');
  g.addColorStop(1, '#f1ebdc');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#b9b09a';
  ctx.stroke();
}

function corners(ctx, suit, label) {
  const col = suitColor(suit);
  for (const flip of [false, true]) {
    ctx.save();
    if (flip) { ctx.translate(CARD_W, CARD_H); ctx.rotate(Math.PI); }
    ctx.fillStyle = col;
    ctx.font = `bold ${label.length > 1 ? 50 : 58}px Georgia, "Times New Roman", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(label, 42, 70);
    drawSuit(ctx, suit, 42, 104, 42);
    ctx.restore();
  }
}

// ---------- Zahlenkarten ----------
const PIPS = {
  '9': [[0.28, 0.2], [0.28, 0.4], [0.28, 0.6], [0.28, 0.8], [0.72, 0.2], [0.72, 0.4], [0.72, 0.6], [0.72, 0.8], [0.5, 0.5]],
  '10': [[0.28, 0.2], [0.28, 0.4], [0.28, 0.6], [0.28, 0.8], [0.72, 0.2], [0.72, 0.4], [0.72, 0.6], [0.72, 0.8], [0.5, 0.3], [0.5, 0.7]],
};

function drawPips(ctx, suit, rank) {
  const x0 = 70, y0 = 60, w = CARD_W - 140, h = CARD_H - 120;
  for (const [px, py] of PIPS[rank]) {
    const x = x0 + px * w, y = y0 + py * h;
    drawSuit(ctx, suit, x, y, 64, py > 0.55 ? Math.PI : 0);
  }
}

function drawAce(ctx, suit) {
  const cx = CARD_W / 2, cy = CARD_H / 2;
  ctx.save();
  ctx.strokeStyle = suit === 'H' || suit === 'D' ? 'rgba(192,24,42,0.35)' : 'rgba(20,20,20,0.3)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(cx, cy, 118, 150, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(cx, cy, 108, 140, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  drawSuit(ctx, suit, cx, cy, 170);
  if (suit === 'S') {
    ctx.save();
    ctx.fillStyle = '#fffdf6';
    ctx.font = 'italic bold 22px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText('KD', cx, cy + 12);
    ctx.restore();
  }
}

// ---------- Bildkarten (doppelköpfig) ----------
const COURT = {
  K: { robe: ['#b3202c', '#1f3f8f'], trim: GOLD, hair: '#e8e2d0', beard: true, hat: 'crown' },
  Q: { robe: ['#1f3f8f', '#b3202c'], trim: GOLD, hair: '#7a4a1c', beard: false, hat: 'tiara' },
  J: { robe: ['#d8a526', '#b3202c'], trim: '#1f3f8f', hair: '#4a2c12', beard: false, hat: 'cap' },
};
const SUIT_TINT = { C: '#2e6b3a', S: '#27324f', H: '#9b1c2c', D: '#b8651b' };

function courtHalf(ctx, rank, suit, fx, fy, fw, fh) {
  const d = COURT[rank];
  const cx = fx + fw / 2;
  const headY = fy + fh * 0.3;
  const headR = fw * 0.13;

  // Gewand
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx - fw * 0.44, fy + fh);
  ctx.lineTo(cx - fw * 0.38, headY + headR * 1.6);
  ctx.quadraticCurveTo(cx, headY + headR * 0.9, cx + fw * 0.38, headY + headR * 1.6);
  ctx.lineTo(cx + fw * 0.44, fy + fh);
  ctx.closePath();
  ctx.fillStyle = d.robe[0];
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#1a1a1a';
  ctx.stroke();
  // Ärmel / Mantelhälfte
  ctx.beginPath();
  ctx.moveTo(cx + fw * 0.02, headY + headR * 1.3);
  ctx.quadraticCurveTo(cx + fw * 0.4, headY + headR * 1.7, cx + fw * 0.44, fy + fh);
  ctx.lineTo(cx + fw * 0.08, fy + fh);
  ctx.closePath();
  ctx.fillStyle = d.robe[1];
  ctx.fill();
  ctx.stroke();
  // Borte
  ctx.strokeStyle = d.trim;
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(cx - fw * 0.3, headY + headR * 1.75);
  ctx.quadraticCurveTo(cx, headY + headR * 2.6, cx + fw * 0.3, headY + headR * 1.75);
  ctx.stroke();
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(cx - fw * 0.06, headY + headR * 2.3);
  ctx.lineTo(cx - fw * 0.1, fy + fh);
  ctx.stroke();
  // Muster auf dem Gewand
  ctx.fillStyle = d.trim;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.arc(cx - fw * 0.26 + (i % 2) * 18, headY + headR * 2.6 + i * 18, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Attribut: Schwert (K), Blume (D), Hellebarde (B)
  ctx.save();
  ctx.lineCap = 'round';
  if (rank === 'K') {
    ctx.strokeStyle = '#8f96a3'; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(cx + fw * 0.3, fy + fh * 0.98); ctx.lineTo(cx + fw * 0.3, fy + fh * 0.2); ctx.stroke();
    ctx.strokeStyle = GOLD; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(cx + fw * 0.22, fy + fh * 0.72); ctx.lineTo(cx + fw * 0.38, fy + fh * 0.72); ctx.stroke();
  } else if (rank === 'Q') {
    ctx.strokeStyle = '#2d6a2d'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(cx + fw * 0.26, fy + fh * 0.98); ctx.quadraticCurveTo(cx + fw * 0.34, fy + fh * 0.7, cx + fw * 0.3, fy + fh * 0.55); ctx.stroke();
    ctx.fillStyle = '#c21d4a';
    for (let a = 0; a < 5; a++) {
      ctx.beginPath();
      ctx.arc(cx + fw * 0.3 + Math.cos(a * 1.256) * 9, fy + fh * 0.55 + Math.sin(a * 1.256) * 9, 7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = GOLD; ctx.beginPath(); ctx.arc(cx + fw * 0.3, fy + fh * 0.55, 5, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.strokeStyle = '#6b4520'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(cx - fw * 0.34, fy + fh * 0.98); ctx.lineTo(cx - fw * 0.34, fy + fh * 0.12); ctx.stroke();
    ctx.fillStyle = '#9aa1ad';
    ctx.beginPath();
    ctx.moveTo(cx - fw * 0.34, fy + fh * 0.04);
    ctx.lineTo(cx - fw * 0.28, fy + fh * 0.18);
    ctx.lineTo(cx - fw * 0.22, fy + fh * 0.22);
    ctx.lineTo(cx - fw * 0.34, fy + fh * 0.26);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // Kopf
  ctx.save();
  ctx.fillStyle = d.hair;
  ctx.beginPath();
  ctx.ellipse(cx, headY + headR * 0.1, headR * 1.18, headR * 1.25, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f2cfa6';
  ctx.beginPath();
  ctx.ellipse(cx, headY + headR * 0.1, headR * 0.86, headR, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 2; ctx.stroke();
  if (d.beard) {
    ctx.fillStyle = d.hair;
    ctx.beginPath();
    ctx.moveTo(cx - headR * 0.8, headY + headR * 0.35);
    ctx.quadraticCurveTo(cx, headY + headR * 2.1, cx + headR * 0.8, headY + headR * 0.35);
    ctx.quadraticCurveTo(cx, headY + headR * 0.95, cx - headR * 0.8, headY + headR * 0.35);
    ctx.fill(); ctx.stroke();
  }
  // Gesicht
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath(); ctx.arc(cx - headR * 0.33, headY, 2.6, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + headR * 0.33, headY, 2.6, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#8a3a2a'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx - headR * 0.2, headY + headR * 0.5); ctx.quadraticCurveTo(cx, headY + headR * 0.62, cx + headR * 0.2, headY + headR * 0.5); ctx.stroke();
  ctx.strokeStyle = '#b57a58';
  ctx.beginPath(); ctx.moveTo(cx, headY + headR * 0.05); ctx.lineTo(cx - headR * 0.08, headY + headR * 0.3); ctx.stroke();

  // Kopfbedeckung
  ctx.lineWidth = 2; ctx.strokeStyle = '#1a1a1a';
  const top = headY - headR * 0.85;
  if (d.hat === 'crown') {
    ctx.fillStyle = GOLD;
    ctx.beginPath();
    ctx.moveTo(cx - headR, top);
    ctx.lineTo(cx - headR, top - headR * 0.9);
    ctx.lineTo(cx - headR * 0.5, top - headR * 0.4);
    ctx.lineTo(cx, top - headR * 1.1);
    ctx.lineTo(cx + headR * 0.5, top - headR * 0.4);
    ctx.lineTo(cx + headR, top - headR * 0.9);
    ctx.lineTo(cx + headR, top);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#b3202c';
    ctx.beginPath(); ctx.arc(cx, top - headR * 0.3, 4, 0, Math.PI * 2); ctx.fill();
  } else if (d.hat === 'tiara') {
    ctx.fillStyle = GOLD;
    ctx.beginPath();
    ctx.moveTo(cx - headR * 0.8, top + 2);
    ctx.lineTo(cx - headR * 0.5, top - headR * 0.5);
    ctx.lineTo(cx, top - headR * 0.25);
    ctx.lineTo(cx + headR * 0.5, top - headR * 0.5);
    ctx.lineTo(cx + headR * 0.8, top + 2);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.moveTo(cx - headR * 1.2, top + headR * 0.3);
    ctx.quadraticCurveTo(cx - headR * 1.6, headY + headR * 1.4, cx - headR * 1.05, headY + headR * 1.7);
    ctx.lineTo(cx - headR * 0.9, top + headR * 0.4);
    ctx.fill();
  } else {
    ctx.fillStyle = '#b3202c';
    ctx.beginPath();
    ctx.ellipse(cx + headR * 0.15, top + 2, headR * 1.25, headR * 0.5, -0.15, Math.PI, Math.PI * 2);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#f4f1e8'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(cx + headR * 0.9, top - headR * 0.2); ctx.quadraticCurveTo(cx + headR * 1.8, top - headR * 1.2, cx + headR * 2.1, top - headR * 0.2); ctx.stroke();
  }
  ctx.restore();
}

function drawCourt(ctx, suit, rank) {
  const fx = 70, fy = 44, fw = CARD_W - 140, fh = CARD_H - 88;
  ctx.save();
  ctx.fillStyle = '#fbf3de';
  ctx.fillRect(fx, fy, fw, fh);
  // zarter Hintergrund in Farbton der Farbe
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = SUIT_TINT[suit];
  for (let i = 0; i < 14; i++) ctx.fillRect(fx, fy + i * (fh / 14), fw, fh / 28);
  ctx.globalAlpha = 1;
  for (const flip of [false, true]) {
    ctx.save();
    if (flip) { ctx.translate(CARD_W, CARD_H); ctx.rotate(Math.PI); }
    ctx.beginPath();
    ctx.rect(fx, fy, fw, fh / 2);
    ctx.clip();
    courtHalf(ctx, rank, suit, fx, fy, fw, fh / 2);
    drawSuit(ctx, suit, fx + 26, fy + 30, 36);
    ctx.restore();
  }
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(fx, fy + fh / 2); ctx.lineTo(fx + fw, fy + fh / 2); ctx.stroke();
  ctx.strokeStyle = suitColor(suit);
  ctx.lineWidth = 4;
  ctx.strokeRect(fx, fy, fw, fh);
  ctx.restore();
}

// ---------- Rückseite ----------
function drawBack(ctx) {
  roundRect(ctx, 2, 2, CARD_W - 4, CARD_H - 4, 26);
  ctx.fillStyle = '#fbf8ef';
  ctx.fill();
  ctx.save();
  roundRect(ctx, 18, 18, CARD_W - 36, CARD_H - 36, 16);
  ctx.clip();
  ctx.fillStyle = '#7d1420';
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.strokeStyle = 'rgba(255,215,160,0.35)';
  ctx.lineWidth = 2;
  for (let i = -CARD_H; i < CARD_W + CARD_H; i += 22) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + CARD_H, CARD_H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(i, CARD_H); ctx.lineTo(i + CARD_H, 0); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,215,160,0.5)';
  for (let x = 18; x < CARD_W; x += 22) for (let y = 18; y < CARD_H; y += 22) {
    ctx.beginPath(); ctx.arc(x + ((y / 22) % 2 ? 11 : 0), y, 1.8, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  ctx.strokeStyle = '#d9b36a';
  ctx.lineWidth = 4;
  roundRect(ctx, 26, 26, CARD_W - 52, CARD_H - 52, 12);
  ctx.stroke();
  const cx = CARD_W / 2, cy = CARD_H / 2;
  ctx.fillStyle = '#5c0e17';
  ctx.beginPath(); ctx.ellipse(cx, cy, 82, 110, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#d9b36a'; ctx.lineWidth = 5; ctx.stroke();
  ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(cx, cy, 70, 98, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#e8c982';
  ctx.font = 'bold italic 58px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('KD', cx, cy + 4);
  ['C', 'S', 'H', 'D'].forEach((s, i) => {
    const a = (i / 4) * Math.PI * 2 - Math.PI / 2;
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.translate(cx + Math.cos(a) * 124, cy + Math.sin(a) * 160);
    ctx.scale(0.2, 0.2);
    suitPath(ctx, s);
    ctx.fillStyle = '#e8c982';
    ctx.fill();
    ctx.restore();
  });
}

// ---------- Öffentliche API ----------
const canvasCache = new Map();
const textureCache = new Map();
const urlCache = new Map();
let maxAniso = 8;
export function setMaxAnisotropy(n) { maxAniso = n; }

export function getCardCanvas(key) {
  if (canvasCache.has(key)) return canvasCache.get(key);
  const c = document.createElement('canvas');
  c.width = CARD_W; c.height = CARD_H;
  const ctx = c.getContext('2d');
  if (key === 'back') drawBack(ctx);
  else {
    const suit = key[0], rank = key.slice(1);
    paper(ctx);
    const label = { '9': '9', '10': '10', J: 'B', Q: 'D', K: 'K', A: 'A' }[rank];
    if (rank === '9' || rank === '10') drawPips(ctx, suit, rank);
    else if (rank === 'A') drawAce(ctx, suit);
    else drawCourt(ctx, suit, rank);
    corners(ctx, suit, label);
  }
  canvasCache.set(key, c);
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
  if (!urlCache.has(key)) urlCache.set(key, getCardCanvas(key).toDataURL('image/png'));
  return urlCache.get(key);
}
