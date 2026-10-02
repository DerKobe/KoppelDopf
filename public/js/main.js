// Client-Hauptmodul: verbindet Server-Zustand, 3D-Tisch, HTML-Oberfläche und Voice/Video.
import { TableScene } from './table.js';
import { createNet } from './net.js';
import { RTC } from './rtc.js';
import { playSound, isMuted, setMuted, unlockAudio, playVoice, preloadVoices } from './sound.js';
import { getCardDataURL } from './cardart.js';
import { RULE_DEFS, PRESETS, applyPreset } from '/shared/rules.js';
import { announceLabel, cardName, keyOf, LEVEL_LABELS } from '/shared/cards.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

// Pro Browser-Tab eine Identität (sessionStorage): Reload behält den Platz, ein zweiter Tab ist ein eigener Spieler.
let clientId = null;
try { clientId = sessionStorage.getItem('kd-id'); } catch {}
if (!clientId) {
  clientId = crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36);
  try { sessionStorage.setItem('kd-id', clientId); } catch {}
}

const S = {
  myId: null,
  name: store.get('kd-name') || '',
  joined: false,
  state: null,
  firstState: true,
  lastRoundId: null,
  lastEventId: 0,
  selection: [],
  preselectFor: null,
  modal: null, // 'score' | 'last' | 'rules' | 'menu'
  dismissedResult: null,
  pendingSolo: null,
  lastTurnMine: false,
  chatOpen: false,
  modalHtml: '',
  actionHtml: '',
  lastMedia: '',
  resultSound: null,
};

const RES_LABELS = {
  gesund: 'Gesund', hochzeit: 'Hochzeit 💍', armut: 'Armut', schmeissen: 'Schmeißen',
  solo_damen: 'Damensolo', solo_buben: 'Bubensolo', solo_C: '♣ Kreuzsolo', solo_S: '♠ Piksolo',
  solo_H: '♥ Herzsolo', solo_D: '♦ Karosolo', solo_fleischlos: 'Fleischloser',
};

// ---------- Netzwerk ----------
const net = createNet({
  onOpen: () => { $('#conn').classList.add('hidden'); if (S.joined) hello(); },
  onClose: () => { if (S.joined) $('#conn').classList.remove('hidden'); },
  onMessage: handleMessage,
});
function hello() { net.send({ t: 'hello', clientId, name: S.name, voice: store.get('kd-voice') || null }); }

const rtc = new RTC({
  send: (to, data) => net.send({ t: 'rtc', to, data }),
  onChange: () => { renderMedia(); },
});

function handleMessage(msg) {
  switch (msg.t) {
    case 'welcome':
      S.myId = msg.id;
      rtc.setMyId(msg.id);
      $('#chat-log').innerHTML = '';
      (msg.chat || []).forEach((e) => addChat(e, true));
      break;
    case 'state':
      S.state = msg;
      onState();
      break;
    case 'peers':
      rtc.setPeers(msg.ids);
      break;
    case 'chat':
      addChat(msg.entry);
      break;
    case 'rtc':
      rtc.onSignal(msg.from, msg.data);
      break;
    case 'error':
      toast(msg.text, 'err');
      playSound('error');
      break;
  }
}

// ---------- 3D-Tisch ----------
const table = new TableScene($('#scene'), {
  onPlay: (id) => net.send({ t: 'play', card: id }),
  onLastTrick: () => { if (S.state?.match && S.state.round?.lastTrick) openModal('last'); },
  onIllegal: () => { toast('Diese Karte geht nicht – du musst Farbe bedienen.', 'err'); playSound('error'); },
  onSelectionChange: (ids) => { S.selection = ids; renderActionBar(); },
  getSelectMode: () => selectMode(),
  onEvent: (kind) => playSound(kind),
  onFrame: () => positionBadges(),
  onDealDone: () => {
    renderActionBar();
    if (S.turnSoundAfterDeal) { S.turnSoundAfterDeal = false; if (S.lastTurnMine) playSound('turn'); }
  },
});
table.pub.setChalkboard('Stammtisch', [['Heute:', 'Doko'], ['Bier:', '2,80'], ['Korn:', '1,50']]);

function selectMode() {
  const st = S.state, r = st?.round, me = st?.me.seat;
  if (!r || me == null || !r.armut) return false;
  return (r.phase === 'armutGive' && r.armut.poor === me) || (r.phase === 'armutReturn' && r.armut.rich === me);
}

// ---------- Zustand ----------
function seatName(i) { return S.state?.seats[i]?.name || `Platz ${i + 1}`; }

function onState() {
  const st = S.state;
  const r = st.round;
  const me = st.me.seat;
  table.setState({ mySeat: me, round: r });
  if (st.match) seatVoices(); // lädt die Ansagen der Stimmen am Tisch vorab

  if (r) {
    if (r.id !== S.lastRoundId) {
      S.lastRoundId = r.id;
      S.lastEventId = S.firstState ? (r.events.at(-1)?.id || 0) : 0;
      S.pendingSolo = null;
      S.selection = [];
    }
    for (const e of r.events) {
      if (e.id <= S.lastEventId) continue;
      S.lastEventId = e.id;
      const spoken = e.voice ? playVoice(voiceForSeat(e.voice.seat), e.voice.line) : false;
      // Ansagen erscheinen als Sprechblase am Spieler – so sieht man sofort, wer was gesagt hat
      const bubbled = e.voice ? showBubble(e.voice.seat, BUBBLE_TEXT[e.voice.line] || e.text) : false;
      if (e.kind === 'voice') continue; // reine Sprachansage (z.B. „Vorbehalt!“)
      if ((e.kind === 'big' || e.kind === 'announce') && !bubbled) banner(e.text);
      toast(e.text);
      if (e.kind === 'announce' && !spoken) playSound('announce');
    }
    // Armut: Trümpfe vorauswählen
    if (r.phase === 'armutGive' && r.armut?.poor === me && S.preselectFor !== r.id) {
      S.preselectFor = r.id;
      S.selection = (r.armut.mustGive || []).slice(0, 3);
      table.setSelection(S.selection);
    }
    const mine = me != null && r.turn === me && ['playing', 'reservation', 'armutGive', 'armutOffer', 'armutReturn'].includes(r.phase) && !(r.trick && r.trick.plays.length === 4);
    if (mine && !S.lastTurnMine && !S.firstState) {
      // Während die Karten noch einfliegen, ertönt der Hinweis erst zusammen mit dem Panel
      if (table.isDealing()) S.turnSoundAfterDeal = true;
      else playSound('turn');
    }
    S.lastTurnMine = mine;
    if (r.phase === 'done' && S.resultSound !== r.id && !S.firstState) {
      S.resultSound = r.id;
      if (me != null && r.result.perSeat[me] > 0) playSound('win');
    }
  } else {
    S.lastRoundId = null;
  }
  S.firstState = false;

  renderGameInfo();
  renderBadges();
  renderActionBar();
  renderModal();
  renderSpectators();
  renderLastTrickButton();
  renderToolbar();
  updateChalkboard();
}

