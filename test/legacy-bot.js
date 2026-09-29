// Alte Heuristik-Bots (Stand vor der Monte-Carlo-KI) – nur noch als Vergleichsgegner für test/bench.js.
import {
  isTrump, trumpRank, keyOf, rankOf, suitOf, cardValue, followSuit, beats, trickWinnerIndex, trickPoints,
  makeTrumpContext, buildDeck, SOLO_TYPES,
} from '../shared/cards.js';

export function botAct(round, seat) {
  switch (round.phase) {
    case 'reservation': return round.reserve(seat, chooseReservation(round, seat));
    case 'armutGive': return round.armutGive(seat, chooseArmutGive(round, seat));
    case 'armutOffer': return round.armutAnswer(seat, acceptArmut(round, seat));
    case 'armutReturn': return round.armutReturn(seat, chooseArmutReturn(round, seat));
    case 'playing': {
      if (round.trickComplete() || round.turn !== seat) return;
      const lv = chooseAnnouncement(round, seat);
      if (lv != null) round.announce(seat, lv);
      return round.play(seat, chooseCard(round, seat));
    }
  }
}

// ---------- Handbewertung ----------
function trumpWeight(ctx, c) {
  const n = Object.keys(ctx.order).length || 1;
  return 0.6 + 2.4 * (trumpRank(ctx, c) / n);
}

function strength(ctx, hand) {
  let s = 0;
  const suitCount = {};
  for (const c of hand) {
    if (isTrump(ctx, c)) s += trumpWeight(ctx, c);
    else {
      suitCount[suitOf(c)] = (suitCount[suitOf(c)] || 0) + 1;
      if (rankOf(c) === 'A') s += 1;
    }
  }
  const fehlSuits = ['C', 'S', 'H', 'D'].filter((x) => ctx.mode !== x);
  for (const f of fehlSuits) if (!suitCount[f] && ctx.mode !== 'damen' && ctx.mode !== 'buben' && ctx.mode !== 'fleischlos') s += 0.5;
  return s;
}

function trumpCount(ctx, hand) { return hand.filter((c) => isTrump(ctx, c)).length; }

function soloScore(round, hand, type) {
  const mode = SOLO_TYPES[type].mode;
  const ctx = makeTrumpContext(mode, round.rules);
  const n = Object.keys(ctx.order).length;
  const trumps = hand.filter((c) => isTrump(ctx, c));
  const high = trumps.filter((c) => trumpRank(ctx, c) > n - 4).length; // Dullen + Kreuz/Pik/Herz-Damen
  const aces = hand.filter((c) => !isTrump(ctx, c) && rankOf(c) === 'A').length;
  const tens = hand.filter((c) => !isTrump(ctx, c) && rankOf(c) === '10').length;
  const hs = round.handSize;
  if (mode === 'damen' || mode === 'buben') {
    const top = trumps.filter((c) => keyOf(c)[0] === 'C').length;
    return trumps.length >= 5 && top >= 1 && trumps.length + aces + top >= hs - 1 ? trumps.length + aces + top : 0;
  }
  if (mode === 'fleischlos') return aces >= 5 && aces + tens >= hs - 3 ? aces + tens : 0;
  const ok = (trumps.length >= hs - 2 && high >= 5) || (trumps.length >= hs - 3 && high >= 6);
  return ok ? trumps.length + high + aces : 0;
}

function chooseReservation(round, seat) {
  const opts = round.reservationOptions(seat);
  const hand = round.hands[seat];
  if (opts.includes('schmeissen')) return 'schmeissen';
  let bestSolo = null, bestScore = 0;
  for (const o of opts.filter((x) => x.startsWith('solo_'))) {
    const sc = soloScore(round, hand, o.slice(5));
    if (sc > bestScore) { bestScore = sc; bestSolo = o; }
  }
  if (bestSolo) return bestSolo;
  if (opts.includes('armut')) return 'armut';
  if (opts.includes('hochzeit')) {
    return trumpCount(round.normalCtx, hand) >= 8 && strength(round.normalCtx, hand) > 17 ? 'gesund' : 'hochzeit';
  }
  return 'gesund';
}

