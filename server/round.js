// Ein einzelnes Doppelkopf-Spiel (Geben -> Vorbehalte -> ggf. Armut -> Stiche -> Abrechnung).
import {
  buildDeck, shuffle, makeTrumpContext, isTrump, legalCards, trickWinnerIndex, trickPoints,
  keyOf, rankOf, sortHand, SOLO_TYPES, announceLabel, LEVEL_LABELS, trumpModeLabel,
} from '../shared/cards.js';

const other = (p) => (p === 're' ? 'kontra' : 're');
// Kennungen der Sprachdateien (public/audio/voice/<stimme>/<id>.mp3) für die Absage-Stufen
const LEVEL_VOICE = ['', 'k90', 'k60', 'k30', 'schwarz'];

export class Round {
  constructor({ id, rules, dealer, names, bock = 1, rng = Math.random }) {
    this.id = id;
    this.rules = rules;
    this.dealer = dealer;
    this.names = names;
    this.bock = bock;
    this.handSize = rules.mitNeunen ? 12 : 10;
    this.normalCtx = makeTrumpContext('D', rules);
    this.ctx = this.normalCtx;

    const deck = shuffle(buildDeck(rules.mitNeunen), rng);
    this.hands = [0, 1, 2, 3].map((i) => sortHand(this.ctx, deck.slice(i * this.handSize, (i + 1) * this.handSize)));

    this.phase = 'reservation';
    this.turn = (dealer + 1) % 4;
    this.reservations = [null, null, null, null];

    this.gameType = 'normal'; // normal | stille | hochzeit | armut | solo
    this.soloType = null;
    this.soloist = null;
    this.hochzeiter = null;
    this.partner = null;
    this.hochzeitFailed = false;
    this.armut = null;

    this.parties = [null, null, null, null];
    this.revealed = [false, false, false, false];
    this.cqPlayed = [];
    this.schweineShown = false;

    this.tricks = [];
    this.trick = null;
    this.ann = { re: -1, kontra: -1 };
    this.seatAnn = [-1, -1, -1, -1];
    this.annLog = [];
    this.base = 0;
    this.result = null;
    this.redeal = null;
    this.events = [];
    this.eventSeq = 0;
  }

  name(s) { return this.names[s]; }
  // voice: { seat, line } – der Client spielt dazu die passende Sprachansage in der Stimme dieses Spielers
  event(text, kind = 'info', voice = null) {
    if (this.sim) return; // Simulationen der Bots erzeugen keine Ereignisse
    this.events.push({ id: ++this.eventSeq, text, kind, voice });
    if (this.events.length > 30) this.events.shift();
  }

  // Schnelle Kopie für Bot-Simulationen: eigene Hände/Stichliste, alles Übrige wird geteilt bzw. flach kopiert.
  cloneForSim(hands = this.hands) {
    const c = Object.create(Round.prototype);
    Object.assign(c, this);
    c.sim = true;
    c.hands = hands.map((h) => h.slice());
    c.parties = this.parties.slice();
    c.revealed = this.revealed.slice();
    c.cqPlayed = this.cqPlayed.slice();
    c.reservations = this.reservations.slice();
    c.tricks = this.tricks.slice();
    c.trick = this.trick ? { ...this.trick, plays: this.trick.plays.slice() } : null;
    c.ann = { ...this.ann };
    c.seatAnn = this.seatAnn.slice();
    c.annLog = [];
    c.events = [];
    c.result = null;
    return c;
  }
  countKey(seat, key) { return this.hands[seat].filter((c) => keyOf(c) === key).length; }

  // ---------- Vorbehalte ----------
  reservationOptions(seat) {
    const r = this.rules, h = this.hands[seat];
    const opts = ['gesund'];
    if (r.hochzeit && this.countKey(seat, 'CQ') === 2) opts.push('hochzeit');
    if (r.armut && h.filter((c) => isTrump(this.normalCtx, c)).length <= 3) opts.push('armut');
    if (r.schmeissen) {
      const nines = h.filter((c) => rankOf(c) === '9').length;
      const kings = h.filter((c) => rankOf(c) === 'K').length;
      if (nines >= 5 || kings >= 5) opts.push('schmeissen');
    }
    if (r.soloDamen) opts.push('solo_damen');
    if (r.soloBuben) opts.push('solo_buben');
    if (r.soloFarben) opts.push('solo_C', 'solo_S', 'solo_H', 'solo_D');
    if (r.soloFleischlos) opts.push('solo_fleischlos');
    return opts;
  }

