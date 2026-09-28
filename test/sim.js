// Simuliert viele Spiele mit 4 Bots und prüft Invarianten der Spiellogik.
import assert from 'node:assert/strict';
import { Round } from '../server/round.js';
import { botAct } from '../server/bot.js';
import { RULE_DEFS, sanitizeRules, defaultRules } from '../shared/rules.js';
import { buildDeck, makeTrumpContext, trickWinnerIndex, legalCards } from '../shared/cards.js';

// --- gezielte Regeltests ---
{
  const r = defaultRules();
  const ctx = makeTrumpContext('D', r);
  // zweite Dulle sticht die erste
  assert.equal(trickWinnerIndex(ctx, [{ seat: 0, card: 'H10a' }, { seat: 1, card: 'H10b' }, { seat: 2, card: 'CQa' }, { seat: 3, card: 'D9a' }], false), 1);
  const ctx2 = makeTrumpContext('D', { ...r, dullen: 'zweite_ausser_letzter' });
  assert.equal(trickWinnerIndex(ctx2, [{ seat: 0, card: 'H10a' }, { seat: 1, card: 'H10b' }], true), 0);
  // Fehl: Herz-Ass vs. Herz-König; Abstechen mit Karo-9
  assert.equal(trickWinnerIndex(ctx, [{ seat: 0, card: 'HKa' }, { seat: 1, card: 'HAa' }, { seat: 2, card: 'D9a' }, { seat: 3, card: 'HAb' }], false), 2);
  // gleiche Karten: erste gewinnt
  assert.equal(trickWinnerIndex(ctx, [{ seat: 0, card: 'CAa' }, { seat: 1, card: 'CAb' }], false), 0);
  // Bedienpflicht: Herz-10 ist Trumpf, kein Herz
  assert.deepEqual(legalCards(ctx, ['H10a', 'HKa', 'CAa'], ['HAa']), ['HKa']);
  // Schweinchen über Dulle
  const sctx = makeTrumpContext('D', r, { schweine: true });
  assert.equal(trickWinnerIndex(sctx, [{ seat: 0, card: 'H10a' }, { seat: 1, card: 'DAa' }], false), 1);
  // Damensolo: Buben sind Fehl
  const dctx = makeTrumpContext('damen', r);
  assert.equal(trickWinnerIndex(dctx, [{ seat: 0, card: 'CJa' }, { seat: 1, card: 'CAa' }, { seat: 2, card: 'DQa' }], false), 2);
  // Herzsolo mit Dullen: Herz-10 bleibt oberster Trumpf
  const hctx = makeTrumpContext('H', r);
  assert.equal(trickWinnerIndex(hctx, [{ seat: 0, card: 'HAa' }, { seat: 1, card: 'H10a' }, { seat: 2, card: 'CQa' }], false), 1);
  console.log('Regeltests OK');
}

function rngFrom(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

const stats = { games: 0, redeal: 0, types: {}, winners: { re: 0, kontra: 0, none: 0 }, ann: 0 };
const N = Number(process.argv[2] || 3000);
for (let i = 0; i < N; i++) {
  const rng = rngFrom(i + 1);
  const rules = { ...defaultRules() };
  for (const d of RULE_DEFS) {
    if (d.key === 'botTempo' || d.key === 'spiele') continue;
    if (d.type === 'bool') rules[d.key] = rng() < 0.6 ? d.def : !d.def;
    else rules[d.key] = d.options[Math.floor(rng() * d.options.length)][0];
  }
  const sr = sanitizeRules(rules);
  const round = new Round({ id: i, rules: sr, dealer: i % 4, names: ['A', 'B', 'C', 'D'], rng });
  const deck = buildDeck(sr.mitNeunen);
  assert.equal(round.hands.flat().length, deck.length);
  let guard = 0;
  while (round.phase !== 'done' && round.phase !== 'redeal') {
    if (++guard > 500) throw new Error('Endlosschleife in Runde ' + i);
    if (round.trickComplete()) { round.collectTrick(); continue; }
    botAct(round, round.turn);
  }
  if (round.phase === 'redeal') { stats.redeal++; continue; }
  const res = round.result;
  stats.games++;
  stats.types[res.gameLabel] = (stats.types[res.gameLabel] || 0) + 1;
  stats.winners[res.winner || 'none']++;
  if (res.soloScoring) { const k = res.gameLabel; stats.bySolo = stats.bySolo || {}; stats.bySolo[k] = stats.bySolo[k] || [0, 0]; stats.bySolo[k][1]++; if (res.winner === 're') stats.bySolo[k][0]++; }
  if (res.soloScoring) { stats.solo = (stats.solo || 0) + 1; if (res.winner === 're') stats.soloWon = (stats.soloWon || 0) + 1; }
  if (res.ann.re >= 0 || res.ann.kontra >= 0) stats.ann++;
  assert.equal(res.pts.re + res.pts.kontra, 240, 'Augensumme muss 240 sein');
  assert.equal(res.tricks.re + res.tricks.kontra, round.handSize);
  assert.equal(res.perSeat.reduce((a, b) => a + b, 0), 0, 'Punktesumme muss 0 sein');
  assert.ok(round.hands.every((h) => h.length === 0));
  const all = round.tricks.flatMap((t) => t.plays.map((p) => p.card)).sort();
  assert.deepEqual(all, deck.slice().sort());
  const reCount = res.parties.filter((p) => p === 're').length;
  assert.ok(reCount === 1 || reCount === 2, 'Re hat 1 oder 2 Spieler');
  for (let s = 0; s < 4; s++) round.view(s);
}
console.log(`${stats.games} Spiele, ${stats.redeal} Neugaben, ${stats.ann} mit Ansagen`);
console.log('Spielarten:', stats.types);
console.log('Gewinner:', stats.winners, 'Soli gewonnen:', stats.soloWon, '/', stats.solo);
console.log('Soli (gewonnen/gesamt):', stats.bySolo);
console.log('Alle Invarianten OK');