// ---------- Stimmen der Spieler für die Sprachansagen ----------
// 1) selbst gewählte Stimme (Menü), 2) Bots passend zum Namen, 3) übrige Menschen bekommen eine noch freie Stimme.
// Lieber zwei gleiche Stimmen als ein „Kalle“ mit Frauenstimme.
const VOICE_OPTIONS = [
  [null, 'automatisch'], ['m1', 'männlich, rau'], ['m2', 'männlich, lebhaft'], ['f1', 'weiblich, bestimmt'], ['f2', 'weiblich, warm'],
];
const FEMALE_BOTS = ['Gisela', 'Uschi', 'Helga', 'Erika', 'Trude'];
let voiceCache = { key: '', voices: [] };
function seatVoices() {
  const seats = S.state?.seats || [];
  const chosen = seats.map((s) => (s?.kind === 'human' ? S.state.clients.find((c) => c.id === s.clientId)?.voice || null : null));
  const key = seats.map((s, i) => `${s?.kind}:${s?.name}:${chosen[i]}`).join('|');
  if (key === voiceCache.key) return voiceCache.voices;
  const used = new Set(chosen.filter(Boolean));
  const voices = chosen.slice();
  const genderCount = { m: 0, f: 0 };
  seats.forEach((s, i) => {
    if (s?.kind !== 'bot') return;
    const g = FEMALE_BOTS.includes(String(s.name).replace(/ \(Bot\)$/, '')) ? 'f' : 'm';
    const pool = [`${g}1`, `${g}2`];
    voices[i] = pool.find((v) => !used.has(v)) || pool[genderCount[g]++ % 2];
    used.add(voices[i]);
  });
  for (let i = 0; i < 4; i++) if (!voices[i]) { voices[i] = ['m1', 'm2', 'f1', 'f2'].find((v) => !used.has(v)) || ['m1', 'f1'][i % 2]; used.add(voices[i]); }
  voiceCache = { key, voices };
  preloadVoices(voices);
  return voices;
}
function voiceForSeat(seat) { return seatVoices()[seat] || 'm1'; }

// ---------- Sprechblasen an den Plaketten ----------
const BUBBLE_TEXT = {
  re: 'Re!', kontra: 'Kontra!',
  re_k90: 'Re, keine 90!', re_k60: 'Re, keine 60!', re_k30: 'Re, keine 30!', re_schwarz: 'Re, schwarz!',
  kontra_k90: 'Kontra, keine 90!', kontra_k60: 'Kontra, keine 60!', kontra_k30: 'Kontra, keine 30!', kontra_schwarz: 'Kontra, schwarz!',
  k90: 'Keine 90!', k60: 'Keine 60!', k30: 'Keine 30!', schwarz: 'Schwarz!',
  gesund: 'Gesund!', vorbehalt: 'Vorbehalt!', hochzeit: 'Hochzeit! 💍', armut: 'Armut!', schmeissen: 'Ich schmeiß!',
  solo_damen: 'Damensolo!', solo_buben: 'Bubensolo!', solo_C: 'Kreuzsolo!', solo_S: 'Piksolo!', solo_H: 'Herzsolo!',
  solo_D: 'Karosolo!', solo_fleischlos: 'Fleischloser!', schweinchen: 'Schweinchen! 🐷', superschweinchen: 'Superschweinchen! 🐷🐷',
  fuchs: 'Fuchs geklaut! 🦊', karlchen: 'Karlchen!', doppelkopf: 'Doppelkopf!',
};

// Zeigt eine Sprechblase an der Plakette eines Platzes (die Spitze zeigt auf den Spieler).
// Die Blasen liegen in einer eigenen, obersten Ebene (#bubbles) und folgen ihrer Plakette in jedem Bild,
// damit sie nie hinter der Aktionsleiste verschwinden; Klicks gehen durch sie hindurch.
const bubbleEls = new Map(); // seat -> Element
const bubbleFree = new Map(); // seat -> Zeitpunkt, ab dem die nächste Blase dieses Platzes erscheinen darf
const BUBBLE_GAP = 1400; // sagt jemand zwei Sprüche direkt nacheinander (Fuchs + Karlchen), bleibt der erste kurz stehen
function showBubble(seat, text, opts = {}) {
  const b = badgeEls[seat];
  if (!b || b.classList.contains('hidden') || !text) return false;
  const now = performance.now();
  const wait = (bubbleFree.get(seat) || 0) - now;
  bubbleFree.set(seat, Math.max(now, now + wait) + BUBBLE_GAP);
  if (wait > 0) { setTimeout(() => showBubbleNow(seat, text, opts), wait); return true; }
  showBubbleNow(seat, text, opts);
  return true;
}
function showBubbleNow(seat, text, { kind = 'call', ms = 3200 } = {}) {
  const b = badgeEls[seat];
  if (!b || b.classList.contains('hidden')) return;
  bubbleEls.get(seat)?.remove();
  const el = document.createElement('div');
  el.className = `bubble r${b.dataset.rel} ${kind}`;
  el.textContent = text;
  $('#bubbles').appendChild(el);
  bubbleEls.set(seat, el);
  positionBubbles();
  clearTimeout(el.timer);
  el.timer = setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => { el.remove(); if (bubbleEls.get(seat) === el) bubbleEls.delete(seat); }, 350);
  }, ms);
  return true;
}

function positionBubbles() {
  for (const [seat, el] of bubbleEls) {
    const b = badgeEls[seat];
    if (!b || b.classList.contains('hidden')) { el.style.display = 'none'; continue; }
    el.style.display = '';
    const r = b.getBoundingClientRect();
    const rel = Number(b.dataset.rel);
    const st = el.style;
    st.left = st.right = st.top = st.bottom = '';
    if (rel === 1) { st.left = `${r.right + 12}px`; st.top = `${r.top + 14}px`; }
    else if (rel === 3) { st.right = `${window.innerWidth - r.left + 12}px`; st.top = `${r.top + 14}px`; }
    else if (rel === 2) { st.left = `${r.left + r.width / 2}px`; st.top = `${r.bottom + 12}px`; }
    else { st.left = `${r.left + 4}px`; st.bottom = `${window.innerHeight - r.top + 12}px`; }
  }
}