  reserve(seat, choice) {
    if (this.phase !== 'reservation' || this.turn !== seat) throw new Error('Du bist nicht dran.');
    if (!this.reservationOptions(seat).includes(choice)) throw new Error('Dieser Vorbehalt ist nicht möglich.');
    this.reservations[seat] = choice;
    if (choice === 'schmeissen') {
      this.phase = 'redeal';
      this.redeal = { reason: `${this.name(seat)} schmeißt die Karten – es wird neu gegeben.` };
      this.event(this.redeal.reason, 'big', { seat, line: 'schmeissen' });
      return;
    }
    if (choice !== 'gesund') this.event('', 'voice', { seat, line: 'vorbehalt' }); // nur hörbar, Anzeige über die Plakette
    this.turn = (seat + 1) % 4;
    if (this.reservations.every((x) => x !== null)) this.resolveReservations();
  }

  resolveReservations() {
    const order = [1, 2, 3, 4].map((i) => (this.dealer + i) % 4);
    const soloSeat = order.find((s) => this.reservations[s].startsWith('solo_'));
    if (soloSeat !== undefined) {
      this.setupSolo(soloSeat, this.reservations[soloSeat].slice(5));
      return this.startPlay();
    }
    const armutSeat = order.find((s) => this.reservations[s] === 'armut');
    if (armutSeat !== undefined) {
      this.gameType = 'armut';
      this.armut = { poor: armutSeat, rich: null, cards: null, declined: [], returnedTrumps: null, gaveTrumps: null };
      this.phase = 'armutGive';
      this.turn = armutSeat;
      this.event(`${this.name(armutSeat)} hat eine Armut.`, 'big', { seat: armutSeat, line: 'armut' });
      return;
    }
    const hz = order.find((s) => this.reservations[s] === 'hochzeit');
    if (hz !== undefined) {
      this.gameType = 'hochzeit';
      this.hochzeiter = hz;
      this.parties[hz] = 're';
      this.revealed[hz] = true;
      const kl = { erster: 'ersten Fremdstich', fehl: 'ersten Fehl-Fremdstich', trumpf: 'ersten Trumpf-Fremdstich' }[this.rules.hochzeitKlaerung];
      this.event(`${this.name(hz)} hat eine Hochzeit! Partner wird, wer den ${kl} macht.`, 'big', { seat: hz, line: 'hochzeit' });
    } else {
      for (let s = 0; s < 4; s++) this.parties[s] = this.countKey(s, 'CQ') > 0 ? 're' : 'kontra';
      const stille = [0, 1, 2, 3].find((s) => this.countKey(s, 'CQ') === 2);
      if (stille !== undefined) { this.gameType = 'stille'; this.soloist = stille; }
    }
    this.startPlay();
  }

  setupSolo(seat, type) {
    this.gameType = 'solo';
    this.soloType = type;
    this.soloist = seat;
    for (let s = 0; s < 4; s++) { this.parties[s] = s === seat ? 're' : 'kontra'; this.revealed[s] = true; }
    this.event(`${this.name(seat)} spielt ein ${SOLO_TYPES[type].label}!`, 'big', { seat, line: `solo_${type}` });
  }

  // ---------- Armut ----------
  armutGive(seat, cards) {
    const a = this.armut;
    if (this.phase !== 'armutGive' || seat !== a.poor) throw new Error('Nicht erlaubt.');
    const hand = this.hands[seat];
    if (!Array.isArray(cards) || cards.length !== 3 || new Set(cards).size !== 3 || !cards.every((c) => hand.includes(c)))
      throw new Error('Wähle genau 3 Karten.');
    const trumps = hand.filter((c) => isTrump(this.normalCtx, c));
    if (!trumps.every((t) => cards.includes(t))) throw new Error('Alle Trümpfe müssen abgegeben werden.');
    a.cards = cards.slice();
    a.gaveTrumps = trumps.length;
    this.hands[seat] = hand.filter((c) => !cards.includes(c));
    this.phase = 'armutOffer';
    this.turn = (seat + 1) % 4;
    this.event(`${this.name(seat)} gibt ${trumps.length} Trumpf${trumps.length === 1 ? '' : 'e'} ab. Wer nimmt die Armut?`);
  }

