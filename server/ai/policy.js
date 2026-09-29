// Schnelle Spielstrategie für die Simulationen der Bots (sieht in einer Simulation alle Karten).
// Sie setzt die gängigen Doppelkopf-Faustregeln um und dient als „Mitspieler-Modell“ beim Durchspielen:
// - laufende Fehl-Asse spielen, Trumpf nur aus der Stärke heraus
// - Partner-Stich nicht überstechen, sondern schmieren (Augen/Fuchs zum Partner)
// - billigst gewinnen, wenn dahinter kein Gegner mehr überstechen kann; sonst klein abwerfen
// - keine Füchse verschenken, gegnerische Füchse fangen, Karlchen im letzten Stich
import { isTrump, trumpRank, keyOf, rankOf, suitOf, cardValue, followSuit, beats, trickWinnerIndex, trickPoints } from '../../shared/cards.js';

// Team eines Sitzes; bei ungeklärter Hochzeit spielen alle gegen den Hochzeiter.
export function teamOf(sim, s) {
  const p = sim.parties[s];
  if (p) return p;
  return s === sim.hochzeiter ? 're' : 'kontra';
}

function trumpCount(ctx) { return Object.keys(ctx.order).length || 1; }

// Wie wertvoll ist eine Karte für spätere Stiche (in Augen-Größenordnung)?
export function futureValue(ctx, c) {
  if (isTrump(ctx, c)) return 2 + 10 * (trumpRank(ctx, c) / trumpCount(ctx));
  const r = rankOf(c);
  return r === 'A' ? 3 : r === '10' ? 1.5 : 0;
}

function isFuchs(sim, c) {
  return keyOf(c) === 'DA' && sim.ctx.mode === 'D' && !sim.ctx.schweine && sim.rules.fuchs;
}

function soloScoring(sim) {
  return sim.gameType === 'solo' || sim.gameType === 'stille' || sim.hochzeitFailed;
}

export function legalFrom(ctx, hand, led) {
  if (!led) return hand;
  const m = hand.filter((c) => followSuit(ctx, c) === led);
  return m.length ? m : hand;
}

// Kosten, eine Karte „wegzugeben“ (abwerfen, wenn der Gegner den Stich bekommt)
function discardCost(sim, c) {
  return cardValue(c) + futureValue(sim.ctx, c) + (isFuchs(sim, c) ? 15 : 0);
}

// Wert einer Karte beim Schmieren (Partner bekommt den Stich)
function schmierValue(sim, c) {
  return cardValue(c) - futureValue(sim.ctx, c) * 0.8 + (isFuchs(sim, c) ? 12 : 0);
}

const minBy = (arr, f) => { let b = arr[0], bv = f(b); for (let i = 1; i < arr.length; i++) { const v = f(arr[i]); if (v < bv) { bv = v; b = arr[i]; } } return b; };
const maxBy = (arr, f) => minBy(arr, (x) => -f(x));

// Nachfolgende Spieler im laufenden Stich
function seatsAfter(seat, playsSoFar) {
  const out = [];
  for (let i = 1; i <= 3 - playsSoFar; i++) out.push((seat + i) % 4);
  return out;
}

function canBeat(sim, s, card, led, isLast) {
  const lg = legalFrom(sim.ctx, sim.hands[s], led);
  for (const x of lg) if (beats(sim.ctx, x, card, led, isLast)) return true;
  return false;
}

// Wertung eines vollständigen Stichs aus Sicht eines Teams (Augen + Sonderpunkte in Augen-Größenordnung)
function trickScore(sim, plays, isLast, team) {
  const idx = trickWinnerIndex(sim.ctx, plays, isLast);
  const w = plays[idx].seat;
  const wt = teamOf(sim, w);
  let v = trickPoints(plays);
  if (!soloScoring(sim)) {
    const R = sim.rules;
    if (R.doppelkopf && v >= 40) v += 15;
    for (const p of plays) if (isFuchs(sim, p.card) && teamOf(sim, p.seat) !== wt) v += 15;
    if (R.karlchen && isLast && keyOf(plays[idx].card) === 'CJ') v += 15;
  }
  return wt === team ? v : -v;
}

