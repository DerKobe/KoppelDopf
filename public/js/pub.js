// Die Kneipe rund um den Stammtisch. Maßstab: 1 Einheit = 10 cm, Tischplatte bei y = 0.
import * as THREE from 'three';

export const TABLE_HALF = 5.6;
const FLOOR_Y = -7.5;
const CEIL_Y = 21;

function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}

function rand(seed) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

function woodTexture(base, dark, planks = 6, seed = 7, w = 512, h = 512) {
  const rnd = rand(seed);
  return (ctx) => {
    const ph = h / planks;
    for (let p = 0; p < planks; p++) {
      const shade = 0.85 + rnd() * 0.3;
      ctx.fillStyle = shadeColor(base, shade);
      ctx.fillRect(0, p * ph, w, ph);
      for (let i = 0; i < 40; i++) {
        ctx.strokeStyle = `rgba(${dark},${0.05 + rnd() * 0.12})`;
        ctx.lineWidth = 1 + rnd() * 2;
        const y = p * ph + rnd() * ph;
        ctx.beginPath();
        ctx.moveTo(0, y);
        for (let x = 0; x <= w; x += 32) ctx.lineTo(x, y + Math.sin(x * 0.02 + i) * 2 + (rnd() - 0.5) * 2);
        ctx.stroke();
      }
      ctx.fillStyle = `rgba(${dark},0.6)`;
      ctx.fillRect(0, p * ph, w, 2);
    }
  };
}

function shadeColor(hex, f) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(f);
  return `#${c.getHexString()}`;
}

function mat(opts) { return new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0, ...opts }); }