// ---------- Spielinfo oben links ----------
function renderGameInfo() {
  const st = S.state, r = st?.round, m = st?.match;
  const el = $('#gameinfo');
  if (!r || !m) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const g = r.game;
  let title = g.label;
  if (g.soloist != null && (g.type === 'solo' || g.hochzeitFailed || g.type === 'stille')) title += ` – ${seatName(g.soloist)}`;
  const rows = [];
  rows.push(`Spiel <b>${m.gameNo + (r.phase === 'done' ? 0 : 1)}${m.totalGames ? ` / ${m.totalGames}` : ''}</b> · Geber: <b>${esc(seatName(r.dealer))}</b>`);
  if (r.phase === 'reservation') rows.push('Vorbehalte werden abgefragt…');
  else if (r.phase !== 'redeal') {
    rows.push(`Trumpf: <b>${esc(g.trumpLabel)}</b>${g.schweine ? ' · 🐷 Schweinchen' : ''}${g.superschweine ? ' · 🐷🐷' : ''}`);
    rows.push(`Stich: <b>${Math.min(r.trickNo + 1, r.handSize)} / ${r.handSize}</b>${r.myPoints != null ? ` · Deine Augen: <b>${r.myPoints}</b>` : ''}`);
  }
  if (g.type === 'hochzeit') {
    if (g.partner != null) rows.push(`Hochzeit: <b>${esc(seatName(g.hochzeiter))}</b> & <b>${esc(seatName(g.partner))}</b>`);
    else if (!g.hochzeitFailed) rows.push(`Hochzeit: <b>${esc(seatName(g.hochzeiter))}</b> sucht Partner (${{ erster: 'erster Fremdstich', fehl: 'erster Fehl-Fremdstich', trumpf: 'erster Trumpf-Fremdstich' }[g.klaerung]}, bis Stich 3)`);
  }
  if (r.armut && r.armut.rich != null) rows.push(`Armut: <b>${esc(seatName(r.armut.poor))}</b> & <b>${esc(seatName(r.armut.rich))}</b>${r.armut.returnedTrumps != null ? ` (${r.armut.returnedTrumps} Tr. zurück)` : ''}`);
  const annTxt = (p) => (r.ann[p] < 0 ? '—' : r.ann[p] === 0 ? announceLabel(p, 0) : LEVEL_LABELS[r.ann[p]]);
  if (st.rules.ansagen && r.phase === 'playing') rows.push(`Ansagen: Re <b>${annTxt('re')}</b> · Kontra <b>${annTxt('kontra')}</b>`);
  if (r.bock > 1 || m.bockGames > 0) rows.push(`<b style="color:var(--gold)">Bock ×2</b>${m.bockGames ? ` (noch ${m.bockGames})` : ''}`);
  el.innerHTML = `<div class="title">${esc(title)}</div>${rows.map((x) => `<div class="row">${x}</div>`).join('')}`;
}

// ---------- Spieler-Plaketten ----------
const badgeEls = [];
for (let i = 0; i < 4; i++) {
  const b = document.createElement('div');
  b.className = 'badge hidden';
  b.innerHTML = '<div class="face"></div><div class="nameplate"><div class="name"></div><div class="chips"></div></div>';
  $('#badges').appendChild(b);
  badgeEls.push(b);
}

function relOf(seat) { const base = S.state?.me.seat ?? 0; return (seat - base + 4) % 4; }

function renderBadges() {
  const st = S.state, r = st?.round;
  const inGame = !!st?.match;
  for (let seat = 0; seat < 4; seat++) {
    const b = badgeEls[seat];
    const s = st?.seats[seat];
    if (!inGame || !s) { b.classList.add('hidden'); continue; }
    b.classList.remove('hidden');
    const rel = relOf(seat);
    const isMe = seat === st.me.seat;
    b.classList.toggle('me', rel === 0);
    b.dataset.rel = rel;
    b.classList.toggle('turn', !!r && r.turn === seat && r.phase !== 'done');
    b.querySelector('.name').textContent = s.name + (isMe ? ' (Du)' : '');
    const chips = [];
    if (r) {
      if (r.dealer === seat) chips.push('<span class="chip">Geber</span>');
      const party = r.parties?.[seat];
      const solo = r.game.soloist === seat;
      if (party) chips.push(`<span class="chip ${party}">${solo ? 'Solo' : party === 're' ? 'Re' : 'Kontra'}</span>`);
      if (r.seatAnn[seat] >= 0) chips.push(`<span class="chip gold">📣 ${esc(r.seatAnn[seat] === 0 ? 'angesagt' : LEVEL_LABELS[r.seatAnn[seat]])}</span>`);
      if (r.game.type === 'hochzeit' && r.game.hochzeiter === seat && r.game.partner == null && !r.game.hochzeitFailed) chips.push('<span class="chip gold">Hochzeit 💍</span>');
      if (r.armut && r.armut.poor === seat) chips.push('<span class="chip">Armut</span>');
      if (r.phase === 'reservation' && r.reservations[seat]) chips.push(`<span class="chip ${r.reservations[seat] === 'gesund' ? '' : 'gold'}">${r.reservations[seat] === 'gesund' ? 'gesund' : 'Vorbehalt!'}</span>`);
      if (r.tricksWon[seat]) chips.push(`<span class="chip">${r.tricksWon[seat]} Stich${r.tricksWon[seat] > 1 ? 'e' : ''}</span>`);
      if (r.phase === 'done' && st.match.ready[seat] && s.kind === 'human') chips.push('<span class="chip re">bereit ✓</span>');
    }
    if (s.kind === 'bot') chips.push('<span class="chip">Bot</span>');
    else if (!s.online) chips.push('<span class="chip off">offline · Bot spielt</span>');
    let chipHtml = chips.join('');
    const canTake = st.me.seat == null && (s.kind === 'bot' || !s.online);
    if (canTake) chipHtml += `<div class="take"><button class="btn small primary" data-take="${seat}">Platz übernehmen</button></div>`;
    const ch = b.querySelector('.chips');
    if (ch.innerHTML !== chipHtml) ch.innerHTML = chipHtml;
    const face = b.querySelector('.face');
    face.dataset.video = s.clientId || '';
    face.dataset.avatar = s.kind === 'bot' ? '🤖' : (s.name || '?')[0].toUpperCase();
  }
  mountVideos();
  positionBadges();
}

$('#badges').addEventListener('click', (e) => {
  const t = e.target.closest('[data-take]');
  if (t) net.send({ t: 'sit', seat: Number(t.dataset.take) });
});

let lastLevelCheck = 0;
// „Letzter Stich“ gehört zum Spiel: Schaltfläche direkt auf dem Tisch, rechts neben der Stichmitte
function renderLastTrickButton() {
  const r = S.state?.round;
  const lt = r?.lastTrick;
  const btn = $('#last-trick');
  const show = !!(S.state?.match && lt && (r.phase === 'playing' || r.phase === 'done'));
  btn.classList.toggle('hidden', !show);
  if (!show) { S.lastTrickNo = null; return; }
  btn.querySelector('small').textContent = `an ${seatName(lt.winner)}`;
  if (S.lastTrickNo != null && S.lastTrickNo !== r.trickNo) {
    btn.classList.remove('bump');
    void btn.offsetWidth; // Animation neu starten
    btn.classList.add('bump');
  }
  S.lastTrickNo = r.trickNo;
  positionLastTrickButton();
}

function positionLastTrickButton() {
  const btn = $('#last-trick');
  if (btn.classList.contains('hidden')) return;
  // Hochformat: auf dem Filz ist kein Platz frei (Plaketten, Stichhaufen) -> unten rechts neben der eigenen Plakette andocken
  const docked = window.innerWidth / window.innerHeight < 1;
  btn.classList.toggle('docked', docked);
  if (docked) { btn.style.left = ''; btn.style.top = ''; return; }
  // Querformat: auf dem Tisch rechts neben der Stichmitte
  const p = table.toScreen(3.2, 0.05, 1.1);
  btn.style.left = `${Math.max(70, Math.min(window.innerWidth - 70, p.x))}px`;
  btn.style.top = `${p.y}px`;
}

