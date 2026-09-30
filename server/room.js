// Der eine Stammtisch: Spieler, Plätze, Bots, Partie-Verlauf, Chat und WebRTC-Signaling.
import { Round } from './round.js';
import { botAct } from './bot.js';
import { defaultRules, sanitizeRules } from '../shared/rules.js';

const BOT_NAMES = ['Heinz', 'Gisela', 'Kalle', 'Uschi', 'Willi', 'Helga', 'Manni', 'Erika', 'Jupp', 'Trude'];
const TEMPO = {
  langsam: { bot: 1400, trick: 2200 },
  normal: { bot: 850, trick: 1500 },
  schnell: { bot: 350, trick: 800 },
};

export class Room {
  constructor() {
    this.clients = new Map(); // clientId -> { id, name, ws, seat, online, media }
    this.seats = [null, null, null, null]; // { kind: 'human', clientId } | { kind: 'bot', name }
    this.hostId = null;
    this.rules = defaultRules();
    this.match = null;
    this.chat = [];
    this.timer = null;
    this.lobbyLeaveTimers = new Map();
    this.roundSeq = 0;
    this.msgSeq = 0;
  }

  // ---------- Verbindungen ----------
  connect(ws) {
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      try {
        this.handle(ws, msg);
      } catch (e) {
        this.send(ws, { t: 'error', text: e.message || String(e) });
      }
    });
    ws.on('close', () => {
      const c = ws.clientId && this.clients.get(ws.clientId);
      if (c && c.ws === ws) this.disconnect(c);
    });
  }

  send(ws, obj) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  disconnect(c) {
    c.online = false;
    c.ws = null;
    c.media = { audio: false, video: false };
    if (c.seat == null) this.clients.delete(c.id);
    else if (!this.match) {
      // In der Lobby wird der Platz nach kurzer Zeit frei, falls der Spieler nicht zurückkommt.
      const t = setTimeout(() => {
        if (!c.online && !this.match) { this.freeSeat(c); this.clients.delete(c.id); this.broadcast(); }
      }, 15000);
      this.lobbyLeaveTimers.set(c.id, t);
    }
    if (this.hostId === c.id) this.pickHost();
    this.broadcastPeers();
    this.broadcast();
    this.schedule();
  }

  pickHost() {
    const seated = [...this.clients.values()].filter((c) => c.online && c.seat != null);
    const any = [...this.clients.values()].filter((c) => c.online);
    this.hostId = (seated[0] || any[0])?.id ?? null;
  }

  freeSeat(c) {
    if (c.seat != null && this.seats[c.seat]?.clientId === c.id) this.seats[c.seat] = null;
    c.seat = null;
  }

  seatName(i) {
    const s = this.seats[i];
    if (!s) return `Platz ${i + 1}`;
    if (s.kind === 'bot') return s.name;
    return this.clients.get(s.clientId)?.name || 'Spieler';
  }

  isAutoSeat(i) {
    const s = this.seats[i];
    if (!s || s.kind === 'bot') return true;
    const c = this.clients.get(s.clientId);
    return !c || !c.online;
  }

  requireHost(c) { if (this.hostId !== c.id) throw new Error('Nur der Gastgeber darf das.'); }

  // ---------- Nachrichten ----------
  handle(ws, msg) {
    if (msg.t === 'hello') return this.hello(ws, msg);
    const c = ws.clientId && this.clients.get(ws.clientId);
    if (!c) return;
    const r = this.match?.round;
    switch (msg.t) {
      case 'rename': {
        const name = cleanName(msg.name);
        if (name) c.name = name;
        break;
      }
      case 'sit': this.sit(c, msg.seat | 0); break;
      case 'leaveSeat': this.leaveSeat(c); break;
      case 'addBot': {
        this.requireHost(c);
        if (this.match) throw new Error('Die Partie läuft bereits.');
        const i = msg.seat | 0;
        if (i < 0 || i > 3 || this.seats[i]) throw new Error('Platz ist belegt.');
        this.seats[i] = { kind: 'bot', name: this.freeBotName() };
        break;
      }
      case 'fillBots': {
        this.requireHost(c);
        if (this.match) throw new Error('Die Partie läuft bereits.');
        for (let i = 0; i < 4; i++) if (!this.seats[i]) this.seats[i] = { kind: 'bot', name: this.freeBotName() };
        break;
      }
      case 'removeSeat': {
        this.requireHost(c);
        if (this.match) throw new Error('Die Partie läuft bereits.');
        const i = msg.seat | 0;
        const s = this.seats[i];
        if (s?.kind === 'human') { const o = this.clients.get(s.clientId); if (o) o.seat = null; }
        this.seats[i] = null;
        break;
      }
      case 'setRules':
        this.requireHost(c);
        if (this.match) throw new Error('Regeln können nur vor der Partie geändert werden.');
        this.rules = sanitizeRules(msg.rules);
        break;
      case 'start': this.requireHost(c); this.startMatch(); break;
      case 'stopMatch':
        this.requireHost(c);
        this.stopMatch();
        this.systemChat('Die Partie wurde beendet. Zurück in der Lobby.');
        break;
      case 'reserve': this.mySeatAction(c, () => r.reserve(c.seat, String(msg.choice))); break;
      case 'armutGive': this.mySeatAction(c, () => r.armutGive(c.seat, msg.cards)); break;
      case 'armutAnswer': this.mySeatAction(c, () => r.armutAnswer(c.seat, !!msg.accept)); break;
      case 'armutReturn': this.mySeatAction(c, () => r.armutReturn(c.seat, msg.cards)); break;
      case 'play': this.mySeatAction(c, () => r.play(c.seat, String(msg.card))); break;
      case 'announce': this.mySeatAction(c, () => r.announce(c.seat, msg.level | 0)); break;
      case 'ready': {
        if (!this.match || !r || r.phase !== 'done' || c.seat == null) return;
        this.match.ready[c.seat] = true;
        this.checkReady();
        break;
      }
      case 'chat': {
        const text = String(msg.text || '').slice(0, 300).trim();
        if (!text) return;
        this.pushChat({ from: c.name, seat: c.seat, text });
        return;
      }
      case 'media':
        c.media = { audio: !!msg.audio, video: !!msg.video };
        break;
      case 'setVoice':
        c.voice = cleanVoice(msg.voice);
        break;
      case 'rtc': {
        const target = this.clients.get(String(msg.to));
        if (target?.ws) this.send(target.ws, { t: 'rtc', from: c.id, data: msg.data });
        return;
      }
      default: return;
    }
    this.broadcast();
    this.schedule();
  }

  hello(ws, msg) {
    const id = String(msg.clientId || '').slice(0, 64) || Math.random().toString(36).slice(2);
    const name = cleanName(msg.name) || 'Gast';
    let c = this.clients.get(id);
    if (c) {
      if (c.ws && c.ws !== ws) { c.ws.clientId = null; try { c.ws.close(); } catch {} }
      c.ws = ws; c.online = true; c.name = name; c.voice = cleanVoice(msg.voice);
      clearTimeout(this.lobbyLeaveTimers.get(id));
    } else {
      c = { id, name, ws, seat: null, online: true, media: { audio: false, video: false }, voice: cleanVoice(msg.voice) };
      this.clients.set(id, c);
    }
    ws.clientId = id;
    if (!this.hostId || !this.clients.get(this.hostId)?.online) this.hostId = id;
    if (this.match?.round && c.seat != null) this.match.round.names[c.seat] = c.name;
    this.send(ws, { t: 'welcome', id, chat: this.chat.slice(-50) });
    this.broadcastPeers();
    this.broadcast();
    this.schedule();
  }

  sit(c, i) {
    if (i < 0 || i > 3) throw new Error('Ungültiger Platz.');
    const s = this.seats[i];
    if (this.match) {
      // Während der Partie: Bot- oder verwaiste Plätze übernehmen.
      if (c.seat != null) throw new Error('Du sitzt bereits am Tisch.');
      const takeable = s && (s.kind === 'bot' || !this.clients.get(s.clientId)?.online);
      if (!takeable) throw new Error('Dieser Platz ist besetzt.');
      if (s.kind === 'human') { const o = this.clients.get(s.clientId); if (o) o.seat = null; }
      this.seats[i] = { kind: 'human', clientId: c.id };
      c.seat = i;
      if (this.match.round) this.match.round.names[i] = c.name;
      this.systemChat(`${c.name} übernimmt Platz ${i + 1}.`);
      return;
    }
    if (s) throw new Error('Platz ist belegt.');
    this.freeSeat(c);
    this.seats[i] = { kind: 'human', clientId: c.id };
    c.seat = i;
    // Gastgeber soll jemand am Tisch sein: ein Zuschauer gibt das Amt an den ersten, der sich hinsetzt.
    const host = this.clients.get(this.hostId);
    if (!host?.online || host.seat == null) this.hostId = c.id;
  }

  leaveSeat(c) {
    if (c.seat == null) return;
    if (this.match) {
      const i = c.seat;
      this.seats[i] = { kind: 'bot', name: `${c.name} (Bot)` };
      c.seat = null;
      this.systemChat(`${c.name} steht auf – ein Bot spielt weiter.`);
    } else {
      this.freeSeat(c);
      if (this.hostId === c.id) this.pickHost();
    }
  }

  freeBotName() {
    const used = new Set(this.seats.filter((s) => s?.kind === 'bot').map((s) => s.name));
    return BOT_NAMES.find((n) => !used.has(n)) || 'Bot';
  }

  mySeatAction(c, fn) {
    if (!this.match?.round || c.seat == null) throw new Error('Du sitzt nicht am Tisch.');
    fn();
  }

  // ---------- Partie ----------
  startMatch() {
    if (this.match) throw new Error('Die Partie läuft bereits.');
    if (this.seats.some((s) => !s)) throw new Error('Es müssen alle 4 Plätze besetzt sein (ggf. mit Bots auffüllen).');
    this.match = {
      scores: [0, 0, 0, 0],
      history: [],
      gameNo: 0,
      totalGames: Number(this.rules.spiele) || 0,
      dealer: Math.floor(Math.random() * 4),
      bockGames: 0,
      round: null,
      ready: [false, false, false, false],
      finished: false,
      recorded: false,
    };
    this.systemChat('Die Partie beginnt. Gut Blatt!');
    this.newRound();
  }

  stopMatch() {
    clearTimeout(this.timer);
    this.match = null;
    for (let i = 0; i < 4; i++) {
      const s = this.seats[i];
      if (s?.kind === 'human' && !this.clients.get(s.clientId)?.online) {
        const c = this.clients.get(s.clientId);
        this.seats[i] = null;
        if (c) this.clients.delete(c.id);
      }
    }
  }

  newRound() {
    const m = this.match;
    const names = [0, 1, 2, 3].map((i) => this.seatName(i));
    m.round = new Round({ id: ++this.roundSeq, rules: this.rules, dealer: m.dealer, names, bock: m.bockGames > 0 ? 2 : 1 });
    m.ready = [false, false, false, false];
    m.recorded = false;
  }

  recordResult() {
    const m = this.match, r = m.round;
    if (m.recorded || r.phase !== 'done') return;
    m.recorded = true;
    const res = r.result;
    m.gameNo++;
    for (let i = 0; i < 4; i++) m.scores[i] += res.perSeat[i];
    m.history.push({
      no: m.gameNo, label: res.gameLabel, dealer: r.dealer, perSeat: res.perSeat, scores: m.scores.slice(),
      winner: res.winner, pts: res.pts, bock: res.bock, parties: res.parties,
    });
    if (res.bock > 1) m.bockGames--;
    if (res.bockTrigger) {
      m.bockGames += 4;
      this.systemChat(`Bock! (${res.bockTrigger}) – die nächsten Spiele zählen doppelt.`);
    }
    m.dealer = (m.dealer + 1) % 4;
    if (m.totalGames && m.gameNo >= m.totalGames) m.finished = true;
    for (let i = 0; i < 4; i++) if (this.isAutoSeat(i)) m.ready[i] = true;
  }

  checkReady() {
    const m = this.match;
    if (!m || m.finished) return;
    for (let i = 0; i < 4; i++) if (this.isAutoSeat(i)) m.ready[i] = true;
    if (m.ready.every(Boolean)) this.newRound();
  }

  // ---------- Takt: Bots, Stiche einsammeln, Neugeben ----------
  schedule() {
    clearTimeout(this.timer);
    const m = this.match;
    const r = m?.round;
    if (!r) return;
    const tempo = TEMPO[this.rules.botTempo] || TEMPO.normal;
    if (r.phase === 'done') {
      const fresh = !m.recorded;
      this.recordResult();
      this.checkReady();
      if (fresh || m.round !== r) this.broadcast();
      if (m.round !== r) this.schedule();
      return;
    }
    if (r.phase === 'redeal') {
      this.timer = setTimeout(() => { this.newRound(); this.broadcast(); this.schedule(); }, 2600);
      return;
    }
    if (r.trickComplete()) {
      this.timer = setTimeout(() => { r.collectTrick(); this.broadcast(); this.schedule(); }, tempo.trick);
      return;
    }
    const seat = r.turn;
    if (seat == null || !this.isAutoSeat(seat)) return;
    const human = this.seats[seat]?.kind === 'human';
    this.timer = setTimeout(() => {
      try { botAct(r, seat); } catch (e) { console.error('Bot-Fehler', e); }
      this.broadcast();
      this.schedule();
    }, human ? tempo.bot + 1500 : tempo.bot);
  }

  // ---------- Chat ----------
  pushChat(entry) {
    const e = { id: ++this.msgSeq, time: Date.now(), ...entry };
    this.chat.push(e);
    if (this.chat.length > 200) this.chat.shift();
    for (const c of this.clients.values()) if (c.ws) this.send(c.ws, { t: 'chat', entry: e });
  }
  systemChat(text) { this.pushChat({ from: null, system: true, text }); }

  // ---------- Zustand verschicken ----------
  broadcastPeers() {
    const ids = [...this.clients.values()].filter((c) => c.online).map((c) => c.id);
    for (const c of this.clients.values()) if (c.ws) this.send(c.ws, { t: 'peers', ids: ids.filter((x) => x !== c.id) });
  }

  publicState() {
    const m = this.match;
    return {
      hostId: this.hostId,
      rules: this.rules,
      clients: [...this.clients.values()].map((c) => ({ id: c.id, name: c.name, seat: c.seat, online: c.online, media: c.media, voice: c.voice || null })),
      seats: this.seats.map((s, i) => s && {
        kind: s.kind,
        name: this.seatName(i),
        clientId: s.clientId || null,
        online: s.kind === 'bot' ? true : !!this.clients.get(s.clientId)?.online,
      }),
      match: m && {
        scores: m.scores, history: m.history, gameNo: m.gameNo, totalGames: m.totalGames,
        bockGames: m.bockGames, ready: m.ready, finished: m.finished, dealer: m.round?.dealer ?? m.dealer,
      },
    };
  }

  broadcast() {
    const base = this.publicState();
    for (const c of this.clients.values()) {
      if (!c.ws) continue;
      const round = this.match?.round ? this.match.round.view(c.seat) : null;
      this.send(c.ws, { t: 'state', ...base, me: { id: c.id, seat: c.seat, isHost: this.hostId === c.id }, round });
    }
  }
}

// Stimme für die Sprachansagen (siehe public/audio/voice); null = automatisch
function cleanVoice(v) {
  return ['m1', 'm2', 'f1', 'f2'].includes(v) ? v : null;
}

function cleanName(n) {
  return String(n || '').replace(/[<>]/g, '').trim().slice(0, 20);
}
