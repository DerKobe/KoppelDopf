// Stammtischbrüder und -schwestern: einfache Figuren auf den Stühlen der Mitspieler (experimentell).
// Aufbau aus Grundformen; die Arme werden per Zwei-Gelenk-IK an den Kartenfächer geführt, den table.js für jeden
// Platz anordnet. Lokales Figuren-Koordinatensystem: Blick zur Tischmitte = -z, Sitzfläche bei y = -2.75.
import * as THREE from 'three';

const CHAIR_R = 8.2; // Abstand der Stühle von der Tischmitte (wie in pub.js)
const UPPER = 2.0, FORE = 1.95; // Ober-/Unterarm
const SKINS = ['#f1c9a5', '#e3b08a', '#c98f66', '#a8714b', '#f6d9c2', '#8c5a3c'];
const SHIRTS = ['#7a2e2e', '#2f4d6b', '#3d5a3a', '#6b5a2f', '#55406b', '#8a6a3a', '#2f5f5c', '#704050', '#5b6470'];
const HAIRS = ['#2b1d14', '#5a3a22', '#8a6440', '#b9b2a6', '#ddd6cb', '#3b2a1e', '#9a4f2a'];
const PANTS = ['#2a2a30', '#3a3024', '#24303e', '#3b3b3b'];

function seeded(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  let s = (h >>> 0) % 2147483646 + 1;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}
const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];
const mat = (color, roughness = 0.85) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });

const _y = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();

// Zylinder zwischen zwei Punkten (Geometrie hat Länge 1 entlang y)
function placeLimb(mesh, from, to) {
  _a.subVectors(to, from);
  const len = _a.length();
  mesh.position.addVectors(from, to).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(_y, _a.divideScalar(len || 1));
  mesh.scale.set(1, len, 1);
}

// Zwei-Gelenk-IK: Ellbogen zwischen Schulter s und Hand h, zur Seite von pole hin gebeugt. Gibt die (ggf. auf
// Armlänge gekürzte) Hand zurück.
function solveArm(s, h, pole, elbowOut, handOut) {
  _b.subVectors(h, s);
  let d = _b.length();
  const max = UPPER + FORE - 0.02, min = Math.abs(UPPER - FORE) + 0.05;
  _b.divideScalar(d || 1);
  d = THREE.MathUtils.clamp(d, min, max);
  handOut.copy(s).addScaledVector(_b, d);
  const x = (UPPER * UPPER - FORE * FORE + d * d) / (2 * d);
  const hgt = Math.sqrt(Math.max(0, UPPER * UPPER - x * x));
  _c.copy(pole).addScaledVector(_b, -pole.dot(_b)).normalize();
  elbowOut.copy(s).addScaledVector(_b, x).addScaledVector(_c, hgt);
}

class Figure {
  constructor(key, female) {
    const rnd = seeded(`${key}|${female ? 'f' : 'm'}`);
    this.phase = rnd() * 10;
    this.blinkIn = 1 + rnd() * 3;
    const skin = mat(pick(rnd, SKINS), 0.7);
    const shirt = mat(pick(rnd, SHIRTS));
    const pants = mat(pick(rnd, PANTS));
    const hairMat = mat(pick(rnd, HAIRS), 0.9);
    const dark = mat('#1d140e', 0.5);
    const root = this.root = new THREE.Group();
    const add = (parent, geo, m, x = 0, y = 0, z = 0, shadow = true) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = shadow;
      parent.add(mesh);
      return mesh;
    };

    // Beine (größtenteils unter dem Tisch)
    const thighGeo = new THREE.CylinderGeometry(0.55, 0.62, 1, 12);
    const shinGeo = new THREE.CylinderGeometry(0.42, 0.5, 1, 12);
    for (const sx of [-1, 1]) {
      const hip = new THREE.Vector3(sx * 0.8, -2.25, 0.3), knee = new THREE.Vector3(sx * 0.9, -2.2, -3.0);
      const ankle = new THREE.Vector3(sx * 0.95, -6.9, -3.2);
      placeLimb(add(root, thighGeo, pants), hip, knee);
      placeLimb(add(root, shinGeo, pants), knee, ankle);
      add(root, new THREE.SphereGeometry(0.58, 12, 10), pants, knee.x, knee.y, knee.z);
      const shoe = add(root, new THREE.BoxGeometry(0.85, 0.5, 1.6), dark, ankle.x, -7.25, ankle.z - 0.35);
      shoe.castShadow = false;
    }
    const pelvis = add(root, new THREE.SphereGeometry(1.35, 16, 12), pants, 0, -2.1, 0.45);
    pelvis.scale.set(1.25, 0.72, 1.05);