function positionBadges() {
  const st = S.state;
  positionLastTrickButton();
  positionBubbles();
  if (!st?.match) return;
  const w = window.innerWidth, h = window.innerHeight;
  const now = performance.now();
  const checkLevels = now - lastLevelCheck > 120;
  if (checkLevels) lastLevelCheck = now;
  for (let seat = 0; seat < 4; seat++) {
    const b = badgeEls[seat];
    if (b.classList.contains('hidden')) continue;
    const rel = Number(b.dataset.rel);
    if (rel !== 0) {
      const p = table.seatAnchor(rel);
      if (p) {
        // an der tatsächlichen Breite klemmen, damit die Plakette bis an den Rand rücken kann (Hochformat: mehr Filz frei)
        const half = b.offsetWidth / 2 + 6;
        const x = Math.max(half, Math.min(w - half, p.x));
        const y = Math.max(rel === 2 ? 118 : 90, Math.min(h * 0.6, p.y));
        b.style.left = `${x}px`;
        b.style.top = `${y}px`;
      }
    } else { b.style.left = ''; b.style.top = ''; }
    if (checkLevels) {
      const cid = st.seats[seat]?.clientId;
      b.classList.toggle('speaking', !!cid && rtc.level(cid) > 0.035);
    }
  }
}

// ---------- Video-Elemente ----------
const videoEls = new Map();
const sink = document.createElement('div');
sink.style.display = 'none';
document.body.appendChild(sink);

function videoFor(cid) {
  const stream = rtc.streamFor(cid);
  let v = videoEls.get(cid);
  if (!stream) { if (v) { v.srcObject = null; v.remove(); videoEls.delete(cid); } return null; }
  if (!v) {
    v = document.createElement('video');
    v.autoplay = true;
    v.playsInline = true;
    if (cid === S.myId) { v.muted = true; v.classList.add('mirror'); }
    videoEls.set(cid, v);
    sink.appendChild(v);
  }
  if (v.srcObject !== stream) { v.srcObject = stream; }
  v.play().catch(() => {});
  return v;
}

function clientInfo(cid) { return S.state?.clients.find((c) => c.id === cid); }

function mountVideos() {
  const used = new Set();
  document.querySelectorAll('[data-video]').forEach((slot) => {
    if (slot.closest('.hidden')) return;
    const cid = slot.dataset.video;
    const v = cid ? videoFor(cid) : null;
    const info = cid ? clientInfo(cid) : null;
    const camOn = cid === S.myId ? rtc.camOn : !!info?.media?.video;
    const showVideo = v && camOn && v.srcObject?.getVideoTracks().length;
    if (showVideo && !used.has(cid)) {
      used.add(cid);
      if (v.parentNode !== slot) { slot.textContent = ''; slot.appendChild(v); v.play().catch(() => {}); }
    } else {
      if (v && v.parentNode === slot) sink.appendChild(v);
      const av = slot.dataset.avatar || '?';
      if (slot.querySelector('.avatar')?.textContent !== av) slot.innerHTML = `<div class="avatar">${esc(av)}</div>`;
    }
    let icons = '';
    if (cid && info && (info.media?.audio || info.media?.video || cid === S.myId && rtc.localStream)) {
      const micOn = cid === S.myId ? rtc.micOn : info.media.audio;
      icons = micOn ? '🎙️' : '🔇';
    }
    let mi = slot.querySelector('.mediaicons');
    if (!mi) { mi = document.createElement('div'); mi.className = 'mediaicons'; slot.appendChild(mi); }
    if (mi.textContent !== icons) mi.textContent = icons;
  });
  // alle übrigen Streams (z.B. Zuschauer ohne Kachel) weiter hörbar halten
  for (const [cid, v] of videoEls) if (!used.has(cid) && !v.isConnected) sink.appendChild(v);
}

function renderMedia() {
  const media = JSON.stringify({ a: rtc.micOn, v: rtc.camOn });
  if (media !== S.lastMedia) { S.lastMedia = media; net.send({ t: 'media', audio: rtc.micOn, video: rtc.camOn }); }
  renderToolbar();
  mountVideos();
}

function renderSpectators() {
  const st = S.state;
  const el = $('#spectators');
  if (!st) { el.innerHTML = ''; return; }
  const specs = st.clients.filter((c) => c.seat == null && c.online);
  const html = specs.map((c) => `<div class="spec"><div class="face" data-video="${esc(c.id)}" data-avatar="${esc((c.name || '?')[0].toUpperCase())}" style="position:relative;width:96px;height:72px;border-radius:7px;overflow:hidden;display:grid;place-items:center;background:#22140a"></div>${esc(c.name)}${c.id === S.myId ? ' (Du)' : ''}<br><small style="color:var(--muted)">Zuschauer</small></div>`).join('');
  if (el.dataset.html !== html) { el.dataset.html = html; el.innerHTML = html; }
  el.classList.toggle('hidden', !st.match);
  mountVideos();
}

// ---------- Aktionsleiste ----------
function renderActionBar() {
  const st = S.state, r = st?.round, me = st?.me.seat;
  let html = '';
  // Solange die Karten noch in die Hand fliegen, bleibt die Leiste leer (sie erscheint danach per Fade-in)
  if (r && st.match && !table.isDealing()) {
    const turnName = r.turn != null ? esc(seatName(r.turn)) : '';
    switch (r.phase) {
      case 'reservation':
        if (r.turn === me) {
          const opts = r.reservationOptions;
          if (S.pendingSolo) {
            html = `<div class="box panel" data-panel="soloConfirm"><div class="prompt">Wirklich <b>${esc(RES_LABELS[S.pendingSolo])}</b> spielen?</div>
              <div class="row"><button class="btn primary" data-res="${S.pendingSolo}">Ja, ${esc(RES_LABELS[S.pendingSolo])}!</button><button class="btn ghost" data-act="cancelSolo">Zurück</button></div></div>`;
          } else {
            const main = opts.filter((o) => !o.startsWith('solo_'));
            const solos = opts.filter((o) => o.startsWith('solo_'));
            html = `<div class="box panel" data-panel="reservation"><div class="prompt">Hast du einen Vorbehalt?</div>
              <div class="row">${main.map((o) => `<button class="btn ${o === 'gesund' ? 'primary' : ''}" data-res="${o}">${RES_LABELS[o]}</button>`).join('')}</div>
              ${solos.length ? `<div class="sub" style="margin:10px 0 6px">Solo ansagen:</div><div class="row">${solos.map((o) => `<button class="btn small" data-solo="${o}">${RES_LABELS[o]}</button>`).join('')}</div>` : ''}</div>`;
          }
        } else if (r.turn != null) html = `<div class="waiting">Vorbehalte: ${turnName} überlegt…</div>`;
        break;
      case 'armutGive':
        if (r.armut.poor === me) {
          const must = r.armut.mustGive || [];
          const ok = S.selection.length === 3 && must.every((c) => S.selection.includes(c));
          html = `<div class="box panel" data-panel="armutGive"><div class="prompt">Armut: Wähle 3 Karten zum Abgeben</div>
            <div class="sub">Alle Trümpfe (${must.length}) müssen dabei sein. Klicke Karten an, um sie auszuwählen. (${S.selection.length}/3)</div>
            <div class="row"><button class="btn primary" data-act="armutGive" ${ok ? '' : 'disabled'}>Karten abgeben</button></div></div>`;
        } else html = `<div class="waiting">${esc(seatName(r.armut.poor))} hat eine Armut und wählt Karten…</div>`;
        break;
      case 'armutOffer':
        if (r.turn === me) {
          html = `<div class="box panel" data-panel="armutOffer"><div class="prompt">${esc(seatName(r.armut.poor))} hat eine Armut mit <b>${r.armut.gaveTrumps}</b> Trumpf${r.armut.gaveTrumps === 1 ? '' : 'en'}.</div>
            <div class="sub">Nimmst du sie mit? Ihr spielt dann zusammen als Re.</div>
            <div class="row"><button class="btn primary" data-act="armutYes">Mitnehmen</button><button class="btn" data-act="armutNo">Nein, danke</button></div></div>`;
        } else html = `<div class="waiting">Wer nimmt die Armut? ${turnName} überlegt…</div>`;
        break;
      case 'armutReturn':
        if (r.armut.rich === me) {
          const rec = r.armut.received || [];
          html = `<div class="box panel" data-panel="armutReturn"><div class="prompt">Gib 3 Karten an ${esc(seatName(r.armut.poor))} zurück (${S.selection.length}/3)</div>
            <div class="sub">Erhalten:</div><div class="minicards">${rec.map((c) => `<img src="${getCardDataURL(keyOf(c))}" alt="${esc(cardName(c))}" title="${esc(cardName(c))}">`).join('')}</div>
            <div class="row"><button class="btn primary" data-act="armutReturn" ${S.selection.length === 3 ? '' : 'disabled'}>Zurückgeben</button></div></div>`;
        } else html = `<div class="waiting">${turnName} sortiert die Armut…</div>`;
        break;
      case 'playing': {
        const parts = [];
        const party = r.parties?.[me];
        if (r.announceOptions.length && party) {
          parts.push(`<div class="row">${r.announceOptions.slice(0, 3).map((l) => `<button class="btn small ${party}" data-ann="${l}">${l === 0 ? announceLabel(party, 0) : `${r.ann[party] < 0 ? announceLabel(party, 0) + ', ' : ''}${LEVEL_LABELS[l]}`}</button>`).join('')}</div>`);
        }
        if (r.turn === me && r.trick && r.trick.plays.length < 4) parts.unshift('<div class="hint">Du bist dran – spiel eine Karte</div>');
        html = parts.join('');
        break;
      }
      case 'done':
        if (S.dismissedResult === r.id) html = '<button class="btn primary" data-act="showResult">Abrechnung anzeigen</button>';
        break;
    }
  } else if (st?.match && me == null) {
    html = '<div class="waiting">Du schaust zu. Übernimm einen Bot-Platz, um mitzuspielen.</div>';
  }
  if (html !== S.actionHtml) {
    const bar = $('#actionbar');
    const prevPanel = bar.querySelector('.box')?.dataset.panel;
    S.actionHtml = html;
    bar.innerHTML = html;
    // Nur ein neu erscheinendes Panel blendet ein – nicht bei jeder Aktualisierung (z.B. Zähler bei der Armut)
    const box = bar.querySelector('.box');
    if (box && box.dataset.panel === prevPanel) box.classList.add('still');
  }
}

