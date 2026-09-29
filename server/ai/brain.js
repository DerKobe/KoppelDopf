// Monte-Carlo-Entscheidungen der Bots („Perfect Information Monte Carlo“):
// 1) Aus Sicht des Bots sammeln, was ein Mensch am Tisch wissen kann (eigene Karten, gespielte Karten,
//    Fehlfarben der Mitspieler, bekannte Parteien, Indizien nach den Doko-Faustregeln).
// 2) Viele dazu passende Verteilungen der unbekannten Karten würfeln.
// 3) In jeder Verteilung jede Handlungsoption bis zum Spielende durchspielen und die mittlere Punktzahl vergleichen.
// Die Bots schummeln nicht: die echten Karten der Mitspieler fließen nirgends ein.
import { buildDeck, shuffle, keyOf, rankOf, followSuit, isTrump, makeTrumpContext, beats, trickWinnerIndex, cardValue } from '../../shared/cards.js';
import { playout } from './policy.js';

const now = () => performance.now();
const isCQ = (c) => keyOf(c) === 'CQ';

// ---------- Wissen ----------
export function buildKnowledge(round, viewer) {
  const ctx = round.ctx;
  const allTricks = round.trick && round.trick.plays.length ? [...round.tricks, round.trick] : round.tricks;
  const seen = new Set();
  for (const t of allTricks) for (const p of t.plays) seen.add(p.card);
  const own = new Set(round.hands[viewer]);
  const unknown = buildDeck(round.rules.mitNeunen).filter((c) => !seen.has(c) && !own.has(c));
  const need = round.hands.map((h, s) => (s === viewer ? 0 : h.length));

  // Wer eine Farbe nicht bedient hat, hat sie nicht mehr (gilt auch für Trumpf)
  const voids = [0, 1, 2, 3].map(() => new Set());
  for (const t of allTricks) {
    const led = followSuit(ctx, t.plays[0].card);
    for (let i = 1; i < t.plays.length; i++) {
      const p = t.plays[i];
      if (followSuit(ctx, p.card) !== led) voids[p.seat].add(led);
    }
  }

  const known = round.knownParties(viewer);
  const normalish = round.gameType === 'normal' || round.gameType === 'stille'; // stille ist für andere nicht erkennbar
  const forced = new Map();
  const noCQ = new Set();
  const needCQ = [];
  if (normalish) {
    for (let s = 0; s < 4; s++) {
      if (s === viewer) continue;
      if (known[s] === 'kontra') noCQ.add(s);
      if (known[s] === 're' && !round.cqPlayed.includes(s)) needCQ.push(s);
    }
  }
  if (round.gameType === 'hochzeit' && round.hochzeiter !== viewer) {
    for (const c of unknown) if (isCQ(c)) forced.set(c, round.hochzeiter);
  }
  if (ctx.schweine && round.schweineShown && round.schweineHolder !== viewer) {
    for (const c of unknown) if (keyOf(c) === 'DA') forced.set(c, round.schweineHolder);
  }
  const a = round.armut;
  if (a && a.rich != null) {
    if (viewer === a.rich && a.returned) for (const c of a.returned) if (!seen.has(c)) forced.set(c, a.poor);
    if (viewer === a.poor && a.cards) for (const c of a.cards) if (!seen.has(c) && !own.has(c)) forced.set(c, a.rich);
  }

  return {
    viewer, unknown, need, voids, forced, noCQ, needCQ, normalish, known,
    evidence: normalish ? collectEvidence(round, viewer, known, allTricks) : null,
    hochzeitAllowed: !!round.rules.hochzeit,
  };
}