function chooseArmutGive(round, seat) {
  const hand = round.hands[seat];
  const trumps = hand.filter((c) => isTrump(round.normalCtx, c));
  const rest = hand.filter((c) => !trumps.includes(c)).sort((a, b) => cardValue(a) - cardValue(b));
  return [...trumps, ...rest].slice(0, 3);
}

function acceptArmut(round, seat) {
  const hand = round.hands[seat];
  const ctx = round.normalCtx;
  const high = hand.filter((c) => trumpRank(ctx, c) >= ctx.order.HQ).length;
  return trumpCount(ctx, hand) >= 6 && high >= 3;
}

function chooseArmutReturn(round, seat) {
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

// ---------- Ansagen ----------
function chooseAnnouncement(round, seat) {
  const opts = round.announceOptions(seat);
  if (!opts.length) return null;
  const party = round.parties[seat];
  const hand = round.hands[seat];
  const ctx = round.ctx;
  const cur = round.ann[party];
  const s = strength(ctx, hand) + (Math.random() - 0.5) * 2;
  if (cur < 0 && opts.includes(0)) {
    const soloist = round.parties.filter((p) => p === 're').length === 1 && party === 're';
    const needed = soloist ? 24 : 17;
    if (s * (round.handSize === 12 ? 1 : 1.2) >= needed && trumpCount(ctx, hand) >= Math.ceil(round.handSize * 0.55)) return 0;
  }
  if (cur === 0 && opts.includes(1)) {
    const known = round.knownParties(seat);
    const partyPts = round.tricks.filter((t) => known[t.winner] === party).reduce((a, t) => a + t.points, 0);
    const oppPts = round.tricks.filter((t) => known[t.winner] && known[t.winner] !== party).reduce((a, t) => a + t.points, 0);
    if (partyPts >= 95 && oppPts <= 25 && strength(ctx, hand) >= hand.length * 1.6) return 1;
  }
  return null;
}

// ---------- Kartenwahl ----------
function cost(ctx, c) {
  let v = cardValue(c);
  if (isTrump(ctx, c)) v += 3 + trumpRank(ctx, c) * 0.9;
  if (keyOf(c) === 'DA' && ctx.mode === 'D' && !ctx.schweine) v += 8; // Fuchs nicht verschenken
  return v;
}
const cheapest = (ctx, cards) => cards.slice().sort((a, b) => cost(ctx, a) - cost(ctx, b))[0];

function schmierValue(ctx, c) {
  let v = cardValue(c);
  if (isTrump(ctx, c)) v -= 2 + trumpRank(ctx, c) * 0.6;
  return v;
}
const schmier = (ctx, cards) => cards.slice().sort((a, b) => schmierValue(ctx, b) - schmierValue(ctx, a))[0];

function power(ctx, c) { return isTrump(ctx, c) ? 100 + trumpRank(ctx, c) : cardValue(c); }

function chooseCard(round, seat) {
  const ctx = round.ctx;
  const hand = round.hands[seat];
  const legal = round.legalFor(seat);
  if (legal.length === 1) return legal[0];
  const plays = round.trick.plays;
  const known = round.knownParties(seat);
  const me = known[seat];
  const isPartner = (s) => s !== seat && me && known[s] === me;
  const isLast = round.isLastTrick();

  const played = new Set();
  for (const t of round.tricks) for (const p of t.plays) played.add(p.card);
  for (const p of plays) played.add(p.card);
  const unseen = buildDeck(round.rules.mitNeunen).filter((c) => !played.has(c) && !hand.includes(c));
  const suitLedBefore = (suit) => round.tricks.some((t) => followSuit(ctx, t.plays[0].card) === suit);

  if (!plays.length) return chooseLead(round, seat, legal, suitLedBefore, me, unseen);

  const best = plays[trickWinnerIndex(ctx, plays, isLast)];
  const led = followSuit(ctx, plays[0].card);
  const after = [];
  for (let i = 1; i <= 3 - plays.length; i++) after.push((seat + i) % 4);
  const afterAllPartners = after.every(isPartner);
  const beatable = unseen.some((c) => beats(ctx, c, best.card, led, isLast));
  const firstRoundFehlAce = led !== 'T' && !suitLedBefore(led) && rankOf(best.card) === 'A' && !isTrump(ctx, best.card);
  const winners = legal.filter((c) => beats(ctx, c, best.card, led, isLast));
  const pts = trickPoints(plays);

  if (isPartner(best.seat)) {
    const safe = !after.length || afterAllPartners || !beatable || firstRoundFehlAce;
    if (safe) return schmier(ctx, legal);
    if (winners.length && pts >= 15) {
      const strong = winners.filter((c) => !unseen.some((u) => beats(ctx, u, c, led, isLast)));
      if (strong.length) return strong.sort((a, b) => power(ctx, a) - power(ctx, b))[0];
    }
    return cheapest(ctx, legal);
  }

  if (winners.length) {
    if (!after.length || afterAllPartners) {
      return winners.sort((a, b) => (cardValue(b) - power(ctx, b) * 0.05) - (cardValue(a) - power(ctx, a) * 0.05))[0];
    }
    const following = led !== 'T' && legal.every((c) => followSuit(ctx, c) === led);
    if (following) {
      const ace = winners.find((c) => rankOf(c) === 'A');
      if (ace && !suitLedBefore(led)) return ace;
      return cheapest(ctx, legal);
    }
    // Trumpf-Stich oder Abstechen
    const safeWinners = winners.filter((c) => !unseen.some((u) => beats(ctx, u, c, led, isLast)));
    if (safeWinners.length && pts >= 8) return safeWinners.sort((a, b) => power(ctx, a) - power(ctx, b))[0];
    const solid = winners.filter((c) => !isTrump(ctx, c) || trumpRank(ctx, c) >= (ctx.order.HJ || 0));
    if ((pts >= 10 || led !== 'T') && solid.length) return solid.sort((a, b) => cost(ctx, a) - cost(ctx, b))[0];
    if (pts >= 10) return winners.sort((a, b) => cost(ctx, a) - cost(ctx, b))[0];
  }
  return cheapest(ctx, legal);
}

function chooseLead(round, seat, legal, suitLedBefore, me, unseen) {
  const ctx = round.ctx;
  const hand = round.hands[seat];
  const trumps = hand.filter((c) => isTrump(ctx, c));
  const soloist = round.parties.filter((p) => p === 're').length === 1 && round.parties[seat] === 're';
  const suitCount = (s) => hand.filter((c) => !isTrump(ctx, c) && suitOf(c) === s).length;

  if (soloist && trumps.length) {
    const sure = trumps.filter((c) => !unseen.some((u) => isTrump(ctx, u) && trumpRank(ctx, u) > trumpRank(ctx, c)));
    if (sure.length) return sure.sort((a, b) => trumpRank(ctx, a) - trumpRank(ctx, b))[0];
    if (trumps.length >= 3) return trumps.sort((a, b) => cost(ctx, a) - cost(ctx, b))[0];
  }

  const aces = hand.filter((c) => !isTrump(ctx, c) && rankOf(c) === 'A' && !suitLedBefore(suitOf(c)));
  if (aces.length) return aces.sort((a, b) => suitCount(suitOf(a)) - suitCount(suitOf(b)))[0];

  if (me === 're' && trumps.length >= 5) {
    const mid = trumps.filter((c) => keyOf(c) !== 'DA').sort((a, b) => trumpRank(ctx, a) - trumpRank(ctx, b));
    if (mid.length) return mid[0];
  }
  const fehl = hand.filter((c) => !isTrump(ctx, c));
  if (fehl.length) {
    return fehl.sort((a, b) => suitCount(suitOf(b)) - suitCount(suitOf(a)) || cardValue(a) - cardValue(b))[0];
  }
  return cheapest(ctx, legal);
}