$('#actionbar').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.res) { S.pendingSolo = null; net.send({ t: 'reserve', choice: b.dataset.res }); return; }
  if (b.dataset.solo) { S.pendingSolo = b.dataset.solo; renderActionBar(); return; }
  if (b.dataset.ann) { net.send({ t: 'announce', level: Number(b.dataset.ann) }); return; }
  switch (b.dataset.act) {
    case 'cancelSolo': S.pendingSolo = null; renderActionBar(); break;
    case 'armutGive': net.send({ t: 'armutGive', cards: S.selection }); S.selection = []; break;
    case 'armutYes': net.send({ t: 'armutAnswer', accept: true }); break;
    case 'armutNo': net.send({ t: 'armutAnswer', accept: false }); break;
    case 'armutReturn': net.send({ t: 'armutReturn', cards: S.selection }); S.selection = []; break;
    case 'showResult': S.dismissedResult = null; renderModal(); renderActionBar(); break;
  }
});

// ---------- Modals ----------
function openModal(name) { S.modal = name; renderModal(); }
function closeModal() {
  const r = S.state?.round;
  if (r?.phase === 'done' && S.dismissedResult !== r.id && !S.modal) S.dismissedResult = r.id;
  S.modal = null;
  renderModal();
  renderActionBar();
}

function renderModal() {
  const st = S.state;
  const el = $('#modal');
  let html = '';
  let passive = false;
  if (!S.joined) html = joinHtml();
  else if (!st) html = '';
  else if (!st.match) html = lobbyHtml();
  else if (S.modal === 'score') html = scoreHtml();
  else if (S.modal === 'last') html = lastTrickHtml();
  else if (S.modal === 'rules') html = rulesViewHtml();
  else if (S.modal === 'menu') html = menuHtml();
  else if (st.round?.phase === 'done' && S.dismissedResult !== st.round.id) { html = resultHtml(); passive = false; }
  el.classList.toggle('open', !!html);
  el.classList.toggle('passive', passive);
  if (html !== S.modalHtml) {
    const scroll = el.querySelector('.dialog')?.scrollTop || 0;
    const inner = [...el.querySelectorAll('[data-scroll]')].map((n) => [n.dataset.scroll, n.scrollTop]);
    S.modalHtml = html;
    el.innerHTML = html;
    const d = el.querySelector('.dialog');
    if (d) d.scrollTop = scroll;
    for (const [k, top] of inner) { const n = el.querySelector(`[data-scroll="${k}"]`); if (n) n.scrollTop = top; }
    if (!S.joined) setTimeout(() => $('#join-name')?.focus(), 50);
    mountVideos();
  }
}

function joinHtml() {
  return `<div class="dialog narrow">
    <h1>🍺 KoppelDopf</h1>
    <p class="lead">Doppelkopf am Stammtisch – mit Freunden, Bots, Voice & Video.</p>
    <form id="join-form">
      <label style="display:block;margin-bottom:6px;color:var(--muted)">Wie heißt du?</label>
      <input type="text" id="join-name" maxlength="20" value="${esc(S.name)}" placeholder="Dein Name" autocomplete="nickname" />
      <div class="actions"><button class="btn primary" type="submit">An den Tisch</button></div>
    </form></div>`;
}