// Indizien (log-Gewichte, positiv = eher Re) nach den gängigen Faustregeln
function collectEvidence(round, viewer, known, allTricks) {
  const ctx = round.ctx;
  const ev = [0, 0, 0, 0];
  const ledSuits = new Set();
  allTricks.forEach((t, i) => {
    const L = t.plays[0];
    const led = followSuit(ctx, L.card);
    if (i <= 1 && keyOf(L.card) === 'H10' && ctx.dulle) ev[L.seat] += 0.8; // „Wer im 1./2. Stich die Dulle vorspielt, ist Re“
    if (led !== 'T' && rankOf(L.card) === 'A' && !ledSuits.has(led)) {
      for (let j = 1; j < t.plays.length; j++) {
        const p = t.plays[j];
        if (followSuit(ctx, p.card) === led && (rankOf(p.card) === '10' || rankOf(p.card) === 'A')) ev[p.seat] -= 0.5; // Kontra schmiert
      }
    }
    if (led === 'T') {
      for (let j = 1; j < t.plays.length; j++) {
        const k = keyOf(t.plays[j].card);
        if (k === 'D10' || k === 'DA') ev[t.plays[j].seat] -= 0.45; // Karo-Voller auf Trumpf kommt meist von Kontra
        if (j <= 2 && k === 'SQ') ev[t.plays[j].seat] -= 0.6; // „Eine Blaue an Position 2 oder 3 ist Kontra“
      }
    }
    ledSuits.add(led);
  });
  for (let s = 0; s < 4; s++) if (s === viewer || known[s]) ev[s] = 0;
  return ev;
}

// ---------- Verteilungen würfeln ----------
export function sampleHands(round, K, rng = Math.random) {
  const ctx = round.ctx;
  const V = K.viewer;
  const eligible = (c, s, cap) => s !== V && cap[s] > 0 && !K.voids[s].has(followSuit(ctx, c)) && !(isCQ(c) && K.noCQ.has(s));
  for (let attempt = 0; attempt < 80; attempt++) {
    const relax = attempt >= 60; // Notfall: Fehlfarben-Wissen ignorieren, falls es (z.B. durch Ungenauigkeit) unerfüllbar ist
    const hands = round.hands.map((h, s) => (s === V ? h.slice() : []));
    const cap = K.need.slice();
    let ok = true;
    for (const [c, s] of K.forced) { if (cap[s] <= 0) { ok = false; break; } hands[s].push(c); cap[s]--; }
    if (!ok) continue;
    const pool = shuffle(K.unknown.filter((c) => !K.forced.has(c)), rng);
    for (const s of K.needCQ) {
      if (hands[s].some(isCQ)) continue;
      const i = pool.findIndex(isCQ);
      if (i < 0 || cap[s] <= 0) { ok = false; break; }
      hands[s].push(pool[i]); pool.splice(i, 1); cap[s]--;
    }
    if (!ok) continue;
    // am stärksten eingeschränkte Karten zuerst verteilen
    const staticCount = (c) => [0, 1, 2, 3].filter((s) => s !== V && K.need[s] > 0 && (relax || !K.voids[s].has(followSuit(ctx, c))) && !(isCQ(c) && K.noCQ.has(s))).length;
    const order = pool.map((c) => [staticCount(c), c]).sort((x, y) => x[0] - y[0]).map((x) => x[1]);
    for (const c of order) {
      const el = [0, 1, 2, 3].filter((s) => (relax ? s !== V && cap[s] > 0 && !(isCQ(c) && K.noCQ.has(s)) : eligible(c, s, cap)));
      if (!el.length) { ok = false; break; }
      let r = rng() * el.reduce((a, s) => a + cap[s], 0);
      let pick = el[0];
      for (const s of el) { r -= cap[s]; if (r <= 0) { pick = s; break; } }
      hands[pick].push(c); cap[pick]--;
    }
    if (!ok) continue;
    // Stille Hochzeit ist selten, wenn Hochzeit erlaubt ist (die meisten würden sie ansagen)
    if (K.normalish && K.hochzeitAllowed && attempt < 40) {
      const st = [0, 1, 2, 3].some((s) => s !== V && cqTotal(round, hands, s) === 2);
      if (st && rng() < 0.75) continue;
    }
    return hands;
  }
  return null;
}

function cqTotal(round, hands, s) {
  return hands[s].filter(isCQ).length + round.cqPlayed.filter((x) => x === s).length;
}

// Gewicht einer Verteilung nach den Indizien
function worldWeight(round, K, hands) {
  if (!K.evidence) return 1;
  let lw = 0;
  for (let s = 0; s < 4; s++) {
    const e = K.evidence[s];
    if (!e) continue;
    lw += cqTotal(round, hands, s) > 0 ? e : -e;
  }
  return Math.exp(lw);
}