// Folgen (nicht Ausspielen): regelbasiert, ohne Vorausschau – schnell genug für tausende Simulationen.
export function followCard(sim, seat, plays) {
  const ctx = sim.ctx;
  const led = followSuit(ctx, plays[0].card);
  const legal = legalFrom(ctx, sim.hands[seat], led);
  if (legal.length === 1) return legal[0];
  const isLast = sim.tricks.length === sim.handSize - 1;
  const me = teamOf(sim, seat);
  const bestIdx = trickWinnerIndex(ctx, plays, isLast);
  const best = plays[bestIdx];
  const after = seatsAfter(seat, plays.length);
  const oppAfter = after.filter((s) => teamOf(sim, s) !== me);
  const partnerAfter = after.filter((s) => teamOf(sim, s) === me);
  const pts = trickPoints(plays);

  const partnerWinning = teamOf(sim, best.seat) === me;
  if (partnerWinning && !oppAfter.some((o) => canBeat(sim, o, best.card, led, isLast))) {
    return maxBy(legal, (c) => schmierValue(sim, c)); // Standkarte des Partners: schmieren
  }

  const winners = legal.filter((c) => beats(ctx, c, best.card, led, isLast));
  const safe = winners.filter((c) => !oppAfter.some((o) => canBeat(sim, o, c, led, isLast)));
  const fuchsOnTable = plays.some((p) => isFuchs(sim, p.card) && teamOf(sim, p.seat) !== me);

  if (safe.length) {
    // Stich sicher holen – mit der billigsten sicheren Karte; bei Partner-Stich nur, wenn es sich lohnt
    if (partnerWinning && pts < 10 && !fuchsOnTable) return minBy(legal, (c) => discardCost(sim, c));
    return minBy(safe, (c) => futureValue(ctx, c) - cardValue(c) * 0.3);
  }

  // Kann mein Partner hinter mir den Stich sicher übernehmen? Dann schmieren statt verschwenden.
  for (const p of partnerAfter) {
    const pl = legalFrom(ctx, sim.hands[p], led);
    const pAfter = seatsAfter(p, plays.length + (p === after[0] ? 1 : 2)).filter((s) => teamOf(sim, s) !== me);
    const top = pl.filter((c) => beats(ctx, c, best.card, led, isLast) && !pAfter.some((o) => canBeat(sim, o, c, led, isLast)));
    if (top.length) return maxBy(legal, (c) => schmierValue(sim, c) * 0.6);
  }

  // Gegner führt und bleibt vorn: bei viel Augen den Gegner zu einem hohen Trumpf zwingen, sonst klein bleiben
  if (!partnerWinning && winners.length && (pts >= 20 || fuchsOnTable) && oppAfter.length) {
    return minBy(winners, (c) => futureValue(ctx, c));
  }
  return minBy(legal, (c) => discardCost(sim, c));
}

// Ausspielen: jede Karte mit einer Ein-Stich-Vorausschau bewerten (Mitspieler folgen regelbasiert).
export function leadCard(sim, seat) {
  const ctx = sim.ctx;
  const hand = sim.hands[seat];
  if (hand.length === 1) return hand[0];
  const isLast = sim.tricks.length === sim.handSize - 1;
  const me = teamOf(sim, seat);
  const seen = new Set();
  let best = hand[0], bestScore = -Infinity;
  const trumps = hand.filter((c) => isTrump(ctx, c)).length;
  for (const c of hand) {
    const k = keyOf(c);
    if (seen.has(k)) continue;
    seen.add(k);
    const plays = [{ seat, card: c }];
    const saved = sim.hands[seat];
    sim.hands[seat] = hand.filter((x) => x !== c);
    for (let i = 1; i < 4; i++) {
      const s = (seat + i) % 4;
      plays.push({ seat: s, card: followCard(sim, s, plays) });
    }
    sim.hands[seat] = saved;
    let score = trickScore(sim, plays, isLast, me) - futureValue(ctx, c) * 0.9;
    // Faustregel: Trumpf nur aus der Stärke heraus anspielen
    if (isTrump(ctx, c) && trumps < 7 && ctx.mode === 'D') score -= 4;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best;
}

export function policyCard(sim, seat) {
  const plays = sim.trick.plays;
  return plays.length ? followCard(sim, seat, plays) : leadCard(sim, seat);
}

// Spielt eine Simulation bis zum Ende (die Round-Logik rechnet Stiche, Hochzeit-Klärung und Abrechnung).
export function playout(sim) {
  let guard = 0;
  while (sim.phase === 'playing') {
    if (++guard > 200) throw new Error('playout: Endlosschleife');
    if (sim.trickComplete()) { sim.collectTrick(); continue; }
    const s = sim.turn;
    sim.play(s, policyCard(sim, s));
  }
  return sim;
}

export { suitOf };
