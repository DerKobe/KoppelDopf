// Leistungsvergleich neue vs. alte Bots im Duplikat-Verfahren:
// Jede Kartenverteilung wird zweimal gespielt – einmal sitzen die neuen Bots auf 0+2, einmal auf 1+3.
// So gleicht sich Kartenglück aus. Aufruf: node test/bench.js [Verteilungen] [Worker]
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Round } from '../server/round.js';
import { botAct as newBot } from '../server/bot.js';
import { botAct as legacyBot } from './legacy-bot.js';

// Varianten per Umgebung: A_SCALE = Rechenzeit-Faktor der Testbots, OPP=new|legacy, OPP_SCALE = Faktor der Gegner
const A_SCALE = Number(process.env.A_SCALE || 1);
const OPP = process.env.OPP || 'legacy';
const OPP_SCALE = Number(process.env.OPP_SCALE || 1);
const testBot = (r, s) => newBot(r, s, { timeScale: A_SCALE });
const oppBot = OPP === 'new' ? (r, s) => newBot(r, s, { timeScale: OPP_SCALE }) : legacyBot;
import { defaultRules } from '../shared/rules.js';

function rngFrom(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

function playDeal(seed, newSeats) {
  const round = new Round({ id: seed, rules: defaultRules(), dealer: seed % 4, names: ['Heinz', 'Gisela', 'Kalle', 'Uschi'], rng: rngFrom(seed) });
  let guard = 0;
  while (round.phase !== 'done' && round.phase !== 'redeal') {
    if (++guard > 400) throw new Error('Endlosschleife');
    if (round.trickComplete()) { round.collectTrick(); continue; }
    const s = round.turn;
    (newSeats.includes(s) ? testBot : oppBot)(round, s);
  }
  if (round.phase === 'redeal') return null;
  const r = round.result;
  const newPts = newSeats.reduce((a, s) => a + r.perSeat[s], 0);
  const newParty = newSeats.map((s) => r.parties[s]);
  return {
    newPts,
    label: r.gameLabel,
    samePartyNew: newParty[0] === newParty[1], // neue Bots zusammen in einer Partei?
    newWonSeats: newSeats.filter((s) => r.perSeat[s] > 0).length,
    ann: r.ann.re >= 0 || r.ann.kontra >= 0,
    newAnnounced: newSeats.some((s) => round.seatAnn[s] >= 0),
    newAnnWon: newSeats.filter((s) => round.seatAnn[s] >= 0 && r.perSeat[s] > 0).length,
    newAnnTotal: newSeats.filter((s) => round.seatAnn[s] >= 0).length,
    oldAnnWon: [0, 1, 2, 3].filter((s) => !newSeats.includes(s) && round.seatAnn[s] >= 0 && r.perSeat[s] > 0).length,
    oldAnnTotal: [0, 1, 2, 3].filter((s) => !newSeats.includes(s) && round.seatAnn[s] >= 0).length,
  };
}

if (isMainThread) {
  const deals = Number(process.argv[2] || 120);
  const workers = Number(process.argv[3] || Math.max(1, os.cpus().length - 2));
  const seeds = Array.from({ length: deals }, (_, i) => 1000 + i);
  const chunks = Array.from({ length: workers }, (_, w) => seeds.filter((_, i) => i % workers === w));
  const t0 = Date.now();
  const results = (await Promise.all(chunks.map((chunk) => new Promise((res, rej) => {
    const wk = new Worker(fileURLToPath(import.meta.url), { workerData: chunk });
    wk.on('message', res); wk.on('error', rej);
  })))).flat();
  const pairs = results.filter((p) => p.a && p.b);
  const games = pairs.flatMap((p) => [p.a, p.b]);
  const perGame = games.reduce((a, g) => a + g.newPts, 0) / games.length;
  const perDeal = pairs.map((p) => p.a.newPts + p.b.newPts);
  const mean = perDeal.reduce((a, b) => a + b, 0) / perDeal.length;
  const sd = Math.sqrt(perDeal.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, perDeal.length - 1));
  const se = sd / Math.sqrt(perDeal.length);
  const sum = (f) => games.reduce((a, g) => a + f(g), 0);
  console.log(`Test: neue Bots ×${A_SCALE} Rechenzeit gegen ${OPP === 'new' ? `neue Bots ×${OPP_SCALE}` : 'alte Bots'}`);
  console.log(`${pairs.length} Verteilungen × 2 = ${games.length} Spiele in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  console.log(`Neue Bots: ${perGame >= 0 ? '+' : ''}${(perGame / 2).toFixed(2)} Punkte pro Spiel und Platz (Summe beider neuen Plätze: ${perGame.toFixed(2)})`);
  console.log(`Duplikat-Differenz je Verteilung: ${mean.toFixed(2)} ± ${(1.96 * se).toFixed(2)} (95%)`);
  console.log(`Gewonnene Plätze: neu ${sum((g) => g.newWonSeats)} / alt ${sum((g) => 2 - g.newWonSeats)} von je ${games.length * 2}`);
  console.log(`Ansagen gewonnen: neu ${sum((g) => g.newAnnWon)}/${sum((g) => g.newAnnTotal)}, alt ${sum((g) => g.oldAnnWon)}/${sum((g) => g.oldAnnTotal)}`);
  const types = {};
  for (const g of games) types[g.label] = (types[g.label] || 0) + 1;
  console.log('Spielarten:', types);
} else {
  const out = [];
  for (const seed of workerData) {
    out.push({ seed, a: playDeal(seed, [0, 2]), b: playDeal(seed, [1, 3]) });
  }
  parentPort.postMessage(out);
}