// Simulation aus einer gewürfelten Verteilung bauen (Parteien/Schweine aus der Verteilung, nicht aus der Wirklichkeit!)
export function makeSim(round, hands, K) {
  const sim = round.cloneForSim(hands);
  if (K.normalish) {
    let stille = null;
    for (let s = 0; s < 4; s++) {
      const n = cqTotal(round, hands, s);
      sim.parties[s] = n > 0 ? 're' : 'kontra';
      if (n === 2) stille = s;
    }
    sim.gameType = stille != null ? 'stille' : 'normal';
    sim.soloist = stille;
  }
  const R = round.rules;
  if (round.ctx.mode === 'D' && R.schweinchen && !round.schweineShown) {
    const daPlayed = round.tricks.some((t) => t.plays.some((p) => keyOf(p.card) === 'DA')) || (round.trick?.plays || []).some((p) => keyOf(p.card) === 'DA');
    const holder = daPlayed ? -1 : [0, 1, 2, 3].find((s) => hands[s].filter((c) => keyOf(c) === 'DA').length === 2);
    const schweine = holder !== undefined && holder >= 0;
    let superschweine = !!round.superShown;
    if (schweine && R.superschweinchen && !superschweine) {
      const sk = R.mitNeunen ? 'D9' : 'DK';
      superschweine = [0, 1, 2, 3].some((s) => hands[s].filter((c) => keyOf(c) === sk).length === 2);
    }
    sim.ctx = makeTrumpContext('D', R, { schweine, superschweine });
    if (schweine) sim.schweineHolder = holder;
  }
  return sim;
}

function utility(sim, seat) {
  const r = sim.result;
  const party = r.parties[seat];
  return r.perSeat[seat] + 0.02 * (r.pts[party] - 120);
}

// ---------- Faustregeln als Vorab-Bewertung ----------
// Die Simulationen kennen in jeder gewürfelten Verteilung alle Karten und halten deshalb z.B. „Ass jetzt oder später“
// für gleichwertig. Am echten Tisch ist das nicht so – und ein menschlicher Partner verlässt sich auf die üblichen
// Konventionen. Diese kleinen Zuschläge (in Spielpunkten) entscheiden bei ähnlich guten Karten.
function priors(round, seat, cands, safeShare) {
  const ctx = round.ctx;
  const plays = round.trick.plays;
  const hand = round.hands[seat];
  const known = round.knownParties(seat);
  const me = round.parties[seat];
  const solo = round.gameType === 'solo';
  const ledBefore = new Set(round.tricks.map((t) => followSuit(ctx, t.plays[0].card)));
  const trumps = hand.filter((c) => isTrump(ctx, c)).length;
  const suitLen = (s) => hand.filter((c) => !isTrump(ctx, c) && followSuit(ctx, c) === s).length;
  return cands.map((c) => {
    let p = 0;
    const tr = isTrump(ctx, c);
    const k = keyOf(c);
    if (!plays.length) {
      // Laufende Asse zuerst (Herz nur, wenn es wahrscheinlich noch durchgeht)
      if (!tr && rankOf(c) === 'A' && !ledBefore.has(followSuit(ctx, c))) {
        const s = followSuit(ctx, c);
        if (s !== 'H' || suitLen('H') <= 2 || ctx.mode !== 'D') p += 0.35;
      }
      // Trumpf nur aus der Stärke heraus (Faustregel 1)
      if (tr && !solo && ctx.mode === 'D' && trumps < 7) p -= 0.2;
      return p;
    }
    const led = followSuit(ctx, plays[0].card);
    const unclear = !known[plays[0].seat] || !me;
    // Faustregel 5: keine Dame (oder Dulle) an Position 2 bei ungeklärter Partnerschaft, wenn ein kleiner Trumpf da ist
    if (plays.length === 1 && led === 'T' && unclear && !solo && (k.endsWith('Q') || k === ctx.dulle)) {
      const lower = hand.some((x) => isTrump(ctx, x) && !keyOf(x).endsWith('Q') && keyOf(x) !== ctx.dulle);
      if (lower) p -= 0.35;
    }
    // Faustregel 7: die Dulle soll ~30 Augen bringen
    if (k === ctx.dulle && !solo) {
      const pts = plays.reduce((a, x) => a + cardValue(x.card), 0);
      const blackQueen = plays.some((x) => ['CQ', 'SQ'].includes(keyOf(x.card)) && known[x.seat] && known[x.seat] !== me);
      if (pts < 20 && !blackQueen) p -= 0.25;
    }
    // Schmieren auf den (wahrscheinlich) sicheren Stich des Partners
    const bestSeat = plays[trickWinnerIndex(ctx, plays, round.tricks.length === round.handSize - 1)].seat;
    if (me && known[bestSeat] === me && safeShare >= 0.8) p += 0.02 * cardValue(c);
    // Faustregeln 2/3: bei ungeklärter Partnerschaft schmiert Kontra auf ein laufendes Fehl-Ass, Re geizt
    const ledCard = plays[0].card;
    if (!solo && unclear && led !== 'T' && rankOf(ledCard) === 'A' && !ledBefore.has(led) && followSuit(ctx, c) === led) {
      p += (me === 'kontra' ? 0.015 : -0.01) * cardValue(c);
    }
    return p;
  });
}