export function buildPub(scene) {
  const pub = new THREE.Group();
  scene.add(pub);
  const shadowy = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };

  // ---------- Boden ----------
  const floorTex = canvasTex(512, 512, woodTexture('#5a3a22', '30,16,6', 8, 3), [8, 8]);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), mat({ map: floorTex, roughness: 0.7 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR_Y;
  floor.receiveShadow = true;
  pub.add(floor);

  // ---------- Wände ----------
  const plasterTex = canvasTex(256, 256, (ctx, w, h) => {
    const rnd = rand(11);
    ctx.fillStyle = '#b48a55';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 2500; i++) {
      ctx.fillStyle = `rgba(${rnd() > 0.5 ? '255,230,190' : '80,50,20'},${rnd() * 0.08})`;
      ctx.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 5, 2 + rnd() * 5);
    }
  }, [6, 2]);
  const panelTex = canvasTex(512, 256, (ctx, w, h) => {
    woodTexture('#4a2a16', '20,10,4', 1, 5, w, h)(ctx);
    ctx.strokeStyle = 'rgba(15,8,3,0.8)';
    ctx.lineWidth = 6;
    for (let x = 0; x < w; x += 128) ctx.strokeRect(x + 14, 22, 100, h - 44);
    ctx.strokeStyle = 'rgba(255,210,160,0.12)';
    ctx.lineWidth = 2;
    for (let x = 0; x < w; x += 128) ctx.strokeRect(x + 20, 28, 88, h - 56);
  }, [10, 1]);

  const wallH = CEIL_Y - FLOOR_Y;
  const wainH = 11;
  const walls = [
    { pos: [0, 0, -34], rot: 0, w: 90 },
    { pos: [-36, 0, 0], rot: Math.PI / 2, w: 90 },
    { pos: [36, 0, 0], rot: -Math.PI / 2, w: 90 },
    { pos: [0, 0, 32], rot: Math.PI, w: 90 },
  ];
  for (const wd of walls) {
    const g = new THREE.Group();
    g.position.set(...wd.pos);
    g.rotation.y = wd.rot;
    const upper = new THREE.Mesh(new THREE.PlaneGeometry(wd.w, wallH - wainH), mat({ map: plasterTex, roughness: 0.95 }));
    upper.position.y = FLOOR_Y + wainH + (wallH - wainH) / 2;
    upper.receiveShadow = true;
    const lower = new THREE.Mesh(new THREE.PlaneGeometry(wd.w, wainH), mat({ map: panelTex, roughness: 0.6 }));
    lower.position.y = FLOOR_Y + wainH / 2;
    lower.position.z = 0.3;
    const rail = new THREE.Mesh(new THREE.BoxGeometry(wd.w, 0.6, 0.9), mat({ color: '#2e1a0c', roughness: 0.5 }));
    rail.position.set(0, FLOOR_Y + wainH, 0.45);
    g.add(upper, lower, rail);
    pub.add(g);
  }

  // ---------- Decke mit Balken (wird ausgeblendet, wenn die Kamera im Hochformat darüber schwebt) ----------
  const overhead = new THREE.Group();
  pub.add(overhead);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), mat({ color: '#2a1a0f', roughness: 1 }));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = CEIL_Y;
  overhead.add(ceil);
  const beamMat = mat({ color: '#3a2413', roughness: 0.9 });
  for (let x = -30; x <= 30; x += 12) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.8, 70), beamMat);
    b.position.set(x, CEIL_Y - 0.9, 0);
    overhead.add(b);
  }

  // ---------- Stammtisch ----------
  const tableTex = canvasTex(1024, 1024, woodTexture('#6b4424', '35,18,6', 7, 21, 1024, 1024));
  const tableMat = mat({ map: tableTex, roughness: 0.45 });
  const top = shadowy(new THREE.Mesh(new THREE.BoxGeometry(TABLE_HALF * 2, 0.6, TABLE_HALF * 2), tableMat));
  top.position.y = -0.3;
  pub.add(top);
  const edgeMat = mat({ color: '#3d2412', roughness: 0.5 });
  for (const [x, z, w, d] of [[0, TABLE_HALF, TABLE_HALF * 2 + 0.4, 0.4], [0, -TABLE_HALF, TABLE_HALF * 2 + 0.4, 0.4], [TABLE_HALF, 0, 0.4, TABLE_HALF * 2], [-TABLE_HALF, 0, 0.4, TABLE_HALF * 2]]) {
    const e = shadowy(new THREE.Mesh(new THREE.BoxGeometry(w, 0.75, d), edgeMat));
    e.position.set(x, -0.3, z);
    pub.add(e);
  }
  const legGeo = new THREE.BoxGeometry(0.9, 7, 0.9);
  for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const leg = shadowy(new THREE.Mesh(legGeo, edgeMat));
    leg.position.set(x * (TABLE_HALF - 0.8), FLOOR_Y + 3.5, z * (TABLE_HALF - 0.8));
    pub.add(leg);
  }
  // Spielteppich (Filz)
  const feltTex = canvasTex(1024, 1024, (ctx, w, h) => {
    const rnd = rand(4);
    const g = ctx.createRadialGradient(w / 2, h / 2, 50, w / 2, h / 2, w * 0.7);
    g.addColorStop(0, '#1f6a45');
    g.addColorStop(1, '#154a31');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 25000; i++) {
      ctx.fillStyle = `rgba(${rnd() > 0.5 ? '255,255,255' : '0,0,0'},${rnd() * 0.05})`;
      ctx.fillRect(rnd() * w, rnd() * h, 2, 2);
    }
    ctx.strokeStyle = 'rgba(230,200,120,0.55)';
    ctx.setLineDash([10, 8]);
    ctx.lineWidth = 3;
    ctx.strokeRect(28, 28, w - 56, h - 56);
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(230,200,120,0.18)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(w / 2, h / 2, 250, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(230,200,120,0.10)';
    ctx.font = 'italic bold 64px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText('Stammtisch', w / 2, h / 2 - 280);
  });
  const felt = new THREE.Mesh(new THREE.PlaneGeometry(9.4, 9.4), mat({ map: feltTex, roughness: 1 }));
  felt.rotation.x = -Math.PI / 2;
  felt.position.y = 0.005;
  felt.receiveShadow = true;
  pub.add(felt);

  // ---------- Stühle ----------
  const chairMat = mat({ color: '#4b2d17', roughness: 0.6 });
  const makeChair = () => {
    const g = new THREE.Group();
    const seat = shadowy(new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.5, 4.2), chairMat));
    seat.position.y = -3;
    g.add(seat);
    for (const [x, z] of [[1.9, 1.8], [-1.9, 1.8], [1.9, -1.8], [-1.9, -1.8]]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.4, 4.5, 0.4), chairMat);
      l.position.set(x, FLOOR_Y + 2.25, z);
      g.add(l);
    }
    for (const x of [-1.9, 1.9]) {
      const p = shadowy(new THREE.Mesh(new THREE.BoxGeometry(0.4, 5.6, 0.4), chairMat));
      p.position.set(x, -0.2, 1.9);
      g.add(p);
    }
    for (const y of [0.4, 1.6]) {
      const s = shadowy(new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.7, 0.3), chairMat));
      s.position.set(0, y, 1.9);
      g.add(s);
    }
    return g;
  };
  for (let i = 0; i < 4; i++) {
    const c = makeChair();
    const a = (i * Math.PI) / 2;
    c.position.set(Math.sin(a) * 8.2, 0, Math.cos(a) * 8.2);
    c.rotation.y = a;
    pub.add(c);
  }

  // ---------- Bier auf Bierdeckeln (an den Tischecken) ----------
  const coasterTex = canvasTex(256, 256, (ctx, w) => {
    ctx.fillStyle = '#f4ecd8'; ctx.beginPath(); ctx.arc(w / 2, w / 2, w / 2 - 2, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#a3202c'; ctx.lineWidth = 12; ctx.beginPath(); ctx.arc(w / 2, w / 2, w / 2 - 16, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#a3202c'; ctx.font = 'bold 44px Georgia, serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Prost!', w / 2, w / 2);
    ctx.strokeStyle = '#333'; ctx.lineWidth = 3;
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(90 + i * 22, 170); ctx.lineTo(95 + i * 22, 200); ctx.stroke(); }
  });
  const glassProfile = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    glassProfile.push(new THREE.Vector2(0.32 + 0.06 * Math.sin(t * Math.PI * 0.9) + t * 0.08, t * 2.4));
  }
  const glassGeo = new THREE.LatheGeometry(glassProfile, 24);
  const glassMat = new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.05, transmission: 0, transparent: true, opacity: 0.22, side: THREE.DoubleSide });
  const beerMat = mat({ color: '#d98a1c', roughness: 0.3, emissive: '#6a3000', emissiveIntensity: 0.25, transparent: true, opacity: 0.92 });
  const foamMat = mat({ color: '#fff8e8', roughness: 1 });
  const beerProfile = glassProfile.slice(0, 10).map((v) => new THREE.Vector2(v.x - 0.02, v.y + 0.02));
  const beerGeo = new THREE.LatheGeometry(beerProfile, 24);
  const makeBeer = (fill) => {
    const g = new THREE.Group();
    const coaster = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.04, 32), [mat({ color: '#e8dcc0' }), mat({ map: coasterTex }), mat({ color: '#e8dcc0' })]);
    coaster.position.y = 0.02;
    coaster.receiveShadow = true;
    g.add(coaster);
    const glass = new THREE.Mesh(glassGeo, glassMat);
    glass.position.y = 0.04;
    g.add(glass);
    const beer = new THREE.Mesh(beerGeo, beerMat);
    beer.scale.y = fill;
    beer.position.y = 0.05;
    beer.castShadow = true;
    g.add(beer);
    const foam = new THREE.Mesh(new THREE.CylinderGeometry(beerProfile[9].x * 1.0, beerProfile[9].x * 0.98, 0.28, 24), foamMat);
    foam.position.y = 0.05 + beerProfile[9].y * fill + 0.1;
    g.add(foam);
    return g;
  };
  // nur an den hinteren Ecken, damit vorne nichts die eigenen Karten verdeckt
  [[-1, -1, 0.85], [1, -1, 0.5]].forEach(([x, z, f]) => {
    const b = makeBeer(f);
    b.position.set(x * (TABLE_HALF - 0.75), 0, z * (TABLE_HALF - 0.75));
    pub.add(b);
  });

  // ---------- Theke ----------
  const bar = new THREE.Group();
  bar.position.set(0, 0, -27);
  const counterTex = canvasTex(512, 256, (ctx, w, h) => {
    woodTexture('#5a3218', '20,10,4', 1, 9, w, h)(ctx);
    ctx.strokeStyle = 'rgba(10,5,2,0.8)'; ctx.lineWidth = 5;
    for (let x = 0; x < w; x += 102) ctx.strokeRect(x + 10, 20, 82, h - 40);
  }, [4, 1]);
  const counter = shadowy(new THREE.Mesh(new THREE.BoxGeometry(34, 11, 4.5), mat({ map: counterTex, roughness: 0.55 })));
  counter.position.y = FLOOR_Y + 5.5;
  bar.add(counter);
  const counterTop = shadowy(new THREE.Mesh(new THREE.BoxGeometry(35, 0.6, 5.5), mat({ color: '#2b170a', roughness: 0.3 })));
  counterTop.position.y = FLOOR_Y + 11.3;
  bar.add(counterTop);
  const brass = mat({ color: '#c9a045', metalness: 0.9, roughness: 0.3 });
  const footRail = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 34, 12), brass);
  footRail.rotation.z = Math.PI / 2;
  footRail.position.set(0, FLOOR_Y + 1.2, 2.8);
  bar.add(footRail);
  for (let i = -1; i <= 1; i++) {
    const tap = new THREE.Group();
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 2.6, 16), brass);
    col.position.y = 1.3;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), brass);
    head.position.y = 2.7;
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 1.6, 8), mat({ color: '#111' }));
    handle.position.y = 3.6;
    tap.add(col, head, handle);
    tap.position.set(i * 3 - 6, FLOOR_Y + 11.6, 0);
    bar.add(tap);
  }
  // Gläser auf der Theke
  for (let i = 0; i < 5; i++) {
    const b = makeBeer(0.9);
    b.scale.setScalar(1.3);
    b.position.set(4 + i * 1.8, FLOOR_Y + 11.6, 0.8 + (i % 2) * 0.8);
    bar.add(b);
  }
  // Regal mit Flaschen
  const shelfMat = mat({ color: '#2e1a0c' });
  const bottleColors = ['#2f5d2a', '#6b3a12', '#1d4a4a', '#8a6a1a', '#5a1a1a', '#e8e0c8'];
  const rnd = rand(99);
  for (let s = 0; s < 3; s++) {
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(30, 0.4, 2), shelfMat);
    shelf.position.set(0, FLOOR_Y + 14 + s * 3.2, -5.6);
    bar.add(shelf);
    for (let x = -14; x <= 14; x += 1.1 + rnd() * 0.6) {
      const h = 1.8 + rnd() * 1;
      const bm = new THREE.MeshStandardMaterial({ color: bottleColors[Math.floor(rnd() * bottleColors.length)], roughness: 0.15, metalness: 0.1, emissive: '#1a0e04', emissiveIntensity: 0.4 });
      const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.35, h, 10), bm);
      bottle.position.set(x, FLOOR_Y + 14.2 + s * 3.2 + h / 2, -5.6);
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.2, 0.8, 8), bm);
      neck.position.set(x, FLOOR_Y + 14.2 + s * 3.2 + h + 0.4, -5.6);
      bar.add(bottle, neck);
    }
  }
  // Barhocker
  for (let i = -2; i <= 2; i++) {
    const stool = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.5, 20), mat({ color: '#6b1a1a', roughness: 0.6 }));
    seat.position.y = FLOOR_Y + 7.5;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 7.5, 10), brass);
    pole.position.y = FLOOR_Y + 3.75;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.1, 0.2, 20), brass);
    base.position.y = FLOOR_Y + 0.1;
    stool.add(seat, pole, base);
    stool.position.set(i * 6, 0, 5);
    bar.add(stool);
  }
  pub.add(bar);

  // ---------- Wanddeko ----------
  // Kreidetafel mit Spielstand (wird live aktualisiert)
  const chalkCanvas = document.createElement('canvas');
  chalkCanvas.width = 1024; chalkCanvas.height = 640;
  const chalkTex = new THREE.CanvasTexture(chalkCanvas);
  chalkTex.colorSpace = THREE.SRGBColorSpace;
  chalkTex.anisotropy = 8;
  const board = new THREE.Group();
  const boardFrame = new THREE.Mesh(new THREE.BoxGeometry(17, 11, 0.5), mat({ color: '#3a2210' }));
  const boardFace = new THREE.Mesh(new THREE.PlaneGeometry(16, 10), mat({ map: chalkTex, roughness: 1 }));
  boardFace.position.z = 0.26;
  board.add(boardFrame, boardFace);
  board.position.set(-20, 11.5, -33.6);
  pub.add(board);

  // Uhr
  const clockTex = canvasTex(256, 256, (ctx, w) => {
    ctx.fillStyle = '#f2ead6'; ctx.beginPath(); ctx.arc(w / 2, w / 2, w / 2 - 4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#2b1a0c'; ctx.lineWidth = 10; ctx.stroke();
    ctx.fillStyle = '#222';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.fillRect(w / 2 + Math.sin(a) * 100 - 4, w / 2 - Math.cos(a) * 100 - 4, 8, 8);
    }
    ctx.lineCap = 'round';
    ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(w / 2, w / 2); ctx.lineTo(w / 2 + 50, w / 2 - 30); ctx.stroke();
    ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(w / 2, w / 2); ctx.lineTo(w / 2 - 10, w / 2 - 90); ctx.stroke();
  });
  const clock = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 0.3, 32), [mat({ color: '#2b1a0c' }), mat({ map: clockTex }), mat({ color: '#2b1a0c' })]);
  clock.rotation.x = Math.PI / 2;
  clock.position.set(20, 15, -33.7);
  pub.add(clock);

  // Bilder
  const pictureTex = (seed, sky, ground) => canvasTex(256, 192, (ctx, w, h) => {
    const r = rand(seed);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, sky); g.addColorStop(1, '#e8c890');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = ground;
    ctx.beginPath(); ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += 16) ctx.lineTo(x, h * 0.55 + Math.sin(x * 0.03 + seed) * 18 + r() * 8);
    ctx.lineTo(w, h); ctx.fill();
    ctx.fillStyle = 'rgba(40,30,20,0.8)';
    ctx.fillRect(w * 0.6, h * 0.35, 30, 40);
    ctx.beginPath(); ctx.moveTo(w * 0.6 - 6, h * 0.35); ctx.lineTo(w * 0.6 + 15, h * 0.22); ctx.lineTo(w * 0.6 + 36, h * 0.35); ctx.fill();
  });
  [[6, 13, pictureTex(3, '#6f8fae', '#4d6b35')], [30, 12, pictureTex(8, '#b07a4a', '#5b4a2a')]].forEach(([x, y, t]) => {
    const f = new THREE.Mesh(new THREE.BoxGeometry(7, 5.4, 0.4), mat({ color: '#6a4a1a', metalness: 0.3, roughness: 0.5 }));
    const p = new THREE.Mesh(new THREE.PlaneGeometry(6, 4.4), mat({ map: t, roughness: 0.9 }));
    p.position.z = 0.21;
    f.add(p);
    f.position.set(x, y, -33.7);
    pub.add(f);
  });

  // Dartscheibe (rechte Wand)
  const dartTex = canvasTex(256, 256, (ctx, w) => {
    const c = w / 2;
    for (let i = 0; i < 20; i++) {
      const a0 = (i / 20) * Math.PI * 2 - Math.PI / 20, a1 = a0 + Math.PI / 10;
      for (const [r0, r1, col] of [[0, 120, i % 2 ? '#111' : '#efe4c8'], [70, 78, i % 2 ? '#1c6b30' : '#b0202a'], [112, 120, i % 2 ? '#1c6b30' : '#b0202a']]) {
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(c, c, r1, a0, a1); ctx.arc(c, c, r0, a1, a0, true); ctx.fill();
      }
    }
    ctx.fillStyle = '#1c6b30'; ctx.beginPath(); ctx.arc(c, c, 12, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#b0202a'; ctx.beginPath(); ctx.arc(c, c, 5, 0, Math.PI * 2); ctx.fill();
  });
  const dart = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.6, 32), [mat({ color: '#111' }), mat({ map: dartTex }), mat({ color: '#111' })]);
  dart.rotation.z = Math.PI / 2;
  dart.rotation.y = Math.PI;
  dart.position.set(35.6, 9, -12);
  pub.add(dart);

  // Butzenscheiben-Fenster mit Gardine (linke Wand)
  const windowTex = canvasTex(256, 384, (ctx, w, h) => {
    ctx.fillStyle = '#0d1830'; ctx.fillRect(0, 0, w, h);
    for (let y = 16; y < h; y += 30) for (let x = 16 + ((y / 30) % 2) * 15; x < w; x += 30) {
      const g = ctx.createRadialGradient(x, y, 1, x, y, 15);
      g.addColorStop(0, 'rgba(255,215,140,0.55)'); g.addColorStop(0.6, 'rgba(90,110,120,0.35)'); g.addColorStop(1, 'rgba(20,30,40,0.6)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = '#2b1a0c'; ctx.lineWidth = 12; ctx.strokeRect(0, 0, w, h);
    ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
  });
  const curtainTex = canvasTex(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#f3eee0'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(160,140,110,0.35)'; ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 8) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y < h; y += 16) for (let x = 0; x < w; x += 16) { ctx.beginPath(); ctx.arc(x + 8, y + 8, 3, 0, Math.PI * 2); ctx.stroke(); }
  }, [3, 1]);
  for (const z of [-14, 10]) {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(8, 12), new THREE.MeshStandardMaterial({ map: windowTex, emissive: '#ffffff', emissiveMap: windowTex, emissiveIntensity: 0.35 }));
    win.rotation.y = Math.PI / 2;
    win.position.set(-35.8, 10, z);
    pub.add(win);
    const curtain = new THREE.Mesh(new THREE.PlaneGeometry(9, 5), new THREE.MeshStandardMaterial({ map: curtainTex, transparent: true, opacity: 0.92, side: THREE.DoubleSide }));
    curtain.rotation.y = Math.PI / 2;
    curtain.position.set(-35.5, 7, z);
    pub.add(curtain);
  }

  // Geldspielautomat (rechte Wand) – blinkt ein bisschen
  const slot = new THREE.Group();
  const slotBody = new THREE.Mesh(new THREE.BoxGeometry(3, 8, 5), mat({ color: '#222', roughness: 0.4 }));
  const slotTex = canvasTex(128, 256, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#ffcf3a'); g.addColorStop(0.5, '#ff5a2a'); g.addColorStop(1, '#7a1ad0');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#111'; ctx.fillRect(14, 90, 100, 50);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 30px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('7 7 7', 64, 126);
    ctx.font = 'bold 22px sans-serif'; ctx.fillText('JACKPOT', 64, 50);
  });
  const slotFace = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 7.4), new THREE.MeshStandardMaterial({ map: slotTex, emissive: '#ffffff', emissiveMap: slotTex, emissiveIntensity: 0.6 }));
  slotFace.rotation.y = -Math.PI / 2;
  slotFace.position.x = -1.52;
  slot.add(slotBody, slotFace);
  slot.position.set(34, FLOOR_Y + 11, 8);
  pub.add(slot);

  // ---------- Licht ----------
  const hemi = new THREE.HemisphereLight('#ffdcb0', '#2a160a', 0.55);
  scene.add(hemi);
  const tableLight = new THREE.SpotLight('#ffd6a0', 900, 0, 0.78, 0.55, 1.6);
  tableLight.position.set(0, 13, 0.5);
  tableLight.target.position.set(0, 0, 0);
  tableLight.castShadow = true;
  tableLight.shadow.mapSize.set(2048, 2048);
  tableLight.shadow.bias = -0.0004;
  tableLight.shadow.normalBias = 0.02;
  tableLight.shadow.camera.near = 4;
  tableLight.shadow.camera.far = 30;
  scene.add(tableLight, tableLight.target);
  // Lampe über dem Tisch (grüner Emaille-Schirm) – außerhalb des Blickfelds, aber ihr Schein ist sichtbar
  const shade = new THREE.Mesh(new THREE.ConeGeometry(3, 2, 32, 1, true), new THREE.MeshStandardMaterial({ color: '#1f4a2a', side: THREE.DoubleSide, roughness: 0.5 }));
  shade.position.set(0, 14.5, 0.5);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.6, 16, 12), new THREE.MeshBasicMaterial({ color: '#fff2d0' }));
  bulb.position.set(0, 13.9, 0.5);
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, CEIL_Y - 15.5, 6), mat({ color: '#111' }));
  cord.position.set(0, (CEIL_Y + 15.5) / 2, 0.5);
  overhead.add(shade, bulb, cord);

  // Warmes Licht an der Theke + Wandlampen
  const barLight = new THREE.PointLight('#ffb870', 300, 40, 1.8);
  barLight.position.set(0, 16, -24);
  scene.add(barLight);
  for (const [x, z] of [[-30, -33], [30, -33], [-35, -2], [35, -2]]) {
    const l = new THREE.PointLight('#ffae60', 90, 22, 1.8);
    l.position.set(x * 0.97, 13, z * 0.97);
    scene.add(l);
    const sconce = new THREE.Mesh(new THREE.SphereGeometry(0.8, 12, 8), new THREE.MeshBasicMaterial({ color: '#ffcf8a' }));
    sconce.position.set(x, 13, z);
    pub.add(sconce);
  }

  scene.fog = new THREE.Fog('#1b100a', 30, 85);
  scene.background = new THREE.Color('#1b100a');

  // ---------- API ----------
  let slotT = 0;
  return {
    tableLight,
    overhead,
    update(dt) {
      slotT += dt;
      slotFace.material.emissiveIntensity = 0.45 + 0.25 * Math.max(0, Math.sin(slotT * 3)) * (Math.sin(slotT * 0.7) > 0 ? 1 : 0.3);
    },
    setChalkboard(title, rows) {
      const ctx = chalkCanvas.getContext('2d');
      const w = chalkCanvas.width, h = chalkCanvas.height;
      ctx.fillStyle = '#1f2a24';
      ctx.fillRect(0, 0, w, h);
      const r = rand(5);
      for (let i = 0; i < 400; i++) { ctx.fillStyle = `rgba(255,255,255,${r() * 0.04})`; ctx.fillRect(r() * w, r() * h, 30 * r(), 3); }
      ctx.fillStyle = '#f2efe6';
      ctx.font = 'italic bold 64px "Comic Sans MS", "Chalkboard SE", "Segoe Print", cursive';
      ctx.textAlign = 'center';
      ctx.fillText(title, w / 2, 90);
      ctx.strokeStyle = 'rgba(242,239,230,0.8)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(120, 115); ctx.lineTo(w - 120, 118); ctx.stroke();
      ctx.font = '48px "Comic Sans MS", "Chalkboard SE", "Segoe Print", cursive';
      rows.forEach(([name, score], i) => {
        const y = 200 + i * 95;
        ctx.textAlign = 'left';
        ctx.fillStyle = '#f2efe6';
        ctx.fillText(name.slice(0, 16), 110, y);
        ctx.textAlign = 'right';
        ctx.fillStyle = score < 0 ? '#ffb3a8' : '#d8f5c8';
        ctx.fillText(String(score), w - 110, y);
      });
      chalkTex.needsUpdate = true;
    },
  };
}
