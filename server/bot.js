// Bots: Karten, Ansagen und Vorbehalte per Monte-Carlo-Simulation (server/ai/brain.js), Armut regelbasiert.
// Sie nutzen nur Informationen, die ein Mensch am Tisch auch hätte.
// level 'strong' (Standard) = volle Simulation, 'fast' = eine gewürfelte Verteilung (nur für schnelle Tests).
import { isTrump, trumpRank, keyOf, rankOf, suitOf, cardValue } from '../shared/cards.js';
import * as brain from './ai/brain.js';
import { policyCard } from './ai/policy.js';

// Jeder Bot hat eine leicht andere „Risikofreude“ (aus dem Namen abgeleitet, also stabil pro Bot)
function aggressionOf(round, seat) {
  const name = String(round.names?.[seat] || seat);
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return ((h % 11) - 5) / 100; // -0,05 … +0,05
}

export function botAct(round, seat, { level = 'strong', timeScale = 1 } = {}) {
  const aggression = aggressionOf(round, seat);
  const fast = level === 'fast';
  switch (round.phase) {
    case 'reservation':
      return round.reserve(seat, fast ? quickReservation(round, seat) : brain.chooseReservation(round, seat, { aggression, budgetMs: 350 * timeScale, maxWorlds: Math.round(40 * timeScale) }));
    case 'armutGive': return round.armutGive(seat, chooseArmutGive(round, seat));
    case 'armutOffer': return round.armutAnswer(seat, acceptArmut(round, seat));
    case 'armutReturn': return round.armutReturn(seat, chooseArmutReturn(round, seat));
    case 'playing': {
      if (round.trickComplete() || round.turn !== seat) return;
      const lv = brain.chooseAnnouncement(round, seat, fast ? { minWorlds: 3, maxWorlds: 3, aggression } : { aggression, budgetMs: 110 * timeScale, maxWorlds: Math.round(60 * timeScale) });
      if (lv != null) round.announce(seat, lv);
      return round.play(seat, fast ? quickCard(round, seat) : brain.chooseCard(round, seat, { budgetMs: 140 * timeScale, maxWorlds: Math.round(80 * timeScale) }));
    }
  }
}

// ---------- schneller Modus ----------
function quickCard(round, seat) {
  const K = brain.buildKnowledge(round, seat);
  const hands = brain.sampleHands(round, K);
  if (!hands) return round.legalFor(seat)[0];
  return policyCard(brain.makeSim(round, hands, K), seat);
}

function quickReservation(round, seat) {
  const opts = round.reservationOptions(seat);
  if (opts.includes('schmeissen')) return 'schmeissen';
  if (opts.includes('armut')) return 'armut';
  if (opts.includes('hochzeit')) return 'hochzeit';
  return 'gesund';
}

// ---------- Armut (regelbasiert) ----------
function chooseArmutGive(round, seat) {
  const hand = round.hands[seat];
  const trumps = hand.filter((c) => isTrump(round.normalCtx, c));
  // Auffüllen mit den schwächsten Fehlkarten, Asse behalten
  const rest = hand.filter((c) => !trumps.includes(c)).sort((a, b) => (rankOf(a) === 'A') - (rankOf(b) === 'A') || cardValue(a) - cardValue(b));
  return [...trumps, ...rest].slice(0, 3);
}

function acceptArmut(round, seat) {
  const hand = round.hands[seat];
  const ctx = round.normalCtx;
  const trumps = hand.filter((c) => isTrump(ctx, c)).length;
  const top = hand.filter((c) => trumpRank(ctx, c) >= ctx.order.SQ).length; // Dullen, Kreuz- und Pik-Damen
  const incoming = round.armut?.gaveTrumps ?? 0;
  return trumps >= 8 || (trumps + incoming >= 9 && top >= 2);
}

function chooseArmutReturn(round, seat) {
  // Fehl zurückgeben, möglichst ganze kurze Farben (Stechfarben schaffen), Trumpf behalten
  const ctx = round.normalCtx;
  const hand = round.hands[seat];
  const fehl = hand.filter((c) => !isTrump(ctx, c));
  const count = {};
  for (const c of fehl) count[suitOf(c)] = (count[suitOf(c)] || 0) + 1;
  fehl.sort((a, b) => count[suitOf(a)] - count[suitOf(b)] || cardValue(b) - cardValue(a));
  const pick = fehl.slice(0, 3);
  if (pick.length < 3) {
    const trumps = hand.filter((c) => isTrump(ctx, c)).sort((a, b) => trumpRank(ctx, a) - trumpRank(ctx, b));
    pick.push(...trumps.slice(0, 3 - pick.length));
  }
  return pick;
}

export { keyOf };