function rulesListHtml(rules, editable) {
  let html = '';
  let group = '';
  for (const d of RULE_DEFS) {
    if (d.group !== group) { group = d.group; html += `<div class="group">${esc(group)}</div>`; }
    const off = d.requires && !rules[d.requires];
    const dis = !editable || off ? 'disabled' : '';
    let ctl;
    if (d.type === 'bool') ctl = `<label class="switch"><input type="checkbox" data-rule="${d.key}" ${rules[d.key] ? 'checked' : ''} ${dis}><span></span></label>`;
    else ctl = `<select data-rule="${d.key}" ${dis}>${d.options.map(([k, l]) => `<option value="${k}" ${String(rules[d.key]) === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    html += `<div class="rule ${off ? 'disabled' : ''}"><div class="lbl">${esc(d.label)}</div>${ctl}<div class="help">${esc(d.help)}</div></div>`;
  }
  return `<div class="rules">${html}</div>`;
}

function lobbyHtml() {
  const st = S.state;
  const host = st.me.isHost;
  const hostName = st.clients.find((c) => c.id === st.hostId)?.name || '—';
  const seats = st.seats.map((s, i) => {
    const mine = s && s.clientId === S.myId;
    let who, ops = '';
    if (!s) {
      who = `<span style="color:var(--muted)">Freier Platz</span>`;
      ops += `<button class="btn small primary" data-lobby="sit" data-seat="${i}">Hinsetzen</button>`;
      if (host) ops += `<button class="btn small" data-lobby="addBot" data-seat="${i}">🤖 Bot</button>`;
    } else {
      who = `${esc(s.name)}${mine ? ' (Du)' : ''}<small>${s.kind === 'bot' ? 'Bot' : s.online ? (s.clientId === st.hostId ? 'Gastgeber' : 'Mitspieler') : 'offline'}</small>`;
      if (mine) ops += `<button class="btn small ghost" data-lobby="leave">Aufstehen</button>`;
      else if (host) ops += `<button class="btn small ghost" data-lobby="remove" data-seat="${i}">Entfernen</button>`;
    }
    const video = s && s.kind === 'human' ? `<div class="face" data-video="${esc(s.clientId)}" data-avatar="${esc((s.name || '?')[0].toUpperCase())}" style="position:relative;width:56px;height:42px;border-radius:8px;overflow:hidden;display:grid;place-items:center;background:#22140a;float:right"></div>` : '';
    return `<div class="seat ${s ? 'filled' : 'empty'} ${mine ? 'mine' : ''}"><div class="who">${video}Platz ${i + 1}: ${who}</div><div class="ops">${ops}</div></div>`;
  }).join('');
  const specs = st.clients.filter((c) => c.seat == null && c.online).map((c) => esc(c.name) + (c.id === S.myId ? ' (Du)' : ''));
  const empty = st.seats.filter((s) => !s).length;
  const seated = st.me.seat != null;
  const freeTxt = empty === 1 ? 'Noch 1 Platz frei' : `Noch ${empty} Plätze frei`;
  let status;
  if (empty) {
    const hint = host ? 'Warte auf deine Freunde oder fülle die freien Plätze mit Bots auf.'
      : !seated ? 'Setz dich auf einen freien Platz, um mitzuspielen.'
      : `Sobald alle sitzen, kann ${esc(hostName)} die Partie starten.`;
    status = `<div class="lobby-status wait">
      <div class="big">🪑 ${freeTxt}</div>
      <div>Die Partie startet erst, wenn alle 4 Plätze besetzt sind. ${hint}</div>
      ${host ? `<button class="btn" data-lobby="fillBots">🤖 Mit Bots auffüllen (${empty})</button>` : ''}
    </div>`;
  } else {
    status = `<div class="lobby-status ready">
      <div class="big">✅ Alle Plätze besetzt</div>
      <div>${host ? 'Stell noch die Sonderregeln ein – dann kann es losgehen.' : `Warte, bis ${esc(hostName)} (Gastgeber) die Partie startet.`}</div>
    </div>`;
  }
  return `<div class="dialog lobby">
    <div class="lobby-grid">
      <div class="lobby-main" data-scroll="lobby-main">
        <h1>🍺 KoppelDopf</h1>
        <p class="lead">Der Stammtisch ist offen – setzt euch und los geht's.</p>
        <h3>Plätze</h3>
        <div class="seats">${seats}</div>
        ${specs.length ? `<p style="color:var(--muted);font-size:13px;margin:8px 0 0">Zuschauer: ${specs.join(', ')}</p>` : ''}
        <div class="lobby-start">
          ${status}
          ${host ? `<button class="btn primary big" data-lobby="start" ${empty ? 'disabled' : ''}>${empty ? '🔒 Partie starten' : 'Partie starten'}</button>` : ''}
          <div class="info">${host ? 'Du bist Gastgeber: du stellst die Regeln ein und startest die Partie.' : `${esc(hostName)} ist Gastgeber: stellt die Regeln ein und startet.`}</div>
        </div>
        <h3>Freunde einladen</h3>
        <div class="invite"><input type="text" readonly value="${esc(location.href)}" onclick="this.select()"><button class="btn" data-lobby="copy">Kopieren</button></div>
        <div class="invite"><button class="btn" data-lobby="media">${rtc.localStream ? '📞 Voice/Video verlassen' : '📞 Kamera & Mikro an'}</button><small>Über das Internet nur per HTTPS (siehe README).</small></div>
      </div>
      <div class="lobby-rules" data-scroll="lobby-rules">
        <h3>Sonderregeln ${host ? '' : `<small style="color:var(--muted);font-family:var(--sans);font-weight:400">– stellt ${esc(hostName)} ein</small>`}</h3>
        ${host ? `<div class="presets">${Object.entries(PRESETS).map(([k, p]) => `<button class="btn small" data-preset="${k}">${esc(p.label)}</button>`).join('')}</div>` : ''}
        ${rulesListHtml(st.rules, host)}
      </div>
    </div>
  </div>`;
}

function partyNames(res, p) { return res.parties.map((x, i) => (x === p ? seatName(i) : null)).filter(Boolean); }

function resultHtml() {
  const st = S.state, r = st.round, res = r.result, m = st.match;
  const me = st.me.seat;
  const winTxt = res.winner ? `${res.winner === 're' ? 'Re' : 'Kontra'} gewinnt!` : 'Keine Partei gewinnt';
  const solo = res.soloScoring;
  const reNames = partyNames(res, 're').map(esc).join(' & ');
  const koNames = partyNames(res, 'kontra').map(esc).join(', ');
  const lines = res.lines.map((l) => `<tr><td>${esc(l.label)}</td><td class="v">+${l.value}</td></tr>`).join('');
  const specials = res.specials.map((s) => `<tr><td>${esc(s.label)} <span class="chip ${s.party}">${s.party === 're' ? 'Re' : 'Kontra'}</span></td><td class="v">${(s.party === res.winner || !res.winner) ? '' : ''}${s.party === 're' ? '+1 Re' : '+1 Ko'}</td></tr>`).join('');
  const totalTxt = res.total === 0 ? '0' : `${res.total > 0 ? 'Re' : 'Kontra'} +${Math.abs(res.total)}${solo ? ` (Solist ×3)` : ''}`;
  const deltas = res.perSeat.map((d, i) => `<div class="delta"><div class="n">${esc(seatName(i))}</div><div class="d ${d > 0 ? 'pos' : d < 0 ? 'neg' : ''}">${d > 0 ? '+' : ''}${d}</div><div class="n">Σ ${m.scores[i]}</div></div>`).join('');
  const waiting = [0, 1, 2, 3].filter((i) => !m.ready[i]).map((i) => esc(seatName(i)));
  const iAmReady = me != null && m.ready[me];
  let foot = '';
  if (m.finished) {
    const rank = [0, 1, 2, 3].sort((a, b) => m.scores[b] - m.scores[a]);
    foot = `<h3>🏆 Endstand nach ${m.gameNo} Spielen</h3><table class="lines">${rank.map((i, k) => `<tr><td>${k + 1}. ${esc(seatName(i))}</td><td class="v">${m.scores[i]}</td></tr>`).join('')}</table>
      <div class="actions"><button class="btn" data-act="closeModal">Tisch ansehen</button>${st.me.isHost ? '<button class="btn primary" data-act="stopMatch">Neue Partie (Lobby)</button>' : ''}</div>`;
  } else {
    foot = `<div class="actions" style="align-items:center"><span class="readyline">${waiting.length ? `Warte auf: ${waiting.join(', ')}` : ''}</span>
      <button class="btn" data-act="closeModal">Tisch ansehen</button>
      ${me != null ? `<button class="btn primary" data-act="ready" ${iAmReady ? 'disabled' : ''}>${iAmReady ? 'Bereit ✓' : 'Weiter'}</button>` : ''}</div>`;
  }
  return `<div class="dialog medium">
    <div class="result-head"><h2>${winTxt}</h2><span style="color:var(--muted)">${esc(res.gameLabel)}${res.bock > 1 ? ' · <b style="color:var(--gold)">Bock ×2</b>' : ''}</span></div>
    <div class="parties">
      <div class="party re ${res.winner === 're' ? 'win' : ''}"><div class="names">${solo ? 'Solist' : 'Re'}: ${reNames}</div><div class="pts">${res.pts.re} <small style="font-size:14px">Augen</small></div><div class="names">${res.tricks.re} Stiche${res.ann.re >= 0 ? ` · Ansage: ${esc(res.ann.re === 0 ? 'Re' : LEVEL_LABELS[res.ann.re])}` : ''}</div></div>
      <div class="party kontra ${res.winner === 'kontra' ? 'win' : ''}"><div class="names">Kontra: ${koNames}</div><div class="pts">${res.pts.kontra} <small style="font-size:14px">Augen</small></div><div class="names">${res.tricks.kontra} Stiche${res.ann.kontra >= 0 ? ` · Ansage: ${esc(res.ann.kontra === 0 ? 'Kontra' : LEVEL_LABELS[res.ann.kontra])}` : ''}</div></div>
    </div>
    <table class="lines">${lines}${specials ? `<tr><td colspan="2" style="color:var(--gold);padding-top:10px">Sonderpunkte</td></tr>${specials}` : ''}
      ${res.bock > 1 ? '<tr><td>Bock</td><td class="v">×2</td></tr>' : ''}
      <tr class="total"><td>Ergebnis</td><td class="v" style="width:auto;white-space:nowrap">${totalTxt}</td></tr></table>
    <div class="deltas">${deltas}</div>
    ${res.bockTrigger ? `<p style="color:var(--gold)">Bock! (${esc(res.bockTrigger)}) – die nächsten Spiele zählen doppelt.</p>` : ''}
    ${foot}
  </div>`;
}

function scoreHtml() {
  const st = S.state, m = st.match;
  const names = [0, 1, 2, 3].map((i) => `<th>${esc(seatName(i))}</th>`).join('');
  const rows = m.history.map((h) => `<tr><td>${h.no}</td><td>${esc(h.label)}${h.bock > 1 ? ' (Bock)' : ''}</td>${h.perSeat.map((d, i) => `<td><span class="${d > 0 ? 'pos' : d < 0 ? 'neg' : ''}">${d > 0 ? '+' : ''}${d}</span> <small style="color:var(--muted)">${h.scores[i]}</small></td>`).join('')}</tr>`).join('');
  return `<div class="dialog medium"><div class="result-head"><h2>🏆 Spielstand</h2><button class="x" data-act="closeModal">×</button></div>
    ${m.history.length ? `<table class="score"><thead><tr><th>#</th><th>Spiel</th>${names}</tr></thead><tbody>${rows}</tbody>
    <tfoot><tr><td></td><td>Summe</td>${m.scores.map((s) => `<td>${s}</td>`).join('')}</tr></tfoot></table>` : '<p class="lead">Noch keine Spiele abgerechnet.</p>'}
    ${m.bockGames ? `<p style="color:var(--gold)">Noch ${m.bockGames} Bockspiel(e).</p>` : ''}</div>`;
}

function lastTrickHtml() {
  const r = S.state.round;
  const lt = r?.lastTrick;
  const body = lt ? `<div class="trickview">${lt.plays.map((p) => `<figure class="${p.seat === lt.winner ? 'win' : ''}"><img src="${getCardDataURL(keyOf(p.card))}" alt="${esc(cardName(p.card))}"><figcaption>${esc(seatName(p.seat))}</figcaption></figure>`).join('')}</div>
    <p style="text-align:center">${esc(seatName(lt.winner))} bekommt den Stich (${lt.points} Augen).</p>` : '<p class="lead">In diesem Spiel wurde noch kein Stich gemacht.</p>';
  return `<div class="dialog medium"><div class="result-head"><h2>Letzter Stich</h2><button class="x" data-act="closeModal">×</button></div>${body}</div>`;
}

function rulesViewHtml() {
  return `<div class="dialog medium"><div class="result-head"><h2>📜 Regeln dieser Partie</h2><button class="x" data-act="closeModal">×</button></div>
    ${rulesListHtml(S.state.rules, false)}
    <h3>Kurz erklärt</h3>
    <p style="color:var(--muted);font-size:13.5px;line-height:1.5">Trümpfe im Normalspiel (hoch → niedrig): Herz-10 (Dulle), Kreuz-/Pik-/Herz-/Karo-Dame, Kreuz-/Pik-/Herz-/Karo-Bube, Karo-Ass, -10, -König, -9.
    Wer die Kreuz-Damen hat, spielt Re. Re braucht 121 Augen. Farbe muss bedient werden (Trumpf ist eine eigene „Farbe“).
    Ansagen: Re/Kontra bis zur 2. Karte, danach je eine Karte später keine 90, keine 60, keine 30, schwarz.</p></div>`;
}

function menuHtml() {
  const st = S.state;
  return `<div class="dialog narrow"><div class="result-head"><h2>Menü</h2><button class="x" data-act="closeModal">×</button></div>
    <div class="menu-list">
      <button class="btn" data-act="rename">✏️ Name ändern</button>
      <button class="btn" data-act="voice" title="In dieser Stimme hören die anderen deine Ansagen">🗣️ Meine Stimme: ${esc(VOICE_OPTIONS.find(([k]) => k === (store.get('kd-voice') || null))[1])} (ändern)</button>
      <button class="btn" data-act="fullscreen">⛶ Vollbild</button>
      <button class="btn" data-act="copy">🔗 Einladungslink kopieren</button>
      ${st.me.seat != null ? '<button class="btn" data-act="leaveSeat">🚶 Aufstehen (Bot übernimmt)</button>' : ''}
      ${st.me.isHost ? '<button class="btn danger" data-act="stopMatch">⏹ Partie beenden (zurück zur Lobby)</button>' : ''}
    </div></div>`;
}

$('#modal').addEventListener('submit', (e) => {
  if (e.target.id !== 'join-form') return;
  e.preventDefault();
  const name = $('#join-name').value.trim().slice(0, 20);
  if (!name) { $('#join-name').focus(); return; }
  S.name = name;
  store.set('kd-name', name);
  S.joined = true;
  unlockAudio();
  if (net.connected) hello(); else $('#conn').classList.remove('hidden');
  renderModal();
});

$('#modal').addEventListener('change', (e) => {
  const k = e.target.dataset?.rule;
  if (!k || !S.state?.me.isHost) return;
  const rules = { ...S.state.rules };
  const def = RULE_DEFS.find((d) => d.key === k);
  rules[k] = def.type === 'bool' ? e.target.checked : e.target.value;
  net.send({ t: 'setRules', rules });
});

$('#modal').addEventListener('click', async (e) => {
  if (e.target.id === 'modal' && S.state?.match) { closeModal(); return; }
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.preset) { net.send({ t: 'setRules', rules: applyPreset(b.dataset.preset) }); return; }
  const seat = Number(b.dataset.seat);
  switch (b.dataset.lobby) {
    case 'sit': net.send({ t: 'sit', seat }); return;
    case 'addBot': net.send({ t: 'addBot', seat }); return;
    case 'remove': net.send({ t: 'removeSeat', seat }); return;
    case 'leave': net.send({ t: 'leaveSeat' }); return;
    case 'fillBots': net.send({ t: 'fillBots' }); return;
    case 'start': net.send({ t: 'start' }); return;
    case 'media': toggleMedia(); return;
    case 'copy': copyLink(); return;
  }
  switch (b.dataset.act) {
    case 'closeModal': closeModal(); break;
    case 'ready': net.send({ t: 'ready' }); break;
    case 'stopMatch':
      if (confirm('Partie wirklich beenden? Der Spielstand geht verloren.')) { net.send({ t: 'stopMatch' }); S.modal = null; }
      break;
    case 'rename': {
      const n = prompt('Neuer Name:', S.name);
      if (n && n.trim()) { S.name = n.trim().slice(0, 20); store.set('kd-name', S.name); net.send({ t: 'rename', name: S.name }); }
      closeModal();
      break;
    }
    case 'fullscreen': toggleFullscreen(); closeModal(); break;
    case 'voice': {
      const cur = store.get('kd-voice') || null;
      const next = VOICE_OPTIONS[(VOICE_OPTIONS.findIndex(([k]) => k === cur) + 1) % VOICE_OPTIONS.length][0];
      store.set('kd-voice', next || '');
      net.send({ t: 'setVoice', voice: next });
      S.modalHtml = '';
      renderModal();
      if (next) playVoice(next, 're'); // Hörprobe
      break;
    }
    case 'copy': copyLink(); break;
    case 'leaveSeat':
      if (confirm('Aufstehen? Ein Bot spielt für dich weiter.')) net.send({ t: 'leaveSeat' });
      closeModal();
      break;
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && S.state?.match && (S.modal || $('#modal').classList.contains('open'))) closeModal();
});

