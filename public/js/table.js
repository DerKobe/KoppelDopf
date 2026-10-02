// three.js-Szene: Kamera, Karten-Objekte, Layout am Tisch, Animationen und Maus/Touch-Interaktion.
import * as THREE from 'three';
import { getCardTexture, setMaxAnisotropy } from './cardart.js';
import { buildPub } from './pub.js';
import { Figures } from './figures.js';

const CW = 1.0, CH = 1.5;
// relative Sitzposition: 0 = ich (unten), 1 = links, 2 = gegenüber, 3 = rechts (Spielrichtung im Uhrzeigersinn)
const DIRS = [[0, 1], [-1, 0], [0, -1], [1, 0]];
const RIGHT = DIRS.map(([dx, dz]) => [dz, -dx]);
const YAWS = [0, -Math.PI / 2, Math.PI, Math.PI / 2];
const HAND_DIST = 7;

function roundedCardGeometry() {
  const r = 0.08, w = CW, h = CH; // Eckenradius wie bei den Kartenbildern
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2);
  s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r);
  s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  s.lineTo(-w / 2 + r, h / 2);
  s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  s.lineTo(-w / 2, -h / 2 + r);
  s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  const g = new THREE.ShapeGeometry(s, 6);
  const pos = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + w / 2) / w, (pos.getY(i) + h / 2) / h);
  return g;
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 1000) / 1000;
}

const texKey = (id) => id.slice(0, -1); // Karten-ID 'CQa' -> Motiv 'CQ'