  armutAnswer(seat, accept) {
    const a = this.armut;
    if (this.phase !== 'armutOffer' || this.turn !== seat) throw new Error('Du bist nicht dran.');
    if (accept) {
      a.rich = seat;
      this.hands[seat] = sortHand(this.normalCtx, [...this.hands[seat], ...a.cards]);
      this.phase = 'armutReturn';
      this.turn = seat;
      this.event(`${this.name(seat)} nimmt die Armut mit.`, 'big');
      return;
    }
    a.declined.push(seat);
    this.event(`${this.name(seat)} nimmt die Armut nicht.`);
    const next = (seat + 1) % 4;
    if (next === a.poor) {
      this.phase = 'redeal';
      this.redeal = { reason: 'Niemand nimmt die Armut – es wird neu gegeben.' };
      this.event(this.redeal.reason, 'big');
      return;
    }
    this.turn = next;
  }

  armutReturn(seat, cards) {
    const a = this.armut;
    if (this.phase !== 'armutReturn' || seat !== a.rich) throw new Error('Nicht erlaubt.');
    const hand = this.hands[seat];
    if (!Array.isArray(cards) || cards.length !== 3 || new Set(cards).size !== 3 || !cards.every((c) => hand.includes(c)))
      throw new Error('Wähle genau 3 Karten zum Zurückgeben.');
    this.hands[seat] = hand.filter((c) => !cards.includes(c));
    this.hands[a.poor] = sortHand(this.normalCtx, [...this.hands[a.poor], ...cards]);
    a.returnedTrumps = cards.filter((c) => isTrump(this.normalCtx, c)).length;
    a.returned = cards.slice();
    for (let s = 0; s < 4; s++) {
      this.parties[s] = s === a.poor || s === a.rich ? 're' : 'kontra';
      this.revealed[s] = true;
    }
    this.event(`${this.name(seat)} gibt ${a.returnedTrumps} Trumpf${a.returnedTrumps === 1 ? '' : 'e'} zurück.`, 'big');
    this.startPlay();
  }

  // ---------- Spiel ----------
  startPlay() {
    const mode = this.gameType === 'solo' ? SOLO_TYPES[this.soloType].mode : 'D';
    let schweine = false, superschweine = false;
    if (mode === 'D' && this.rules.schweinchen) {
      const holder = [0, 1, 2, 3].find((s) => this.countKey(s, 'DA') === 2);
      if (holder !== undefined) {
        schweine = true;
        this.schweineHolder = holder;
        if (this.rules.superschweinchen) {
          const sk = this.rules.mitNeunen ? 'D9' : 'DK';
          const h2 = [0, 1, 2, 3].find((s) => this.countKey(s, sk) === 2);
          if (h2 !== undefined) { superschweine = true; this.superHolder = h2; }
        }
      }
    }
    this.ctx = makeTrumpContext(mode, this.rules, { schweine, superschweine });
    this.hands = this.hands.map((h) => sortHand(this.ctx, h));
    this.phase = 'playing';
    const leader = this.gameType === 'solo' && this.rules.solistKommtRaus ? this.soloist : (this.dealer + 1) % 4;
    this.trick = { leader, plays: [] };
    this.turn = leader;
  }

  legalFor(seat) {
    if (this.phase !== 'playing' || this.turn !== seat || this.trick.plays.length >= 4) return [];
    return legalCards(this.ctx, this.hands[seat], this.trick.plays.map((p) => p.card));
  }

  isLastTrick() { return this.tricks.length === this.handSize - 1; }

  play(seat, card) {
    if (this.phase !== 'playing' || this.turn !== seat || this.trick.plays.length >= 4) throw new Error('Du bist nicht dran.');
    if (!this.legalFor(seat).includes(card)) throw new Error('Diese Karte darfst du nicht spielen (Farbe bedienen!).');
    this.hands[seat] = this.hands[seat].filter((c) => c !== card);
    this.trick.plays.push({ seat, card });
    const k = keyOf(card);
    if (k === 'CQ' && (this.gameType === 'normal' || this.gameType === 'stille')) {
      this.revealed[seat] = true;
      this.cqPlayed.push(seat);
    }
    if (this.ctx.schweine && k === 'DA' && !this.schweineShown) {
      this.schweineShown = true;
      this.event(`${this.name(seat)}: „Schweinchen!“ 🐷`, 'big', { seat, line: 'schweinchen' });
    }
    if (this.ctx.superschweine && k === this.ctx.superKey && !this.superShown) {
      this.superShown = true;
      this.event(`${this.name(seat)}: „Superschweinchen!“ 🐷🐷`, 'big', { seat, line: 'superschweinchen' });
    }
    if (this.trick.plays.length === 4) {
      const idx = trickWinnerIndex(this.ctx, this.trick.plays, this.isLastTrick());
      this.trick.winner = this.trick.plays[idx].seat;
      this.trick.points = trickPoints(this.trick.plays);
      this.turn = null;
    } else {
      this.turn = (seat + 1) % 4;
    }
  }

