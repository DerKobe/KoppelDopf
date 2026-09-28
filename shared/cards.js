// Gemeinsame Kartenlogik für Server und Client (ES-Modul, keine Abhängigkeiten).
// Karten-IDs: <Farbe><Rang><Kopie>, z.B. "H10a", "CQb".
// Farben: C = Kreuz, S = Pik, H = Herz, D = Karo. Ränge: 9, 10, J (Bube), Q (Dame), K (König), A (Ass).

export const SUITS = ['C', 'S', 'H', 'D'];
export const RANKS = ['9', '10', 'J', 'Q', 'K', 'A'];
export const SUIT_NAMES = { C: 'Kreuz', S: 'Pik', H: 'Herz', D: 'Karo' };
export const SUIT_SYMBOLS = { C: '♣', S: '♠', H: '♥', D: '♦' };
export const RANK_LABELS = { '9': '9', '10': '10', J: 'B', Q: 'D', K: 'K', A: 'A' };
export const RANK_NAMES = { '9': 'Neun', '10': 'Zehn', J: 'Bube', Q: 'Dame', K: 'König', A: 'Ass' };
export const VALUES = { '9': 0, '10': 10, J: 2, Q: 3, K: 4, A: 11 };
const FEHL_ORDER = { '9': 1, J: 2, Q: 3, K: 4, '10': 5, A: 6 };

export const SOLO_TYPES = {
  damen: { label: 'Damensolo', mode: 'damen' },
  buben: { label: 'Bubensolo', mode: 'buben' },
  C: { label: 'Kreuzsolo', mode: 'C' },
  S: { label: 'Piksolo', mode: 'S' },
  H: { label: 'Herzsolo', mode: 'H' },
  D: { label: 'Karosolo', mode: 'D' },
  fleischlos: { label: 'Fleischloser', mode: 'fleischlos' },
};

export const LEVEL_LABELS = ['', 'keine 90', 'keine 60', 'keine 30', 'schwarz'];
export function announceLabel(party, level) {
  return level === 0 ? (party === 're' ? 'Re' : 'Kontra') : LEVEL_LABELS[level];
}

export function suitOf(id) { return id[0]; }
export function rankOf(id) { return id.slice(1, -1); }
export function keyOf(id) { return id.slice(0, -1); }
export function cardValue(id) { return VALUES[rankOf(id)]; }
export function cardName(id) { return `${SUIT_NAMES[suitOf(id)]} ${RANK_NAMES[rankOf(id)]}`; }
export function isRed(id) { const s = suitOf(id); return s === 'H' || s === 'D'; }

export function buildDeck(withNines) {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) {
    if (r === '9' && !withNines) continue;
    deck.push(s + r + 'a', s + r + 'b');
  }
  return deck;
}

export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Trumpf-Kontext: mode ist 'D' (Normalspiel/Karo-Trumpf), 'C', 'S', 'H', 'damen', 'buben' oder 'fleischlos'.
export function makeTrumpContext(mode, rules, opts = {}) {
  const dullen = rules.dullen !== 'aus';
  const superKey = rules.mitNeunen ? 'D9' : 'DK';
  let list = [];
  if (mode === 'damen') list = ['CQ', 'SQ', 'HQ', 'DQ'];
  else if (mode === 'buben') list = ['CJ', 'SJ', 'HJ', 'DJ'];
  else if (mode === 'fleischlos') list = [];
  else {
    if (dullen) list.push('H10');
    list.push('CQ', 'SQ', 'HQ', 'DQ', 'CJ', 'SJ', 'HJ', 'DJ');
    const ranks = mode === 'H' && dullen ? ['A', 'K', '9'] : ['A', '10', 'K', '9'];
    list.push(...ranks.map((r) => mode + r));
    if (mode === 'D' && opts.schweine) {
      list = ['DA', ...list.filter((k) => k !== 'DA')];
      if (opts.superschweine) list = [superKey, ...list.filter((k) => k !== superKey)];
    }
  }
  if (!rules.mitNeunen) list = list.filter((k) => !k.endsWith('9'));
  const order = {};
  list.forEach((k, i) => { order[k] = list.length - i; });
  return {
    mode,
    order,
    dulle: dullen && list.includes('H10') ? 'H10' : null,
    dullenRule: rules.dullen,
    schweine: !!opts.schweine,
    superschweine: !!opts.superschweine,
    superKey,
  };
}

export function isTrump(ctx, id) { return keyOf(id) in ctx.order; }
export function trumpRank(ctx, id) { return ctx.order[keyOf(id)] ?? 0; }
export function followSuit(ctx, id) { return isTrump(ctx, id) ? 'T' : suitOf(id); }
export function fehlRank(id) { return FEHL_ORDER[rankOf(id)]; }

export function legalCards(ctx, hand, trickCards) {
  if (!trickCards.length) return hand.slice();
  const led = followSuit(ctx, trickCards[0]);
  const matching = hand.filter((c) => followSuit(ctx, c) === led);
  return matching.length ? matching : hand.slice();
}

// true, wenn Karte c die bisher beste Karte b schlägt.
export function beats(ctx, c, b, led, isLastTrick) {
  const kc = keyOf(c), kb = keyOf(b);
  const tc = kc in ctx.order, tb = kb in ctx.order;
  if (tc && !tb) return true;
  if (!tc && tb) return false;
  if (tc && tb) {
    if (ctx.order[kc] !== ctx.order[kb]) return ctx.order[kc] > ctx.order[kb];
    if (kc === ctx.dulle) {
      if (ctx.dullenRule === 'zweite') return true;
      if (ctx.dullenRule === 'zweite_ausser_letzter') return !isLastTrick;
    }
    return false;
  }
  if (suitOf(c) !== led) return false;
  if (suitOf(b) !== led) return true;
  return FEHL_ORDER[rankOf(c)] > FEHL_ORDER[rankOf(b)];
}

// plays: [{seat, card}] -> Index der gewinnenden Karte
export function trickWinnerIndex(ctx, plays, isLastTrick) {
  const led = followSuit(ctx, plays[0].card);
  let best = 0;
  for (let i = 1; i < plays.length; i++) {
    if (beats(ctx, plays[i].card, plays[best].card, led, isLastTrick)) best = i;
  }
  return best;
}

export function trickPoints(plays) {
  return plays.reduce((s, p) => s + cardValue(p.card), 0);
}

// Sortierung: Trümpfe (hoch -> niedrig) links, danach Fehlfarben.
export function sortHand(ctx, hand) {
  const suitOrder = { C: 0, S: 1, H: 2, D: 3 };
  const score = (c) => {
    if (isTrump(ctx, c)) return 1000 - trumpRank(ctx, c) * 2 - (c.endsWith('a') ? 0 : 1);
    return 2000 + suitOrder[suitOf(c)] * 20 + (10 - FEHL_ORDER[rankOf(c)]) * 2 + (c.endsWith('a') ? 0 : 1);
  };
  return hand.slice().sort((a, b) => score(a) - score(b));
}

export function trumpModeLabel(mode) {
  switch (mode) {
    case 'D': return 'Karo';
    case 'C': return 'Kreuz';
    case 'S': return 'Pik';
    case 'H': return 'Herz';
    case 'damen': return 'nur Damen';
    case 'buben': return 'nur Buben';
    case 'fleischlos': return 'keine Trümpfe';
    default: return mode;
  }
}