// ---------- Kartenwahl ----------
export function chooseCard(round, seat, { budgetMs = 140, minWorlds = 10, maxWorlds = 80, rng = Math.random, noise = 0.12 } = {}) {
  const legal = round.legalFor(seat);
  if (legal.length === 1) return legal[0];
  const cands = [];
  const keys = new Set();
  for (const c of legal) if (!keys.has(keyOf(c))) { keys.add(keyOf(c)); cands.push(c); }
  if (cands.length === 1) return cands[0];
  const K = buildKnowledge(round, seat);
  const sums = new Array(cands.length).fill(0);
  let wsum = 0, worlds = 0, safeW = 0;
  const t0 = now();
  const plays = round.trick.plays;
  const isLast = round.tricks.length === round.handSize - 1;
  const led = plays.length ? followSuit(round.ctx, plays[0].card) : null;
  const bestPlay = plays.length ? plays[trickWinnerIndex(round.ctx, plays, isLast)] : null;
  while (worlds < maxWorlds && (worlds < minWorlds || now() - t0 < budgetMs)) {
    const hands = sampleHands(round, K, rng);
    if (!hands) break;
    const w = worldWeight(round, K, hands);
    // Anteil der Verteilungen, in denen der derzeit führende Stich von niemandem dahinter überstochen werden kann
    if (bestPlay) {
      let safe = true;
      for (let i = 1; i <= 3 - plays.length && safe; i++) {
        const o = (seat + i) % 4;
        const lg = hands[o].filter((c) => followSuit(round.ctx, c) === led);
        for (const c of lg.length ? lg : hands[o]) if (beats(round.ctx, c, bestPlay.card, led, isLast)) { safe = false; break; }
      }
      if (safe) safeW += w;
    }
    for (let i = 0; i < cands.length; i++) {
      const sim = makeSim(round, hands, K);
      sim.play(seat, cands[i]);
      playout(sim);
      sums[i] += w * utility(sim, seat);
    }
    wsum += w;
    worlds++;
  }
  if (!wsum) return cands[0];
  const prior = priors(round, seat, cands, safeW / wsum);
  // Etwas Zufall: nahezu gleichwertige Karten werden nicht immer gleich gewählt
  let best = 0, bestV = -Infinity;
  for (let i = 0; i < cands.length; i++) {
    const v = sums[i] / wsum + prior[i] + (rng() - 0.5) * noise;
    if (v > bestV) { bestV = v; best = i; }
  }
  return cands[best];
}