  trickComplete() { return this.phase === 'playing' && this.trick && this.trick.plays.length === 4; }

  collectTrick() {
    if (!this.trickComplete()) return;
    const t = this.trick;
    this.tricks.push(t);
    if (this.gameType === 'hochzeit' && this.partner === null && !this.hochzeitFailed) {
      const n = this.tricks.length;
      const ledTrump = isTrump(this.ctx, t.plays[0].card);
      const kl = this.rules.hochzeitKlaerung;
      const cond = kl === 'erster' || (kl === 'fehl' && !ledTrump) || (kl === 'trumpf' && ledTrump);
      if (cond && t.winner !== this.hochzeiter) {
        this.partner = t.winner;
        for (let s = 0; s < 4; s++) {
          this.parties[s] = s === this.hochzeiter || s === this.partner ? 're' : 'kontra';
          this.revealed[s] = true;
        }
        this.base = n;
        this.event(`${this.name(t.winner)} heiratet ${this.name(this.hochzeiter)}! 💍`, 'big');
      } else if (n >= 3) {
        this.hochzeitFailed = true;
        this.soloist = this.hochzeiter;
        for (let s = 0; s < 4; s++) {
          this.parties[s] = s === this.hochzeiter ? 're' : 'kontra';
          this.revealed[s] = true;
        }
        this.base = n;
        this.event(`Kein Partner gefunden – ${this.name(this.hochzeiter)} spielt allein (Solo).`, 'big');
      }
    }
    if (this.tricks.length === this.handSize) { this.finish(); return; }
    this.trick = { leader: t.winner, plays: [] };
    this.turn = t.winner;
  }

  // ---------- Ansagen ----------
  announceOptions(seat) {
    if (!this.rules.ansagen || this.phase !== 'playing' || seat == null) return [];
    const party = this.parties[seat];
    if (!party) return [];
    if (this.gameType === 'hochzeit' && this.partner === null && !this.hochzeitFailed) return [];
    const handLen = this.hands[seat].length;
    const n = this.handSize - this.base;
    const res = [];
    for (let level = this.ann[party] + 1; level <= 4; level++) {
      let ok = handLen >= n - 1 - level;
      if (level === 0 && this.ann[other(party)] >= 0 && handLen >= n - 2) ok = true; // Erwiderung
      if (ok) res.push(level);
    }
    return res;
  }

  announce(seat, level) {
    if (!this.announceOptions(seat).includes(level)) throw new Error('Diese Ansage ist nicht (mehr) möglich.');
    const party = this.parties[seat];
    const alreadyAnnounced = this.ann[party] >= 0; // dann reicht „Keine Neunzig!“ statt „Re, keine Neunzig!“
    this.ann[party] = level;
    this.seatAnn[seat] = Math.max(this.seatAnn[seat], level);
    this.revealed[seat] = true;
    this.annLog.push({ seat, party, level });
    const label = level === 0 ? announceLabel(party, 0) : `${announceLabel(party, 0)}, ${LEVEL_LABELS[level]}`;
    const line = level === 0 ? party : alreadyAnnounced ? LEVEL_VOICE[level] : `${party}_${LEVEL_VOICE[level]}`;
    this.event(`${this.name(seat)} sagt: „${label}“`, 'announce', { seat, line });
  }

  // ---------- Wissen eines Spielers über die Parteien ----------
  knownParties(viewer) {
    if (this.phase === 'done') return this.parties.slice();
    const out = [0, 1, 2, 3].map((s) => (this.revealed[s] ? this.parties[s] : null));
    if (viewer != null && this.parties[viewer]) out[viewer] = this.parties[viewer];
    if (this.gameType === 'normal' || this.gameType === 'stille') {
      const fill = (p) => { for (let s = 0; s < 4; s++) if (!out[s]) out[s] = p; };
      if (this.cqPlayed.length === 2 && this.cqPlayed[0] === this.cqPlayed[1]) fill('kontra');
      if (viewer != null && this.gameType === 'stille' && viewer === this.soloist) fill('kontra');
      if (out.filter((p) => p === 're').length >= 2) fill('kontra');
      if (out.filter((p) => p === 'kontra').length === 3) fill('re');
    }
    return out;
  }