    // Oberkörper an einer Wirbelsäule (zum Vorbeugen/Atmen)
    const build = 0.92 + rnd() * 0.24;
    const spine = this.spine = new THREE.Group();
    spine.position.set(0, -2.0, 0.45);
    root.add(spine);
    const torso = this.torso = add(spine, new THREE.CapsuleGeometry(1.2, 2.4, 6, 16), shirt, 0, 2.3, 0);
    torso.scale.set(1.3 * build, 1, 0.82);
    if (!female && rnd() < 0.45) { // Bierbauch
      const belly = add(spine, new THREE.SphereGeometry(1.15, 16, 12), shirt, 0, 1.35, -0.55);
      belly.scale.set(1.25 * build, 1, 0.95);
    }
    if (rnd() < 0.35) { // Weste/Strickjacke
      const vest = add(spine, new THREE.CapsuleGeometry(1.24, 2.0, 6, 16, 1), mat(pick(rnd, SHIRTS)), 0, 2.1, 0.02);
      vest.scale.set(1.3 * build + 0.02, 1, 0.84);
    }
    this.shoulders = [-1, 1].map((sx) => {
      const p = new THREE.Vector3(sx * 1.55 * build, 4.15, 0);
      add(spine, new THREE.SphereGeometry(0.5, 12, 10), shirt, p.x, p.y, p.z);
      return p;
    });
    add(spine, new THREE.CylinderGeometry(0.42, 0.48, 1, 12), skin, 0, 4.8, 0);

    // Kopf
    const head = this.head = new THREE.Group();
    head.position.set(0, 5.85, 0);
    spine.add(head);
    const skull = add(head, new THREE.SphereGeometry(1.05, 20, 16), skin);
    skull.scale.set(0.9, 1.08, 0.96);
    add(head, new THREE.SphereGeometry(0.17, 10, 8), skin, 0, -0.12, -1.0);
    for (const sx of [-1, 1]) add(head, new THREE.SphereGeometry(0.2, 8, 6), skin, sx * 0.93, 0, 0.05, false);
    this.eyes = [-1, 1].map((sx) => add(head, new THREE.SphereGeometry(0.1, 8, 6), dark, sx * 0.34, 0.16, -0.9, false));
    const mouth = add(head, new THREE.BoxGeometry(0.36, 0.07, 0.08), mat('#7a3b33', 0.6), 0, -0.48, -0.9, false);
    mouth.rotation.x = -0.25;
    const brow = add(head, new THREE.BoxGeometry(1.0, 0.09, 0.1), hairMat, 0, 0.42, -0.9, false);
    brow.rotation.x = 0.2;