// ---------- Ansagen ----------
// Sagt an, wenn die Ansage im Mittel Punkte bringt und die eigene Partei mit hoher Sicherheit gewinnt.
// Faustregeln: Ansage zum letztmöglichen Zeitpunkt; Absagen nur mit ~8/9 Sicherheit.
export function chooseAnnouncement(round, seat, { budgetMs = 110, minWorlds = 16, maxWorlds = 60, rng = Math.random, aggression = 0 } = {}) {
  const options = round.announceOptions(seat);
  if (!options.length) return null;
  const party = round.parties[seat];
  const level = options[0];
  const handLen = round.hands[seat].length;
  const n = round.handSize - round.base;
  const other = party === 're' ? 'kontra' : 're';
  const stillNext = (handLen - 1 >= n - 1 - level) || (level === 0 && round.ann[other] >= 0 && handLen - 1 >= n - 2);
  const K = buildKnowledge(round, seat);
  let wsum = 0, gain = 0, wins = 0, worlds = 0;
  const t0 = now();
  const newAnn = { ...round.ann, [party]: level };
  while (worlds < maxWorlds && (worlds < minWorlds || now() - t0 < budgetMs)) {
    const hands = sampleHands(round, K, rng);
    if (!hands) break;
    const w = worldWeight(round, K, hands);
    const sim = playout(makeSim(round, hands, K));
    const r0 = sim.computeResult(round.ann);
    const r1 = sim.computeResult(newAnn);
    gain += w * (r1.perSeat[seat] - r0.perSeat[seat]);
    if (r1.winner === party) wins += w;
    wsum += w;
    worlds++;
  }
  if (!wsum) return null;
  const pWin = wins / wsum;
  const avgGain = gain / wsum;
  const required = (level === 0 ? 0.74 : 0.89) - aggression;
  if (pWin < required || avgGain <= 0.2) return null;
  // Starke Blätter sagen früh an (Information für den Partner), sonst so spät wie möglich
  if (stillNext && avgGain < 1.6) return null;
  return level;
}

// ---------- Vorbehalt (Solo? Hochzeit? Armut?) ----------
export function chooseReservation(round, seat, { budgetMs = 350, minWorlds = 12, maxWorlds = 40, rng = Math.random, aggression = 0 } = {}) {
  const opts = round.reservationOptions(seat);
  if (opts.includes('schmeissen')) return 'schmeissen';
  const cands = ['gesund', ...opts.filter((o) => o.startsWith('solo_') || o === 'hochzeit')];
  const own = new Set(round.hands[seat]);
  const unknown = buildDeck(round.rules.mitNeunen).filter((c) => !own.has(c));
  const stats = cands.map(() => ({ sum: 0, wins: 0 }));
  let worlds = 0;
  const t0 = now();
  while (worlds < maxWorlds && (worlds < minWorlds || now() - t0 < budgetMs)) {
    const pool = shuffle(unknown, rng);
    const hands = [0, 1, 2, 3].map((s) => (s === seat ? round.hands[seat].slice() : []));
    let k = 0;
    for (let s = 0; s < 4; s++) if (s !== seat) { hands[s] = pool.slice(k, k + round.handSize); k += round.handSize; }
    cands.forEach((cand, i) => {
      const sim = round.cloneForSim(hands);
      sim.reservations = ['gesund', 'gesund', 'gesund', 'gesund'];
      sim.reservations[seat] = cand;
      sim.resolveReservations();
      if (sim.phase !== 'playing') return;
      playout(sim);
      stats[i].sum += sim.result.perSeat[seat];
      if (sim.result.perSeat[seat] > 0) stats[i].wins++;
    });
    worlds++;
  }
  const ev = stats.map((s) => s.sum / Math.max(1, worlds));
  const pw = stats.map((s) => s.wins / Math.max(1, worlds));
  let choice = 'gesund', bestEv = ev[0];
  cands.forEach((cand, i) => {
    if (i === 0) return;
    const margin = cand === 'hochzeit' ? 0.2 : 1.2 - aggression * 4; // Solo nur mit deutlichem Vorteil
    const needWin = cand === 'hochzeit' ? 0 : 0.6 - aggression;
    if (ev[i] > bestEv + margin && pw[i] >= needWin) { bestEv = ev[i]; choice = cand; }
  });
  // Armut, wenn das normale Spiel voraussichtlich klar verloren geht
  if (choice === 'gesund' && opts.includes('armut') && ev[0] < -1) return 'armut';
  return choice;
}
