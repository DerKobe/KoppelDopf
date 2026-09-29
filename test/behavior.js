// Verhaltensanalyse: Halten die Bots die Doppelkopf-Faustregeln ein? (je 4 gleiche Bots, parallel)
// Aufruf: node test/behavior.js [Spiele] [Worker]
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Round } from '../server/round.js';
import { botAct as newBot } from '../server/bot.js';
import { botAct as oldBot } from './legacy-bot.js';
import { defaultRules } from '../shared/rules.js';
import { beats, followSuit, legalCards, trickWinnerIndex, cardValue, keyOf, rankOf, isTrump } from '../shared/cards.js';

function rngFrom(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }

function analyse(which, seeds) {
  const bot = which === 'neu' ? newBot : oldBot;
  const m = { games: 0, partnerSafe: 0, overtrumped: 0, schmierChance: 0, schmiert: 0, fuchsLost: 0, fuchsGames: 0,
    aceLeadChance: 0, aceLead: 0, annTotal: 0, annWon: 0, pos2Queen: 0, pos2Chance: 0 };
  for (const seed of seeds) {
    const r = new Round({ id: seed, rules: defaultRules(), dealer: seed % 4, names: ['Heinz', 'Gisela', 'Kalle', 'Uschi'], rng: rngFrom(seed) });
    while (r.phase !== 'done' && r.phase !== 'redeal') {
      if (r.trickComplete()) { r.collectTrick(); continue; }
      const s = r.turn;
      if (r.phase !== 'playing') { bot(r, s); continue; }
      const ctx = r.ctx, plays = r.trick.plays.slice(), hand = r.hands[s].slice();
      const legal = legalCards(ctx, hand, plays.map((p) => p.card));
      const known = r.knownParties(s);
      const isLast = r.tricks.length === r.handSize - 1;
      let situation = null;
      if (plays.length) {
        const led = followSuit(ctx, plays[0].card);
        const best = plays[trickWinnerIndex(ctx, plays, isLast)];
        const after = []; for (let i = 1; i <= 3 - plays.length; i++) after.push((s + i) % 4);
        const partnerKnown = known[s] && known[best.seat] === known[s] && best.seat !== s;
        // „sicher“ mit voller Kartenkenntnis: kein Gegner dahinter kann überstechen
        const safe = partnerKnown && !after.some((o) => r.parties[o] !== r.parties[s] && legalCards(ctx, r.hands[o], plays.map((p) => p.card)).some((c) => beats(ctx, c, best.card, led, isLast)));
        const nonBeating = legal.filter((c) => !beats(ctx, c, best.card, led, isLast));
        const highValue = legal.filter((c) => cardValue(c) >= 10 && !(isTrump(ctx, c) && keyOf(c) !== 'D10' && keyOf(c) !== 'DA'));
        situation = { led, best, safe, nonBeating, highValue, partnerKnown, pos: plays.length + 1 };
        // Faustregel 5 nur zählen, wenn ein kleinerer Trumpf (keine Dame/Dulle) zur Wahl stand
        situation.pos2 = plays.length === 1 && led === 'T' && !known[plays[0].seat] && r.gameType !== 'solo' && legal.some((c) => isTrump(ctx, c) && !keyOf(c).endsWith('Q') && keyOf(c) !== ctx.dulle);
        if (situation.pos2) m.pos2Chance++;
      } else if (r.tricks.length < 3) {
        const ledBefore = new Set(r.tricks.map((t) => followSuit(ctx, t.plays[0].card)));
        const aces = hand.filter((c) => !isTrump(ctx, c) && rankOf(c) === 'A' && !ledBefore.has(followSuit(ctx, c)) && followSuit(ctx, c) !== 'H');
        if (aces.length) situation = { aceLead: true };
      }
      bot(r, s);
      const card = r.trick.plays.find((p) => p.seat === s).card;
      if (situation?.aceLead) { m.aceLeadChance++; if (!isTrump(ctx, card) && rankOf(card) === 'A') m.aceLead++; }
      if (situation?.safe) {
        m.partnerSafe++;
        if (beats(ctx, card, situation.best.card, situation.led, isLast) && situation.nonBeating.length && isTrump(ctx, card)) m.overtrumped++;
        if (situation.highValue.length && situation.nonBeating.some((c) => situation.highValue.includes(c))) { m.schmierChance++; if (cardValue(card) >= 10) m.schmiert++; }
      }
      if (situation?.pos2 && (keyOf(card).endsWith('Q') || keyOf(card) === ctx.dulle)) m.pos2Queen++;
    }
    if (r.phase === 'redeal') continue;
    m.games++;
    const P = r.result.parties;
    if (r.ctx.mode === 'D' && !r.ctx.schweine && !r.result.soloScoring) {
      m.fuchsGames++;
      for (const t of r.tricks) for (const p of t.plays) if (keyOf(p.card) === 'DA' && P[p.seat] !== P[t.winner]) m.fuchsLost++;
    }
    for (let s = 0; s < 4; s++) if (r.seatAnn[s] >= 0) { m.annTotal++; if (r.result.perSeat[s] > 0) m.annWon++; }
  }
  return m;
}

if (isMainThread) {
  const games = Number(process.argv[2] || 60);
  const workers = Number(process.argv[3] || Math.max(1, os.cpus().length - 2));
  const seeds = Array.from({ length: games }, (_, i) => 5000 + i);
  const run = (which) => Promise.all(Array.from({ length: workers }, (_, w) => new Promise((res, rej) => {
    const wk = new Worker(fileURLToPath(import.meta.url), { workerData: { which, seeds: seeds.filter((_, i) => i % workers === w) } });
    wk.on('message', res); wk.on('error', rej);
  }))).then((parts) => parts.reduce((a, b) => { for (const k in b) a[k] = (a[k] || 0) + b[k]; return a; }, {}));
  const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(0)} %` : '–') + ` (${a}/${b})`;
  for (const which of ['alt', 'neu']) {
    const m = await run(which);
    console.log(`\n== ${which === 'neu' ? 'Neue' : 'Alte'} Bots (${m.games} Spiele) ==`);
    console.log('Sicheren Stich des bekannten Partners mit Trumpf überstochen:', pct(m.overtrumped, m.partnerSafe));
    console.log('Auf sicheren Partner-Stich geschmiert (10/Ass), wenn möglich:', pct(m.schmiert, m.schmierChance));
    console.log('Laufendes schwarzes Ass in den ersten 3 Stichen angespielt:', pct(m.aceLead, m.aceLeadChance));
    console.log('Dame/Dulle an Position 2 bei ungeklärter Partnerschaft (kleiner Trumpf vorhanden):', pct(m.pos2Queen, m.pos2Chance));
    console.log('Füchse an die Gegenpartei verloren pro Spiel:', (m.fuchsLost / Math.max(1, m.fuchsGames)).toFixed(2));
    console.log('Eigene Ansagen gewonnen:', pct(m.annWon, m.annTotal));
  }
} else {
  parentPort.postMessage(analyse(workerData.which, workerData.seeds));
}