    const cap = (r, thetaLen, sy = 1) => {
      const m = add(head, new THREE.SphereGeometry(r, 20, 12, 0, Math.PI * 2, 0, thetaLen), hairMat);
      m.scale.set(0.95, sy, 1);
      return m;
    };
    if (female) {
      const style = pick(rnd, ['bob', 'dutt', 'lang']);
      const top = cap(1.12, Math.PI * 0.5, 1.08);
      top.rotation.x = 0.45; // Stirn frei, Hinterkopf bedeckt
      if (style === 'dutt') add(head, new THREE.SphereGeometry(0.5, 12, 10), hairMat, 0, 0.75, 0.75);
      else {
        const back = add(head, new THREE.CapsuleGeometry(0.95, style === 'lang' ? 1.6 : 0.5, 6, 14), hairMat, 0, style === 'lang' ? -0.9 : -0.35, 0.35);
        back.scale.set(1.08, 1, 0.75);
      }
      if (rnd() < 0.5) for (const sx of [-1, 1]) add(head, new THREE.SphereGeometry(0.09, 8, 6), mat('#d8b24a', 0.3), sx * 0.95, -0.35, 0.05, false);
    } else {
      const style = pick(rnd, ['kurz', 'kurz', 'glatze', 'muetze']);
      if (style === 'glatze') {
        const fringe = add(head, new THREE.TorusGeometry(0.9, 0.18, 8, 20, Math.PI * 1.2), hairMat, 0, -0.05, 0.1);
        fringe.rotation.set(Math.PI / 2, 0, Math.PI * -0.1); // Haarkranz um den Hinterkopf
      } else {
        const top = cap(1.1, Math.PI * 0.42, 1.06);
        top.rotation.x = 0.2;
      }
      if (style === 'muetze') { // Schiebermütze
        const m = mat(pick(rnd, ['#4a4036', '#38404a', '#5a4a3a']), 0.95);
        const crown = add(head, new THREE.CylinderGeometry(1.12, 1.08, 0.5, 20), m, 0, 0.92, 0.05);
        crown.rotation.x = -0.12;
        const brim = add(head, new THREE.BoxGeometry(1.3, 0.08, 0.7), m, 0, 0.72, -1.05);
        brim.rotation.x = 0.15;
      }
      if (rnd() < 0.45) add(head, new THREE.BoxGeometry(0.62, 0.14, 0.18), hairMat, 0, -0.38, -0.95, false); // Schnauzer
      if (rnd() < 0.2) { const beard = add(head, new THREE.SphereGeometry(0.75, 14, 10, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5), hairMat, 0, -0.35, -0.3); beard.scale.set(1.1, 1, 1.1); }
    }
    if (rnd() < 0.3) { // Brille
      const frame = mat('#222', 0.4);
      for (const sx of [-1, 1]) add(head, new THREE.TorusGeometry(0.22, 0.04, 6, 16), frame, sx * 0.36, 0.14, -0.98, false);
      add(head, new THREE.BoxGeometry(0.3, 0.04, 0.04), frame, 0, 0.17, -1.0, false);
    }

    // Arme: Segmente liegen direkt im Figuren-Wurzelobjekt und werden jedes Bild neu ausgerichtet
    this.arms = [-1, 1].map(() => ({
      upper: add(root, new THREE.CylinderGeometry(0.4, 0.48, 1, 12), shirt),
      fore: add(root, new THREE.CylinderGeometry(0.33, 0.4, 1, 12), shirt),
      elbow: add(root, new THREE.SphereGeometry(0.43, 12, 10), shirt),
      hand: (() => { const h = add(root, new THREE.SphereGeometry(0.32, 12, 10), skin); h.scale.set(0.7, 1, 1.3); return h; })(),
      target: new THREE.Vector3(), cur: new THREE.Vector3(), init: false,
    }));
    this.lean = 0;
    this.look = { yaw: 0, pitch: 0.2 };
    this.reachT = -1;
  }

  // hold: Griffpunkte [links, rechts] neben dem Fächer in lokalen Koordinaten oder null (Hände ruhen auf dem Tisch)
  update(dt, t, { hold, look, myTurn }) {
    const ph = this.phase;
    // Atmen + leichtes Schwanken; wer dran ist, beugt sich etwas über seine Karten
    const reach = this.reachT >= 0 ? Math.sin(Math.PI * Math.min(1, this.reachT / 0.75)) : 0;
    if (this.reachT >= 0) { this.reachT += dt; if (this.reachT > 0.75) this.reachT = -1; }
    const wantLean = 0.14 + (myTurn ? 0.08 : 0) + reach * 0.16;
    this.lean += (wantLean - this.lean) * Math.min(1, dt * 4);
    this.spine.rotation.x = -this.lean;
    this.spine.rotation.z = Math.sin(t * 0.45 + ph) * 0.025;
    this.torso.scale.y = 1 + Math.sin(t * 1.7 + ph) * 0.015;

    // Kopf: zur Tischmitte bzw. zu dem, der dran ist; am eigenen Zug auf die Karten
    const yaw = myTurn ? Math.sin(t * 0.6 + ph) * 0.08 : THREE.MathUtils.clamp(Math.atan2(-look.x, -look.z), -0.9, 0.9);
    const pitch = myTurn ? 0.5 : 0.22 + Math.sin(t * 0.35 + ph) * 0.04;
    const k = Math.min(1, dt * 3);
    this.look.yaw += (yaw - this.look.yaw) * k;
    this.look.pitch += (pitch - this.look.pitch) * k;
    this.head.rotation.set(this.look.pitch - this.lean * 0.6, this.look.yaw, 0, 'YXZ');
    this.blinkIn -= dt;
    const blink = this.blinkIn < 0;
    if (this.blinkIn < -0.12) this.blinkIn = 2 + ((ph * 7.3 + t) % 3);
    for (const e of this.eyes) e.scale.y = blink ? 0.15 : 1;

    // Arme
    this.spine.updateMatrix();
    this.arms.forEach((arm, i) => {
      const sx = i === 0 ? -1 : 1;
      if (hold) {
        arm.target.copy(hold[i]); // Hände greifen den Fächer seitlich
      } else arm.target.set(sx * 1.1, 0.28, -3.1); // Hände ruhen auf der Tischkante
      const r = sx === 1 ? reach : 0;
      // Ausspielen: die rechte Hand fährt außen am Fächer vorbei nach vorn und bleibt flach über dem Tisch –
      // so kreuzt der Unterarm die Karten nicht (der Fächer endet unten über Handhöhe).
      if (r > 0) arm.target.lerp(_d.set(Math.max(arm.target.x, 1.4) + 0.25, 0.5, -4.6), r);
      if (!arm.init) { arm.cur.copy(arm.target); arm.init = true; }
      arm.cur.lerp(arm.target, Math.min(1, dt * 9));
      const s = _a.copy(this.shoulders[i]).applyMatrix4(this.spine.matrix);
      const shoulder = s.clone();
      const elbow = new THREE.Vector3(), hand = new THREE.Vector3();
      // Ellbogen nach unten außen; beim Ausspielen eher zur Seite, damit er nicht in den Tisch taucht
      solveArm(shoulder, arm.cur, _c.set(sx * (0.9 + r * 0.9), -1 + r * 0.8, 0.35), elbow, hand);
      if (elbow.y < 0.45 && elbow.z < -2.4) solveArm(shoulder, arm.cur, _c.set(sx * 1.6, 0.3, 0.3), elbow, hand);
      placeLimb(arm.upper, shoulder, elbow);
      placeLimb(arm.fore, elbow, hand);
      arm.elbow.position.copy(elbow);
      arm.hand.position.copy(hand);
      _b.subVectors(hand, elbow).normalize();
      arm.hand.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), _b);
    });
  }
}

