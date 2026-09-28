// three.js-Szene: Kamera, Karten-Objekte, Layout am Tisch, Animationen und Maus/Touch-Interaktion.
import * as THREE from 'three';
import { getCardTexture, setMaxAnisotropy } from './cardart.js';
import { buildPub } from './pub.js';

const CW = 1.0, CH = 1.5;
// relative Sitzposition: 0 = ich (unten), 1 = links, 2 = gegenüber, 3 = rechts (Spielrichtung im Uhrzeigersinn)
const DIRS = [[0, 1], [-1, 0], [0, -1], [1, 0]];
const RIGHT = DIRS.map(([dx, dz]) => [dz, -dx]);
const YAWS = [0, -Math.PI / 2, Math.PI, Math.PI / 2];
const HAND_DIST = 7;

function roundedCardGeometry() {
  const r = 0.07, w = CW, h = CH;
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

    this.cardGeo = roundedCardGeometry();
    this.backMat = new THREE.MeshStandardMaterial({ map: getCardTexture('back'), roughness: 0.6 });
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
    const frontMat = new THREE.MeshStandardMaterial({ roughness: 0.55, map: key ? getCardTexture(texKey(key)) : null, color: 0xffffff });
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
    obj.frontMat.map = getCardTexture(texKey(key));
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

  pileSlot(rel, i) {
    const [dx, dz] = DIRS[rel], [rx, rz] = RIGHT[rel];
    const j = hash(`p${rel}-${Math.floor(i / 4)}`) - 0.5;
    return this.flat(dx * 3.3 + rx * 3.3 + j * 0.12, 0.02 + i * 0.012, dz * 3.3 + rz * 3.3, YAWS[rel] + Math.PI / 2 + j * 0.3, false);
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
    _v.set(x, y, -HAND_DIST + i * 0.012);
    const pos = cam.localToWorld(_v.clone());
    _e.set(-0.08, 0, -t * 0.22 * Math.min(1, n / 8), 'XYZ');
    const quat = cam.quaternion.clone().multiply(_q.setFromEuler(_e));
    return { pos, quat, scale };
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
    let collected = false;
    for (const [id, obj] of [...this.trick]) {
      if (playIds.has(id)) continue;
      this.trick.delete(id);
      const lt = r.lastTrick;
      if (lt && lt.plays.some((p) => p.card === id)) {
        const pr = this.rel(lt.winner);
        obj.speed = 5;
        obj.wait = 0;
        this.piles[pr].push(obj);
        collected = true;
      } else this.removeObj(obj);
    }
    if (collected) this.cb.onEvent?.('collect');

    // 2) Karten im aktuellen Stich
    plays.forEach((p) => {
      if (this.trick.has(p.card)) return;
      let obj = this.hand.get(p.card);
      if (obj) {
        this.hand.delete(p.card);
        if (obj.proxy) { this.scene.remove(obj.proxy); obj.proxy = null; }
        obj.frontMat.color.set(0xffffff);
      } else {
        const rr = this.rel(p.seat);
        const back = this.opp[rr].pop();
        const spawn = back ? { pos: back.group.position.clone(), quat: back.group.quaternion.clone(), scale: back.group.scale.x } : this.seatSpot(p.seat);
        if (back) this.removeObj(back);
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
      if (obj.proxy) { this.scene.remove(obj.proxy); obj.proxy = null; }
      const dest = armutOther != null ? this.seatSpot(armutOther) : spawnDeal;
      this.setTarget(obj, { pos: dest.pos, quat: this.flat(0, 0, 0, 0, false).quat, scale: 0.8 }, 6);
      this.flying.push(obj);
    }
    handIds.forEach((id, i) => {
      if (this.hand.has(id)) return;
      const src = !fresh && armutOther != null ? this.seatSpot(armutOther) : spawnDeal;
      const obj = this.makeCard(id, src);
      obj.wait = fresh ? 0.25 + i * 0.06 : 0.1;
      obj.speed = 7;
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
      obj.frontMat.color.set(dim ? 0x6a6a6a : this.selected.has(id) ? 0xfff0c0 : 0xffffff);
      obj.frontMat.emissive.set(this.selected.has(id) ? 0x3a2a00 : 0x000000);
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

  updateHover() {
    const id = this.pick();
    if (id !== this.hovered) {
      this.hovered = id;
      this.renderer.domElement.style.cursor = id && (this.selectMode || (this.myTurn && this.playable.has(id))) ? 'pointer' : 'default';
      this.layoutHand();
    }
  }

  onPointerUp(e) {
    this.setPointer(e);
    const id = this.pick();
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

  seatAnchor(rel) {
    const anchors = [null, [-7.6, 2.4, -0.4], [0, 3.6, -7.4], [7.6, 2.4, -0.4]];
    const a = anchors[rel];
    if (!a) return null;
    _v.set(...a).project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: (_v.x * 0.5 + 0.5) * rect.width, y: (-_v.y * 0.5 + 0.5) * rect.height };
  }

  // ---------- Render-Schleife ----------
  frame() {
    const dt = Math.min(0.05, this.clock.getDelta());
    for (const obj of this.objs) {
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
    this.renderer.render(this.scene, this.camera);
    this.cb.onFrame?.();
  }
}