// ---------- Toolbar ----------
function renderToolbar() {
  const has = !!rtc.localStream;
  $('#btn-mic').classList.toggle('hidden', !has);
  $('#btn-cam').classList.toggle('hidden', !has);
  $('#btn-mic').classList.toggle('off', has && !rtc.micOn);
  $('#btn-cam').classList.toggle('off', has && !rtc.camOn);
  $('#btn-media').classList.toggle('on', has);
  $('#btn-media').querySelector('span').textContent = has ? 'Auflegen' : 'Voice/Video';
  $('#btn-media').title = has ? 'Voice/Video verlassen' : 'Voice- & Videochat beitreten';
  $('#btn-sound').textContent = isMuted() ? '🔈' : '🔊';
  $('#btn-sound').classList.toggle('off', isMuted());
  const inGame = !!S.state?.match;
  for (const id of ['#btn-score', '#btn-rules', '#btn-menu']) $(id).classList.toggle('hidden', !inGame);
  $('#toolbar').classList.toggle('hidden', !S.joined);
}

async function toggleMedia() {
  try {
    if (rtc.localStream) rtc.disable();
    else { await rtc.enable(true); toast('Du bist im Voice-/Videochat.'); }
  } catch (err) {
    toast(`Kamera/Mikrofon nicht verfügbar: ${err.message || err.name}`, 'err');
  }
  renderModal();
}

