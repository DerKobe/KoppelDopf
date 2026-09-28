// Voice- & Video-Chat: WebRTC-Mesh zwischen allen Leuten am Tisch, Signaling über den Spiel-WebSocket.
// Nutzt das "Perfect Negotiation"-Muster, damit gleichzeitige Angebote (Glare) sauber aufgelöst werden.
export class RTC {
  constructor({ send, onChange }) {
    this.sendSignal = send;
    this.onChange = onChange;
    this.peers = new Map();
    this.localStream = null;
    this.myId = null;
    this.iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
    this.audioCtx = null;
    this.meters = new Map();
    fetch('/config.json').then((r) => r.json()).then((c) => { if (c.iceServers) this.iceServers = c.iceServers; }).catch(() => {});
  }

  get supported() { return !!(navigator.mediaDevices?.getUserMedia && window.RTCPeerConnection); }

  setMyId(id) { this.myId = id; }

  setPeers(ids) {
    const want = new Set(ids);
    for (const id of want) if (!this.peers.has(id)) this.createPeer(id);
    for (const [id, p] of this.peers) if (!want.has(id)) { p.pc.close(); this.peers.delete(id); this.meters.delete(id); }
    this.onChange();
  }

  createPeer(id) {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const p = { id, pc, polite: String(this.myId) > String(id), makingOffer: false, ignoreOffer: false, stream: null };
    pc.onicecandidate = (e) => { if (e.candidate) this.sendSignal(id, { candidate: e.candidate }); };
    pc.onnegotiationneeded = async () => {
      try {
        p.makingOffer = true;
        await pc.setLocalDescription();
        this.sendSignal(id, { description: pc.localDescription });
      } catch (e) { console.warn('RTC offer', e); } finally { p.makingOffer = false; }
    };
    pc.ontrack = (e) => {
      p.stream = e.streams[0] || p.stream || new MediaStream();
      if (!p.stream.getTracks().includes(e.track)) p.stream.addTrack(e.track);
      e.track.onunmute = () => this.onChange();
      e.track.onended = () => this.onChange();
      this.meters.delete(id);
      this.onChange();
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') pc.restartIce?.();
      this.onChange();
    };
    if (this.localStream) for (const t of this.localStream.getTracks()) pc.addTrack(t, this.localStream);
    this.peers.set(id, p);
    return p;
  }

  async onSignal(from, data) {
    const p = this.peers.get(from) || this.createPeer(from);
    const pc = p.pc;
    try {
      if (data.description) {
        const offerCollision = data.description.type === 'offer' && (p.makingOffer || pc.signalingState !== 'stable');
        p.ignoreOffer = !p.polite && offerCollision;
        if (p.ignoreOffer) return;
        await pc.setRemoteDescription(data.description);
        if (data.description.type === 'offer') {
          await pc.setLocalDescription();
          this.sendSignal(from, { description: pc.localDescription });
        }
      } else if (data.candidate) {
        try { await pc.addIceCandidate(data.candidate); } catch (e) { if (!p.ignoreOffer) console.warn('ICE', e); }
      }
    } catch (e) { console.warn('RTC signal', e); }
  }

  // Mikrofon/Kamera einschalten. Fällt auf nur Audio zurück, wenn keine Kamera da ist.
  async enable(withVideo = true) {
    if (!this.supported) throw new Error('Dein Browser unterstützt kein WebRTC (oder die Seite läuft nicht über HTTPS).');
    const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    const video = { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 20 }, facingMode: 'user' };
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio, video: withVideo ? video : false });
    } catch (e) {
      if (!withVideo) throw e;
      stream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
    }
    this.localStream = stream;
    for (const p of this.peers.values()) for (const t of stream.getTracks()) p.pc.addTrack(t, stream);
    this.ensureAudioCtx();
    this.meters.delete('local');
    this.onChange();
  }

  disable() {
    if (!this.localStream) return;
    for (const p of this.peers.values()) for (const s of p.pc.getSenders()) if (s.track) p.pc.removeTrack(s);
    for (const t of this.localStream.getTracks()) t.stop();
    this.localStream = null;
    this.meters.delete('local');
    this.onChange();
  }

  get micOn() { return !!this.localStream?.getAudioTracks().some((t) => t.enabled); }
  get camOn() { return !!this.localStream?.getVideoTracks().some((t) => t.enabled && t.readyState === 'live'); }
  get hasCam() { return !!this.localStream?.getVideoTracks().length; }

  setMic(on) { this.localStream?.getAudioTracks().forEach((t) => { t.enabled = on; }); this.onChange(); }

  async setCam(on) {
    if (!this.localStream) return;
    if (on && !this.hasCam) {
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 20 } } });
      const track = s.getVideoTracks()[0];
      this.localStream.addTrack(track);
      for (const p of this.peers.values()) p.pc.addTrack(track, this.localStream);
    } else this.localStream.getVideoTracks().forEach((t) => { t.enabled = on; });
    this.onChange();
  }

  streamFor(id) {
    if (id === this.myId) return this.localStream;
    return this.peers.get(id)?.stream || null;
  }

  ensureAudioCtx() {
    if (!this.audioCtx) {
      try { this.audioCtx = new AudioContext(); } catch { return null; }
    }
    if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
    return this.audioCtx;
  }

  // Lautstärke (0..1) für den "spricht gerade"-Indikator
  level(id) {
    const key = id === this.myId ? 'local' : id;
    const stream = this.streamFor(id);
    if (!stream || !stream.getAudioTracks().length || !this.audioCtx) return 0;
    let m = this.meters.get(key);
    if (!m || m.stream !== stream) {
      try {
        const src = this.audioCtx.createMediaStreamSource(stream);
        const an = this.audioCtx.createAnalyser();
        an.fftSize = 512;
        src.connect(an);
        m = { stream, an, buf: new Uint8Array(an.fftSize) };
        this.meters.set(key, m);
      } catch { return 0; }
    }
    m.an.getByteTimeDomainData(m.buf);
    let sum = 0;
    for (const v of m.buf) { const d = (v - 128) / 128; sum += d * d; }
    return Math.sqrt(sum / m.buf.length);
  }
}