  // ---------- Abrechnung ----------
  finish() {
    this.result = this.computeResult();
    this.phase = 'done';
    this.turn = null;
    const { winner, pts } = this.result;
    this.event(winner ? `${winner === 're' ? 'Re' : 'Kontra'} gewinnt mit ${pts[winner]} Augen.` : 'Keine Partei hat gewonnen.', 'big');
  }

  // Abrechnung aus Stichen und Parteien; ann lässt sich überschreiben (Bots bewerten damit hypothetische Ansagen).
  computeResult(ann = this.ann) {
    const P = this.parties;
    const pts = { re: 0, kontra: 0 }, tr = { re: 0, kontra: 0 };
    for (const t of this.tricks) { pts[P[t.winner]] += t.points; tr[P[t.winner]]++; }
    const aR = ann.re, aK = ann.kontra;
    const meets = (p, L) => (L === 4 ? tr[other(p)] === 0 : pts[other(p)] < [0, 90, 60, 30][L]);

    let reWins, koWins;
    if (aR >= 1) reWins = meets('re', aR);
    else if (aK >= 1) reWins = !meets('kontra', aK);
    else if (aK === 0 && aR === -1) reWins = pts.re >= 120;
    else reWins = pts.re >= 121;

    if (aK >= 1) koWins = meets('kontra', aK);
    else if (aR >= 1) koWins = !meets('re', aR);
    else if (aK === 0 && aR === -1) koWins = pts.kontra >= 121;
    else koWins = pts.kontra >= 120;

    const reSeats = [0, 1, 2, 3].filter((s) => P[s] === 're');
    const soloScoring = reSeats.length === 1;
    const winner = reWins ? 're' : koWins ? 'kontra' : null;
    const lines = [];
    if (winner) {
      const L = other(winner);
      lines.push({ label: `${winner === 're' ? 'Re' : 'Kontra'} gewinnt`, value: 1 });
      if (pts[L] < 90) lines.push({ label: 'Gegner unter 90', value: 1 });
      if (pts[L] < 60) lines.push({ label: 'Gegner unter 60', value: 1 });
      if (pts[L] < 30) lines.push({ label: 'Gegner unter 30', value: 1 });
      if (tr[L] === 0) lines.push({ label: 'Gegner schwarz', value: 1 });
      if (aR >= 0) lines.push({ label: 'Re angesagt', value: 2 });
      if (aK >= 0) lines.push({ label: 'Kontra angesagt', value: 2 });
      for (const p of ['re', 'kontra']) for (let l = 1; l <= ann[p]; l++)
        lines.push({ label: `${LEVEL_LABELS[l]} abgesagt (${p === 're' ? 'Re' : 'Kontra'})`, value: 1 });
      const aL = ann[L];
      if (aL >= 1 && pts[winner] >= 120) lines.push({ label: '120 gegen keine 90', value: 1 });
      if (aL >= 2 && pts[winner] >= 90) lines.push({ label: '90 gegen keine 60', value: 1 });
      if (aL >= 3 && pts[winner] >= 60) lines.push({ label: '60 gegen keine 30', value: 1 });
      if (aL >= 4 && pts[winner] >= 30) lines.push({ label: '30 gegen schwarz', value: 1 });
      if (!soloScoring && winner === 'kontra' && this.rules.gegenDieAlten) lines.push({ label: 'Gegen die Alten', value: 1 });
    }
    const gameValue = winner ? lines.reduce((s, l) => s + l.value, 0) * (winner === 're' ? 1 : -1) : 0;

    const specials = [];
    if (!soloScoring) {
      this.tricks.forEach((t, i) => {
        const wp = P[t.winner];
        if (this.rules.doppelkopf && t.points >= 40) specials.push({ label: `Doppelkopf (${t.points} Augen)`, party: wp, seat: t.winner });
        if (this.rules.fuchs && !this.ctx.schweine) {
          for (const pl of t.plays) if (keyOf(pl.card) === 'DA' && P[pl.seat] !== wp)
            specials.push({ label: `Fuchs von ${this.name(pl.seat)} gefangen`, party: wp, seat: t.winner });
        }
        if (this.rules.karlchen && i === this.tricks.length - 1) {
          const wc = t.plays.find((p) => p.seat === t.winner).card;
          if (keyOf(wc) === 'CJ') specials.push({ label: 'Karlchen macht den letzten Stich', party: wp, seat: t.winner });
        }
      });
    }
    const specialNet = specials.reduce((s, x) => s + (x.party === 're' ? 1 : -1), 0);
    const total = (gameValue + specialNet) * this.bock;
    const perSeat = [0, 1, 2, 3].map((s) => (P[s] === 're' ? (soloScoring ? 3 * total : total) : -total));

    let bockTrigger = null;
    if (this.rules.bockrunden) {
      if (pts.re === 120) bockTrigger = '120 : 120';
      else if (soloScoring && winner !== 're') bockTrigger = 'Solo verloren';
    }

    return {
      gameLabel: this.gameLabel(null, true),
      parties: P.slice(),
      pts, tricks: tr, winner, lines, specials, gameValue, specialNet, total, perSeat,
      soloScoring, bock: this.bock, bockTrigger, ann: { ...ann },
    };
  }