$('#btn-media').addEventListener('click', toggleMedia);
$('#btn-mic').addEventListener('click', () => rtc.setMic(!rtc.micOn));
$('#btn-cam').addEventListener('click', async () => { try { await rtc.setCam(!rtc.camOn); } catch (e) { toast('Kamera nicht verfügbar.', 'err'); } });
$('#last-trick').addEventListener('click', () => openModal('last'));
$('#btn-score').addEventListener('click', () => openModal('score'));
$('#btn-rules').addEventListener('click', () => openModal('rules'));
$('#btn-menu').addEventListener('click', () => openModal('menu'));
$('#btn-sound').addEventListener('click', () => { setMuted(!isMuted()); renderToolbar(); });
$('#btn-chat').addEventListener('click', () => toggleChat());

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.().catch(() => {});
}
function copyLink() {
  navigator.clipboard?.writeText(location.href).then(() => toast('Link kopiert – schick ihn deinen Freunden!')).catch(() => toast(location.href));
}

// ---------- Chat ----------
function toggleChat(force) {
  S.chatOpen = force ?? !S.chatOpen;
  $('#chat').classList.toggle('hidden', !S.chatOpen);
  if (S.chatOpen) { $('#chat-dot').classList.add('hidden'); $('#chat-input').focus(); const log = $('#chat-log'); log.scrollTop = log.scrollHeight; }
}
$('#chat [data-close]').addEventListener('click', () => toggleChat(false));
$('#chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('#chat-input').value.trim();
  if (!v) return;
  net.send({ t: 'chat', text: v });
  $('#chat-input').value = '';
});
function addChat(e, silent) {
  const log = $('#chat-log');
  const div = document.createElement('div');
  div.className = e.system ? 'sys' : '';
  div.innerHTML = e.system ? esc(e.text) : `<b>${esc(e.from)}:</b> ${esc(e.text)}`;
  log.appendChild(div);
  while (log.children.length > 150) log.firstChild.remove();
  log.scrollTop = log.scrollHeight;
  // Chat von Spielern am Tisch erscheint auch als Sprechblase an ihrer Plakette
  const bubbled = !silent && !e.system && e.seat != null && S.state?.match ? showBubble(e.seat, e.text, { kind: 'chat', ms: 5000 }) : false;
  if (!silent && !S.chatOpen) {
    $('#chat-dot').classList.remove('hidden');
    if (!e.system && !bubbled) toast(`💬 ${e.from}: ${e.text}`);
  }
}

// ---------- Toasts & Banner ----------
function toast(text, cls = '') {
  const t = document.createElement('div');
  t.className = `toast ${cls}`;
  t.textContent = text;
  const box = $('#toasts');
  box.appendChild(t);
  while (box.children.length > 5) box.firstChild.remove();
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 400); }, 4500);
}
let bannerTimer = null;
function banner(text) {
  const b = $('#banner');
  b.textContent = text;
  b.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => b.classList.remove('show'), 2400);
}

// ---------- Kreidetafel ----------
let chalkKey = '';
function updateChalkboard() {
  const st = S.state;
  let title, rows;
  if (st?.match) {
    title = st.match.totalGames ? `Spiel ${Math.min(st.match.gameNo + 1, st.match.totalGames)}/${st.match.totalGames}` : 'Spielstand';
    rows = [0, 1, 2, 3].map((i) => [seatName(i), st.match.scores[i]]);
  } else {
    title = 'Stammtisch';
    rows = [['Heute:', 'Doko'], ['Bier:', '2,80'], ['Korn:', '1,50']];
  }
  const key = JSON.stringify([title, rows]);
  if (key !== chalkKey) { chalkKey = key; table.pub.setChalkboard(title, rows); }
}

// ---------- Start ----------
if (new URLSearchParams(location.search).has('debug')) window.KD = { S, net, table, rtc, showBubble };
renderModal();
renderToolbar();
setInterval(() => { if (rtc.localStream || rtc.peers.size) mountVideos(); }, 2000);
