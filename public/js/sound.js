// Kleine synthetische Geräusche (kein Asset-Download nötig).
let ctx = null;
let muted = false;
try { muted = localStorage.getItem('kd-muted') === '1'; } catch {}

function ac() {
  if (!ctx) { try { ctx = new AudioContext(); } catch { return null; } }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function noise(a, dur) {
  const buf = a.createBuffer(1, Math.ceil(a.sampleRate * dur), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = a.createBufferSource();
  src.buffer = buf;
  return src;
}

function snap(a, t, freq = 2400, dur = 0.06, vol = 0.35) {
  const src = noise(a, dur);
  const f = a.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 0.8;
  const g = a.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(a.destination);
  src.start(t);
}

function tone(a, t, freq, dur, vol = 0.12, type = 'sine') {
  const o = a.createOscillator();
  o.type = type; o.frequency.value = freq;
  const g = a.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t); o.stop(t + dur + 0.02);
}

export function playSound(kind) {
  if (muted) return;
  const a = ac();
  if (!a) return;
  const t = a.currentTime + 0.01;
  switch (kind) {
    case 'play': snap(a, t, 2200 + Math.random() * 600); break;
    case 'collect': snap(a, t, 900, 0.22, 0.25); snap(a, t + 0.05, 1400, 0.18, 0.15); break;
    case 'deal': for (let i = 0; i < 10; i++) snap(a, t + i * 0.07, 2000 + Math.random() * 1000, 0.05, 0.2); break;
    case 'turn': tone(a, t, 660, 0.18); tone(a, t + 0.12, 880, 0.25); break;
    case 'announce': tone(a, t, 523, 0.3, 0.1, 'triangle'); tone(a, t + 0.1, 784, 0.4, 0.1, 'triangle'); break;
    case 'win': [523, 659, 784, 1046].forEach((f, i) => tone(a, t + i * 0.12, f, 0.35, 0.1, 'triangle')); break;
    case 'error': tone(a, t, 200, 0.2, 0.1, 'square'); break;
  }
}

// ---------- Sprachansagen (public/audio/voice/<stimme>/<zeile>.mp3, erzeugt mit text2speech) ----------
const VOICE_BASE = '/audio/voice';
let voiceManifest = null;
const voiceBuffers = new Map(); // "stimme/zeile" -> Promise<AudioBuffer|null>

export const voicesReady = fetch(`${VOICE_BASE}/manifest.json`)
  .then((r) => (r.ok ? r.json() : null))
  .then((m) => { voiceManifest = m; return m; })
  .catch(() => null);

function loadVoice(key) {
  if (!voiceBuffers.has(key)) {
    const a = ac();
    voiceBuffers.set(key, !a ? Promise.resolve(null) : fetch(`${VOICE_BASE}/${key}.mp3`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
      .then((buf) => a.decodeAudioData(buf))
      .catch(() => null));
  }
  return voiceBuffers.get(key);
}

export function hasVoiceLine(voice, line) { return !!voiceManifest?.files?.[`${voice}/${line}`]; }

// Lädt die Ansagen der Stimmen am Tisch schon vorab, damit sie ohne Verzögerung kommen
export function preloadVoices(voices) {
  voicesReady.then((m) => {
    if (!m) return;
    for (const v of voices) for (const line of Object.keys(m.lines || {})) if (hasVoiceLine(v, line)) loadVoice(`${v}/${line}`);
  });
}

// Spielt eine Ansage; liefert false, wenn es dafür keine Sprachdatei gibt (dann greift der Signalton)
export function playVoice(voice, line) {
  if (!voiceManifest || !hasVoiceLine(voice, line)) return false;
  if (muted) return true;
  const a = ac();
  if (!a) return false;
  loadVoice(`${voice}/${line}`).then((buffer) => {
    if (!buffer || muted) return;
    const src = a.createBufferSource();
    src.buffer = buffer;
    const g = a.createGain();
    g.gain.value = 0.95;
    src.connect(g).connect(a.destination);
    src.start();
  });
  return true;
}

export function isMuted() { return muted; }
export function setMuted(m) {
  muted = m;
  try { localStorage.setItem('kd-muted', m ? '1' : '0'); } catch {}
}
export function unlockAudio() { ac(); }