export class Figures {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.slots = [null, null, null, null]; // nach rel: { key, fig }
    this.t = 0;
  }

  setVisible(v) { this.group.visible = v; }

  // seats: Array nach rel mit { key, female } oder null (leer / eigener Platz)
  setSeats(seats) {
    for (let rel = 0; rel < 4; rel++) {
      const want = seats[rel];
      const cur = this.slots[rel];
      const key = want ? `${want.key}|${want.female ? 'f' : 'm'}` : null;
      if (cur?.key === key) continue;
      if (cur) { this.group.remove(cur.fig.root); dispose(cur.fig.root); }
      this.slots[rel] = null;
      if (!want) continue;
      const fig = new Figure(want.key, want.female);
      const a = Math.atan2(DIRS[rel][0], DIRS[rel][1]);
      fig.root.position.set(DIRS[rel][0] * CHAIR_R, 0, DIRS[rel][1] * CHAIR_R);
      fig.root.rotation.y = a;
      this.group.add(fig.root);
      this.slots[rel] = { key, fig };
    }
  }

  // Ausspielen: die rechte Hand greift kurz nach vorn auf den Tisch
  reach(rel) {
    const s = this.slots[rel];
    if (s) s.fig.reachT = 0;
  }

  // ctx(rel) -> { hold, look, myTurn } in Welt-Koordinaten; wird hier ins Figurensystem umgerechnet
  update(dt, ctx) {
    if (!this.group.visible) return;
    this.t += dt;
    for (let rel = 0; rel < 4; rel++) {
      const s = this.slots[rel];
      if (!s) continue;
      const c = ctx(rel);
      const root = s.fig.root;
      root.updateMatrixWorld();
      const inv = { x: 0, z: 0 };
      const lw = root.worldToLocal(c.look.clone());
      inv.x = lw.x; inv.z = lw.z;
      let hold = null;
      if (c.hold) {
        hold = c.hold.map((p) => root.worldToLocal(p.clone()));
        if (hold[0].x > hold[1].x) hold.reverse(); // linke Hand (lokal -x) an den linken Griffpunkt
      }
      s.fig.update(dt, this.t, { hold, look: inv, myTurn: c.myTurn });
    }
  }
}

const DIRS = [[0, 1], [-1, 0], [0, -1], [1, 0]];

function dispose(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
}