  gameLabel(viewer = null, final = false) {
    switch (this.gameType) {
      case 'solo': return SOLO_TYPES[this.soloType].label;
      case 'hochzeit': return this.hochzeitFailed ? 'Hochzeit (allein)' : 'Hochzeit';
      case 'armut': return 'Armut';
      case 'stille':
        return final || this.phase === 'done' || viewer === this.soloist ? 'Stille Hochzeit' : 'Normalspiel';
      default: return 'Normalspiel';
    }
  }

  // ---------- Sicht eines Spielers ----------
  view(viewer) {
    const hasSeat = viewer != null && viewer >= 0;
    const lastTrick = this.tricks.length ? this.tricks[this.tricks.length - 1] : null;
    const tricksWon = [0, 0, 0, 0];
    for (const t of this.tricks) tricksWon[t.winner]++;
    const myPoints = hasSeat ? this.tricks.filter((t) => t.winner === viewer).reduce((s, t) => s + t.points, 0) : null;
    const a = this.armut;
    return {
      id: this.id,
      phase: this.phase,
      dealer: this.dealer,
      turn: this.turn,
      handSize: this.handSize,
      bock: this.bock,
      hand: hasSeat ? this.hands[viewer] : null,
      handCounts: this.hands.map((h) => h.length),
      playable: hasSeat ? this.legalFor(viewer) : [],
      reservations: this.reservations.map((r) => (r === null ? null : this.phase === 'reservation' ? (r === 'gesund' ? 'gesund' : 'vorbehalt') : null)),
      reservationOptions: hasSeat && this.phase === 'reservation' && this.turn === viewer ? this.reservationOptions(viewer) : [],
      game: {
        type: this.gameType === 'stille' && this.phase !== 'done' && viewer !== this.soloist ? 'normal' : this.gameType,
        label: this.gameLabel(viewer),
        soloType: this.soloType,
        soloist: this.gameType === 'solo' || this.hochzeitFailed || (this.gameType === 'stille' && (this.phase === 'done' || viewer === this.soloist)) ? this.soloist : null,
        hochzeiter: this.hochzeiter,
        partner: this.partner,
        hochzeitFailed: this.hochzeitFailed,
        klaerung: this.rules.hochzeitKlaerung,
        trumpMode: this.ctx.mode,
        trumpLabel: trumpModeLabel(this.ctx.mode),
        schweine: this.schweineShown,
        superschweine: !!this.superShown,
      },
      armut: a ? {
        poor: a.poor, rich: a.rich, declined: a.declined, gaveTrumps: a.gaveTrumps, returnedTrumps: a.returnedTrumps,
        received: hasSeat && viewer === a.rich && this.phase === 'armutReturn' ? a.cards : null,
        mustGive: hasSeat && viewer === a.poor && this.phase === 'armutGive' ? this.hands[viewer].filter((c) => isTrump(this.normalCtx, c)) : null,
      } : null,
      trick: this.trick ? { leader: this.trick.leader, plays: this.trick.plays, winner: this.trick.winner ?? null, points: this.trick.points ?? null } : null,
      lastTrick: lastTrick ? { leader: lastTrick.leader, plays: lastTrick.plays, winner: lastTrick.winner, points: lastTrick.points } : null,
      trickNo: this.tricks.length,
      tricksWon,
      myPoints,
      parties: this.knownParties(hasSeat ? viewer : null),
      ann: this.ann,
      seatAnn: this.seatAnn,
      annLog: this.annLog,
      announceOptions: hasSeat ? this.announceOptions(viewer) : [],
      result: this.phase === 'done' ? this.result : null,
      redeal: this.redeal,
      events: this.events,
    };
  }
}