// Karten leuchten aus ihrer eigenen Textur (farbtreu, am Tone-Mapping vorbei); die Szenenbeleuchtung trägt nur
// einen kleinen Anteil bei. Sonst wären Karten unter der hellen Tischlampe überstrahlt und in der Hand
// (außerhalb des Lichtkegels, fast senkrecht zum Licht) viel zu dunkel.
const CARD_GLOW = 0.82;
const CARD_LIT = 0.02;
const TINT = { normal: 0xffffff, dimmed: 0x9a9a9a, selected: 0xffe6b0 };
// Lambert = rein diffus: mattes Kartenpapier ohne Glanzlicht der Lampe (das würde die Farben in der Tischmitte ausbleichen)
function cardMaterial(map) {
  return new THREE.MeshLambertMaterial({
    map, emissiveMap: map, emissive: TINT.normal, emissiveIntensity: CARD_GLOW,
    color: new THREE.Color().setScalar(CARD_LIT), toneMapped: false,
  });
}
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class TableScene {
  constructor(container, callbacks = {}) {
    this.cb = callbacks;
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    setMaxAnisotropy(this.renderer.capabilities.getMaxAnisotropy());

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
    this.pub = buildPub(this.scene);
    this.figures = new Figures(this.scene);

    this.cardGeo = roundedCardGeometry();
    this.backMat = cardMaterial(getCardTexture('back'));
    this.proxyMat = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });
    this.proxyGeo = new THREE.PlaneGeometry(CW, CH + 0.5);

    this.objs = new Set();
    this.hand = new Map(); // id -> obj (eigene Hand)
    this.trick = new Map(); // id -> obj
    this.opp = [[], [], [], []]; // Rückseiten in fremden Händen (nach rel)
    this.piles = [[], [], [], []];
    this.flying = [];
    this.roundId = null;
    this.handOrder = [];
    this.hovered = null;
    this.selected = new Set();
    this.selectMode = false;
    this.playable = new Set();
    this.myTurn = false;
    this.base = 0;

    this.buildMarkers();

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2(-9, -9);
    const el = this.renderer.domElement;
    el.addEventListener('pointermove', (e) => { this.setPointer(e); if (e.pointerType !== 'touch') this.updateHover(); });
    el.addEventListener('pointerleave', () => { if (this.hovered) { this.hovered = null; this.layoutHand(); } });
    el.addEventListener('pointerup', (e) => this.onPointerUp(e));

    this.clock = new THREE.Clock();
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ---------- Kamera ----------
  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    const aspect = w / h;
    this.camera.aspect = aspect;
    this.camera.fov = aspect < 1 ? 50 : 45;
    // Querformat: schräger Blick wie am Tisch sitzend. Hochformat: steiler und so weit weg, dass der Tisch in die Breite passt.
    const target = new THREE.Vector3(0, -0.6, aspect < 1 ? 1.2 : 0.4);
    const land = new THREE.Vector3(0, 13.2, 10.4).normalize();
    const steep = new THREE.Vector3(0, 0.94, 0.34);
    const t = THREE.MathUtils.clamp((1.25 - aspect) / 0.7, 0, 1);
    const dir = land.lerp(steep, t).normalize();
    const tanH = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * aspect;
    const dist = Math.max(17.1, 6.9 / tanH);
    this.camera.position.copy(target).addScaledVector(dir, dist);
    this.pub.overhead.visible = this.camera.position.y < 13.8;
    this.camera.lookAt(target);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.layoutAll();
  }

  // ---------- Marker (am Zug / Geber) ----------
  buildMarkers() {
    const ringMat = new THREE.MeshBasicMaterial({ color: '#ffd27a', transparent: true, opacity: 0.6, depthWrite: false });
    this.turnRing = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.72, 40), ringMat);
    this.turnRing.rotation.x = -Math.PI / 2;
    this.turnRing.visible = false;
    this.scene.add(this.turnRing);
    const dotMat = new THREE.MeshBasicMaterial({ color: '#ffd27a', transparent: true, opacity: 0.9, depthWrite: false });
    this.turnDot = new THREE.Mesh(new THREE.CircleGeometry(0.2, 24), dotMat);
    this.turnDot.rotation.x = -Math.PI / 2;
    this.turnRing.add(this.turnDot);
    this.turnDot.rotation.x = 0;
    this.turnDot.position.z = 0.001;

    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#f2e6c8'; ctx.beginPath(); ctx.arc(64, 64, 62, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#8a1c1c'; ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(64, 64, 52, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#8a1c1c'; ctx.font = 'bold 64px Georgia, serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('G', 64, 68);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    this.dealerChip = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.12, 32),
      [new THREE.MeshStandardMaterial({ color: '#d8c79c' }), new THREE.MeshStandardMaterial({ map: t }), new THREE.MeshStandardMaterial({ color: '#d8c79c' })]);
    this.dealerChip.castShadow = true;
    this.dealerChip.visible = false;
    this.scene.add(this.dealerChip);
  }

  // ---------- Karten-Objekte ----------
  makeCard(key, spawn) {
    const group = new THREE.Group();
    const frontMat = cardMaterial(key ? getCardTexture(texKey(key)) : null);
    const front = new THREE.Mesh(this.cardGeo, key ? frontMat : this.backMat);
    front.position.z = 0.003;
    const back = new THREE.Mesh(this.cardGeo, this.backMat);
    back.rotation.y = Math.PI;
    back.position.z = -0.003;
    front.castShadow = back.castShadow = true;
    group.add(front, back);
    const obj = { group, front, frontMat, key, tPos: new THREE.Vector3(), tQuat: new THREE.Quaternion(), tScale: 1, wait: 0, speed: 9 };
    if (spawn) { group.position.copy(spawn.pos); group.quaternion.copy(spawn.quat); group.scale.setScalar(spawn.scale ?? 1); }
    this.scene.add(group);
    this.objs.add(obj);
    return obj;
  }

  setFace(obj, key) {
    if (obj.key === key) return;
    obj.key = key;
    obj.frontMat.map = obj.frontMat.emissiveMap = getCardTexture(texKey(key));
    obj.frontMat.needsUpdate = true;
    obj.front.material = obj.frontMat;
  }

  removeObj(obj) {
    this.scene.remove(obj.group);
    obj.frontMat.dispose();
    if (obj.proxy) this.scene.remove(obj.proxy);
    this.objs.delete(obj);
  }

  clearAll() {
    for (const o of [...this.objs]) this.removeObj(o);
    this.hand.clear(); this.trick.clear();
    this.opp = [[], [], [], []]; this.piles = [[], [], [], []];
    this.flying = [];
    this.hovered = null;
    this.selected.clear();
  }

  rel(seat) { return (seat - this.base + 4) % 4; }

  // ---------- Transformationen ----------
  flat(x, y, z, yaw, faceUp) {
    _e.set(faceUp ? -Math.PI / 2 : Math.PI / 2, yaw, 0, 'YXZ');
    return { pos: new THREE.Vector3(x, y, z), quat: new THREE.Quaternion().setFromEuler(_e), scale: 1 };
  }

  trickSlot(rel, order, id) {
    const [dx, dz] = DIRS[rel];
    const j = hash(id) - 0.5;
    return this.flat(dx * 0.95 + j * 0.15, 0.03 + order * 0.018, dz * 0.95 + j * 0.1, YAWS[rel] + j * 0.25, true);
  }

  // Stichhaufen liegt vor seinem Besitzer, leicht rechts (spiegelbildlich zum Geber-Chip links) – nicht in der Filzecke,
  // wo er zwischen zwei Spielern nicht zuzuordnen wäre.
  pileSlot(rel, i) {
    const [dx, dz] = DIRS[rel], [rx, rz] = RIGHT[rel];
    const j = hash(`p${rel}-${Math.floor(i / 4)}`) - 0.5;
    // eigener Stapel weiter rechts (Platz für Hinweis/Ansage-Knöpfe); im Hochformat rückt der linke Nachbar unter seine Plakette weg
    const portrait = this.camera.aspect < 1;
    const side = (rel === 0 ? 3.2 : rel === 1 && portrait ? 3.1 : 2.2) + j * 0.12;
    const front = rel === 0 && portrait ? 3.3 : 3.7; // Hochformat: eigener Stapel etwas höher, über der Aktionsleiste
    return this.flat(dx * front + rx * side, 0.02 + i * 0.012, dz * front + rz * side, YAWS[rel] + Math.PI / 2 + j * 0.3, false);
  }

  oppSlot(rel, i, n) {
    const [dx, dz] = DIRS[rel];
    const spread = 0.085, R = 2.4;
    const a = (i - (n - 1) / 2) * spread;
    const yaw = Math.atan2(dx, dz);
    _e.set(0.35, yaw, -a, 'YXZ');
    const quat = new THREE.Quaternion().setFromEuler(_e);
    _v.set(Math.sin(a) * R, Math.cos(a) * R - R, -i * 0.006).applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.35, yaw, 0, 'YXZ')));
    const pos = new THREE.Vector3(dx * 5.4, 1.4, dz * 5.4).add(_v);
    return { pos, quat, scale: 0.8 };
  }

  dealerSpot() {
    const r = this.rel(this.dealer ?? 0);
    const [dx, dz] = DIRS[r];
    return this.flat(dx * 3.2, 0.3, dz * 3.2, YAWS[r], false);
  }

  seatSpot(seat) {
    const r = this.rel(seat);
    if (r === 0 && this.mySeat != null) return this.handSlot(Math.floor(this.handOrder.length / 2), Math.max(1, this.handOrder.length), false);
    const [dx, dz] = DIRS[r];
    return { pos: new THREE.Vector3(dx * 5.4, 1.4, dz * 5.4), quat: this.flat(0, 0, 0, YAWS[r], false).quat, scale: 0.8 };
  }

  handSlot(i, n, raised) {
    const { local, quat, scale } = this.handSlotLocal(i, n, raised);
    return { pos: this.camera.localToWorld(local), quat: this.camera.quaternion.clone().multiply(quat), scale };
  }

  // Position/Drehung eines Handplatzes im Kamera-Koordinatensystem
  handSlotLocal(i, n, raised) {
    const cam = this.camera;
    const halfH = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * HAND_DIST;
    const halfW = halfH * cam.aspect;
    const maxW = halfW * 2 * (cam.aspect > 1.3 ? 0.74 : 0.94); // breite Bildschirme: Platz für die eigene Plakette
    let scale = Math.min(1.15, (halfH * 2 * 0.27) / CH);
    let spacing = Math.min(0.74 * scale, (maxW - CW * scale) / Math.max(1, n - 1));
    if (spacing < 0.3 * scale) { scale = Math.max(0.6, scale * 0.85); spacing = Math.min(0.74 * scale, (maxW - CW * scale) / Math.max(1, n - 1)); }
    const t = n > 1 ? i / (n - 1) - 0.5 : 0;
    const x = (i - (n - 1) / 2) * spacing;
    let y = -halfH + CH * scale * 0.47 - t * t * 0.5 * scale;
    if (raised) y += 0.42 * scale;
    const local = new THREE.Vector3(x, y, -HAND_DIST + i * 0.012);
    _e.set(-0.08, 0, -t * 0.22 * Math.min(1, n / 8), 'XYZ');
    const quat = new THREE.Quaternion().setFromEuler(_e);
    return { local, quat, scale, height: CH * scale };
  }

  // Karte in die eigene Hand fliegen lassen, ohne durch andere Karten zu clippen:
  // 1) vom Tisch zu einem Punkt über ihrem Handplatz, genau in ihrer Endtiefe; die Drehung ist schon vorher fertig.
  // 2) parallel zu den Nachbarn senkrecht nach unten auf den Platz rutschen (parallele Ebenen schneiden sich nie).
  // Ausgeteilt wird von rechts nach links: jede neue Karte liegt hinter den schon liegenden rechts von ihr.
  animateToHand(obj, id, delay) {
    const cam = this.camera;
    const p0 = cam.worldToLocal(obj.group.position.clone());
    const q0 = obj.group.quaternion.clone();
    const s0 = obj.group.scale.x;
    const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
    const easeOut = (x) => 1 - (1 - x) ** 3;
    const p = new THREE.Vector3(), q = new THREE.Quaternion();
    obj.wait = 0;
    obj.anim = {
      t: -delay,
      dur: 0.8,
      apply: (t) => {
        const n = Math.max(1, this.handOrder.length);
        const i = Math.max(0, this.handOrder.indexOf(id));
        const slot = this.handSlotLocal(i, n, false);
        const slotQ = cam.quaternion.clone().multiply(slot.quat);
        // entlang der eigenen (leicht gekippten und gefächerten) Kartenachse versetzt – so bleibt Phase 2 exakt in der Endebene
        const above = slot.local.clone().add(new THREE.Vector3(0, slot.height * 1.4, 0).applyQuaternion(slot.quat));
        const g = obj.group;
        if (t < 0.6) {
          const e = ease(t / 0.6);
          p.lerpVectors(p0, above, e);
          q.slerpQuaternions(q0, slotQ, Math.min(1, e / 0.7));
          g.scale.setScalar(s0 + (slot.scale - s0) * e);
        } else {
          const e = easeOut((t - 0.6) / 0.4);
          p.lerpVectors(above, slot.local, e);
          q.copy(slotQ);
          g.scale.setScalar(slot.scale);
        }
        g.position.copy(cam.localToWorld(p));
        g.quaternion.copy(q);
      },
    };
  }

  setTarget(obj, tr, speed) {
    obj.tPos.copy(tr.pos);
    obj.tQuat.copy(tr.quat);
    obj.tScale = tr.scale ?? 1;
    if (speed) obj.speed = speed;
  }

  // ---------- Zustand übernehmen ----------
  setState(view) {
    const r = view.round;
    this.mySeat = view.mySeat;
    const newBase = view.mySeat ?? 0;
    if (newBase !== this.base) { this.base = newBase; }
    if (!r) {
      if (this.roundId !== null) this.clearAll();
      this.roundId = null;
      this.turnRing.visible = false;
      this.dealerChip.visible = false;
      return;
    }
    this.dealer = r.dealer;
    const fresh = r.id !== this.roundId;
    if (fresh) { this.clearAll(); this.roundId = r.id; this.cb.onEvent?.('deal'); }
    const spawnDeal = this.dealerSpot();

    // 1) Stich eingesammelt?
    const plays = r.trick ? r.trick.plays : [];
    this._plays = plays;
    const playIds = new Set(plays.map((p) => p.card));
    const collecting = [];
    for (const [id, obj] of [...this.trick]) {
      if (playIds.has(id)) continue;
      this.trick.delete(id);
      const lt = r.lastTrick;
      if (lt && lt.plays.some((p) => p.card === id)) collecting.push(obj);
      else this.removeObj(obj);
    }
    if (collecting.length) {
      this.animateCollect(collecting, this.rel(r.lastTrick.winner));
      this.cb.onEvent?.('collect');
    }

    // 2) Karten im aktuellen Stich
    plays.forEach((p) => {
      if (this.trick.has(p.card)) return;
      let obj = this.hand.get(p.card);
      if (obj) {
        this.hand.delete(p.card);
        obj.anim = null;
        if (obj.proxy) { this.scene.remove(obj.proxy); obj.proxy = null; }
        obj.frontMat.emissive.set(TINT.normal);
      } else {
        const rr = this.rel(p.seat);
        const back = this.opp[rr].pop();
        const spawn = back ? { pos: back.group.position.clone(), quat: back.group.quaternion.clone(), scale: back.group.scale.x } : this.seatSpot(p.seat);
        if (back) this.removeObj(back);
        if (!fresh) this.figures.reach(rr);
        obj = this.makeCard(p.card, spawn);
      }
      this.setFace(obj, p.card);
      obj.speed = 8;
      this.trick.set(p.card, obj);
      if (!fresh) this.cb.onEvent?.('play');
    });

    // 3) Eigene Hand
    const handIds = r.hand || [];
    const inHand = new Set(handIds);
    const armutOther = r.armut ? (this.mySeat === r.armut.poor ? r.armut.rich : r.armut.poor) : null;
    for (const [id, obj] of [...this.hand]) {
      if (inHand.has(id)) continue;
      this.hand.delete(id);
      obj.anim = null;
      if (obj.proxy) { this.scene.remove(obj.proxy); obj.proxy = null; }
      const dest = armutOther != null ? this.seatSpot(armutOther) : spawnDeal;
      this.setTarget(obj, { pos: dest.pos, quat: this.flat(0, 0, 0, 0, false).quat, scale: 0.8 }, 6);
      this.flying.push(obj);
    }
    // Neue Karten starten als kleiner Stapel (nicht deckungsgleich ineinander); die oberste = rechteste fliegt zuerst.
    const newIds = handIds.filter((id) => !this.hand.has(id));
    const base = !fresh && armutOther != null ? this.seatSpot(armutOther) : spawnDeal;
    const stackNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(base.quat).negate(); // Rückseite zeigt nach oben
    newIds.forEach((id, idx) => {
      const k = newIds.length - 1 - idx; // Abflug-Reihenfolge: 0 = ganz rechts
      const src = { pos: base.pos.clone().addScaledVector(stackNormal, (newIds.length - 1 - k) * 0.012), quat: base.quat, scale: base.scale };
      const obj = this.makeCard(id, src);
      obj.speed = 7;
      this.animateToHand(obj, id, fresh ? 0.25 + k * 0.07 : 0.1 + k * 0.12);
      const proxy = new THREE.Mesh(this.proxyGeo, this.proxyMat);
      proxy.userData.id = id;
      this.scene.add(proxy);
      obj.proxy = proxy;
      this.hand.set(id, obj);
    });
    this.handOrder = handIds.slice();
    if (this.hovered && !this.hand.has(this.hovered)) this.hovered = null;
    for (const id of [...this.selected]) if (!this.hand.has(id)) this.selected.delete(id);

    // 4) Fremde Hände (Rückseiten)
    for (let seat = 0; seat < 4; seat++) {
      const rr = this.rel(seat);
      if (rr === 0 && this.mySeat != null) continue;
      const want = r.handCounts[seat];
      const arr = this.opp[rr];
      while (arr.length < want) {
        const o = this.makeCard(null, spawnDeal);
        o.wait = fresh ? 0.25 + arr.length * 0.06 + rr * 0.02 : 0.05;
        o.speed = 7;
        arr.push(o);
      }
      while (arr.length > want) {
        const o = arr.pop();
        this.setTarget(o, this.seatSpot(seat), 6);
        this.flying.push(o);
      }
    }

    // 5) Stichhaufen (z.B. nach Reconnect)
    for (let seat = 0; seat < 4; seat++) {
      const rr = this.rel(seat);
      const want = (r.tricksWon[seat] || 0) * 4;
      const arr = this.piles[rr];
      while (arr.length < want) {
        const o = this.makeCard(null, this.pileSlot(rr, arr.length));
        arr.push(o);
      }
    }

    // 6) Interaktion + Marker
    this.playable = new Set(r.playable || []);
    this.myTurn = r.phase === 'playing' && r.turn === this.mySeat && this.mySeat != null && (r.trick?.plays.length ?? 0) < 4;
    this.selectMode = this.cb.getSelectMode?.() || false;
    if (!this.selectMode) this.selected.clear();
    // Stapel mit dem letzten Stich ist anklickbar (öffnet die Ansicht „Letzter Stich“)
    this.lastTrickRel = r.lastTrick && (r.phase === 'playing' || r.phase === 'done') ? this.rel(r.lastTrick.winner) : null;
    this.turn = r.phase === 'playing' || r.phase === 'reservation' || r.phase.startsWith('armut') ? r.turn : null;
    this.layoutAll();
  }

  layoutAll() {
    if (!this.roundId && !this.objs.size) { this.turnRing.visible = false; return; }
    this.layoutHand();
    [...this.trick.values()].forEach((obj, k) => {
      const seat = this.trickSeat(obj.key);
      this.setTarget(obj, this.trickSlot(this.rel(seat), k, obj.key));
    });
    for (let rr = 0; rr < 4; rr++) {
      const arr = this.opp[rr];
      arr.forEach((o, i) => this.setTarget(o, this.oppSlot(rr, i, arr.length)));
      this.piles[rr].forEach((o, i) => this.setTarget(o, this.pileSlot(rr, i)));
    }
    if (this.turn != null) {
      const [dx, dz] = DIRS[this.rel(this.turn)];
      this.turnRing.position.set(dx * 2.3, 0.012, dz * 2.3);
      this.turnRing.visible = true;
    } else this.turnRing.visible = false;
    if (this.dealer != null && this.roundId != null) {
      const rr = this.rel(this.dealer);
      const [dx, dz] = DIRS[rr], [rx, rz] = RIGHT[rr];
      this.dealerChip.position.set(dx * 3.9 - rx * 2.0, 0.07, dz * 3.9 - rz * 2.0);
      this.dealerChip.visible = true;
    }
  }

  trickSeat(id) {
    return this._plays?.find((p) => p.card === id)?.seat ?? 0;
  }

  layoutHand() {
    const n = this.handOrder.length;
    this.handOrder.forEach((id, i) => {
      const obj = this.hand.get(id);
      if (!obj) return;
      const raised = this.selected.has(id) || (this.hovered === id && (this.selectMode || this.myTurn));
      this.setTarget(obj, this.handSlot(i, n, raised));
      const base = this.handSlot(i, n, false);
      obj.proxy.position.copy(base.pos);
      obj.proxy.quaternion.copy(base.quat);
      obj.proxy.scale.setScalar(base.scale);
      obj.proxy.translateY(0.25);
      obj.proxy.updateMatrixWorld();
      const dim = this.myTurn && !this.playable.has(id) && !this.selectMode;
      obj.frontMat.emissive.set(dim ? TINT.dimmed : this.selected.has(id) ? TINT.selected : TINT.normal);
    });
  }

  // ---------- Interaktion ----------
  setPointer(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  }

  pick() {
    const proxies = [...this.hand.values()].map((o) => o.proxy).filter(Boolean);
    if (!proxies.length) return null;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(proxies, false);
    return hits.length ? hits[0].object.userData.id : null;
  }

  // Trifft der Zeiger den Stichhaufen mit dem letzten Stich?
  pickLastTrickPile() {
    const pile = this.lastTrickRel != null ? this.piles[this.lastTrickRel] : null;
    if (!pile?.length) return false;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.intersectObjects(pile.map((o) => o.group), true).length > 0;
  }

  updateHover() {
    const id = this.pick();
    const onPile = !id && this.pickLastTrickPile();
    this.renderer.domElement.style.cursor = onPile || (id && (this.selectMode || (this.myTurn && this.playable.has(id)))) ? 'pointer' : 'default';
    if (id !== this.hovered) {
      this.hovered = id;
      this.layoutHand();
    }
  }

  onPointerUp(e) {
    this.setPointer(e);
    const id = this.pick();
    if (!id && this.pickLastTrickPile()) { this.cb.onLastTrick?.(); return; }
    if (!id) { if (e.pointerType === 'touch' && this.hovered) { this.hovered = null; this.layoutHand(); } return; }
    if (e.pointerType === 'touch' && this.hovered !== id && !this.selectMode) {
      // Touch: erstes Antippen hebt die Karte an, zweites spielt sie
      this.hovered = id;
      this.layoutHand();
      return;
    }
    if (this.selectMode) {
      if (this.selected.has(id)) this.selected.delete(id);
      else this.selected.add(id);
      this.layoutHand();
      this.cb.onSelectionChange?.([...this.selected]);
      return;
    }
    if (this.myTurn && this.playable.has(id)) this.cb.onPlay?.(id);
    else if (this.myTurn) this.cb.onIllegal?.(id);
  }

  setSelection(ids) { this.selected = new Set(ids); this.layoutHand(); }

  // true, solange noch Karten in die eigene Hand fliegen (Austeilen, Armut)
  isDealing() {
    for (const o of this.hand.values()) if (o.anim) return true;
    return false;
  }

  // Für die Figuren: wo ihr Kartenfächer ist (Mitte + Aufwärtsrichtung wie in oppSlot), wohin sie schauen, ob sie dran sind
  figureContext(rel) {
    const [dx, dz] = DIRS[rel];
    const n = this.opp[rel].length;
    // Griffpunkte seitlich neben dem Fächer: an der unteren Außenkante der äußersten Karte, eine Handbreite
    // daneben und knapp hinter der Kartenebene – so greifen die Hände den Fächer, ohne durch Karten zu stechen.
    // Geometrie wie in oppSlot (Fächer um einen Drehpunkt R unterhalb, Karten 0.8 × 1.2 groß).
    let hold = null;
    if (n) {
      const spread = 0.085, R = 2.4, halfW = CW * 0.4;
      const frame = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.35, Math.atan2(dx, dz), 0, 'YXZ'));
      const base = new THREE.Vector3(dx * 5.4, 1.4, dz * 5.4);
      hold = [-1, 1].map((side) => {
        const i = side < 0 ? 0 : n - 1;
        const a = (i - (n - 1) / 2) * spread;
        const ca = Math.cos(a), sa = Math.sin(a);
        const lx = side * (halfW + 0.3), ly = -0.3; // Punkt im Kartensystem (um -a gedreht, wie die Karte selbst)
        const p = new THREE.Vector3(Math.sin(a) * R + lx * ca + ly * sa, Math.cos(a) * R - R - lx * sa + ly * ca, 0.08);
        return p.applyQuaternion(frame).add(base);
      });
    }
    const turnRel = this.turn != null ? this.rel(this.turn) : null;
    const look = turnRel != null && turnRel !== rel ? new THREE.Vector3(DIRS[turnRel][0] * 5, 1, DIRS[turnRel][1] * 5) : new THREE.Vector3(0, 0, 0);
    return { hold, look, myTurn: turnRel === rel };
  }

  seatAnchor(rel) {
    const anchors = [null, [-7.6, 2.4, -0.4], [0, 3.6, -7.4], [7.6, 2.4, -0.4]];
    const a = anchors[rel];
    if (!a) return null;
    return this.toScreen(...a);
  }

  // Bildschirmposition (CSS-Pixel) eines Punkts in der Szene
  toScreen(x, y, z) {
    _v.set(x, y, z).project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: (_v.x * 0.5 + 0.5) * rect.width, y: (-_v.y * 0.5 + 0.5) * rect.height };
  }

  // ---------- Render-Schleife ----------
  // Stich einsammeln ohne dass sich Karten durchdringen:
  // 1) flach (in Legereihenfolge übereinander) vor dem Gewinner zusammenschieben,
  // 2) den Stapel als starren Block anheben, umdrehen und verdeckt auf den Stichhaufen legen.
  animateCollect(objs, rel) {
    const pile = this.piles[rel];
    const base = pile.length;
    const n = objs.length;
    // die oberste offene Karte liegt nach dem Umdrehen ganz unten
    for (let k = n - 1; k >= 0; k--) pile.push(objs[k]);
    const [dx, dz] = DIRS[rel];
    const gather = new THREE.Vector3(dx * 0.7, 0.04, dz * 0.7);
    const qUp = this.flat(0, 0, 0, YAWS[rel], true).quat;
    const top = this.pileSlot(rel, base + n - 1);
    const GAP0 = 0.03, GAP1 = 0.012;
    const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
    const P = new THREE.Vector3(), Q = new THREE.Quaternion(), off = new THREE.Vector3();
    objs.forEach((o, k) => {
      const p0 = o.group.position.clone(), q0 = o.group.quaternion.clone(), s0 = o.group.scale.x;
      const stackPos = gather.clone().setY(gather.y + k * GAP0);
      o.wait = 0;
      o.anim = {
        t: 0,
        dur: 1.05,
        apply: (t) => {
          const g = o.group;
          if (t < 0.3) {
            const e = ease(t / 0.3);
            g.position.lerpVectors(p0, stackPos, e);
            g.quaternion.slerpQuaternions(q0, qUp, e);
            g.scale.setScalar(s0 + (1 - s0) * e);
          } else if (t < 0.4) {
            g.position.copy(stackPos);
            g.quaternion.copy(qUp);
            g.scale.setScalar(1);
          } else {
            const e = ease((t - 0.4) / 0.6);
            P.lerpVectors(gather, top.pos, e);
            P.y += Math.sin(Math.PI * e) * 1.3;
            const rot = THREE.MathUtils.smoothstep(e, 0.1, 0.9);
            Q.slerpQuaternions(qUp, top.quat, rot);
            off.set(0, 0, k * (GAP0 + (GAP1 - GAP0) * e)).applyQuaternion(Q);
            g.position.copy(P).add(off);
            g.quaternion.copy(Q);
            g.scale.setScalar(1);
          }
        },
      };
    });
  }

  frame() {
    const dt = Math.min(0.05, this.clock.getDelta());
    for (const obj of this.objs) {
      if (obj.anim) {
        const a = obj.anim;
        a.t = Math.min(a.dur, a.t + dt);
        if (a.t < 0) continue; // Verzögerung: Karte wartet noch am Startpunkt
        a.apply(a.t / a.dur);
        if (a.t >= a.dur) {
          obj.anim = null;
          if (obj.proxy) continue; // Handkarte: Ziel kommt weiterhin aus layoutHand (z.B. Anheben beim Hovern)
          obj.tPos.copy(obj.group.position);
          obj.tQuat.copy(obj.group.quaternion);
          obj.tScale = obj.group.scale.x;
        }
        continue;
      }
      if (obj.wait > 0) { obj.wait -= dt; continue; }
      const k = 1 - Math.exp(-dt * obj.speed);
      obj.group.position.lerp(obj.tPos, k);
      obj.group.quaternion.slerp(obj.tQuat, k);
      const s = obj.group.scale.x + (obj.tScale - obj.group.scale.x) * k;
      obj.group.scale.setScalar(s);
    }
    this.flying = this.flying.filter((o) => {
      if (o.wait <= 0 && o.group.position.distanceTo(o.tPos) < 0.15) { this.removeObj(o); return false; }
      return true;
    });
    if (this.turnRing.visible) {
      const t = performance.now() / 1000;
      this.turnRing.material.opacity = 0.35 + 0.3 * (0.5 + 0.5 * Math.sin(t * 4));
      this.turnRing.scale.setScalar(1 + 0.06 * Math.sin(t * 4));
    }
    this.pub.update(dt);
    this.figures.update(dt, (rel) => this.figureContext(rel));
    this.renderer.render(this.scene, this.camera);
    const dealing = this.isDealing();
    if (this.wasDealing && !dealing) this.cb.onDealDone?.();
    this.wasDealing = dealing;
    this.cb.onFrame?.();
  }
}
