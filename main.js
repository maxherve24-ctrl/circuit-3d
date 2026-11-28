import * as THREE from 'three';
import {
  HW, ROAD_W, CURB_W, LAPS, TRACKS, DIFFICULTIES,
  buildTrack, makeCar, makeAI, placeCar, resetRace, gridSlots,
  physics, trackQuery, lapLogic, progress, collide, aiControl
} from './core.js';
import { initLeaderboard, submitTime, fetchTop } from './leaderboard.js';

// ============================================================
//  AMBIANCES DES CIRCUITS
// ============================================================
const THEMES = {
  vert:   { fog: 0xd3e3ef, skyTop: 0x2f6fc4, sun: 0xfff0d8, sunI: 3.0, sunOff: [70, 120, 45],
            hemiSky: 0xcfe6ff, hemiGround: 0x4d5a3a, ground: 'grass', deco: 'trees', hill: 0x56704a },
  sunset: { fog: 0xf0c29a, skyTop: 0x3a4a8f, sun: 0xffa45a, sunI: 2.8, sunOff: [-130, 50, 90],
            hemiSky: 0xffd8b4, hemiGround: 0x3e3a2e, ground: 'grass', deco: 'trees', hill: 0x4b5a46 },
  desert: { fog: 0xefdbb6, skyTop: 0x3f8fd8, sun: 0xfff2d0, sunI: 3.4, sunOff: [60, 130, -40],
            hemiSky: 0xe8f2ff, hemiGround: 0x8a6a40, ground: 'sand', deco: 'rocks', hill: 0xc49a62 }
};

// ============================================================
//  RENDU
// ============================================================
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const FOG = new THREE.Color();
scene.fog = new THREE.Fog(FOG, 200, 1400);
scene.background = FOG;
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 4000);

const skyTop = new THREE.Color();
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(3000, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: skyTop }, bottom: { value: FOG } },
    vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 bottom; varying vec3 vP;
      void main(){ float h = clamp(vP.y, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, pow(h, 0.55)), 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`
  })
);
scene.add(sky);

const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 450 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
const SUN_OFFSET = new THREE.Vector3();

// ============================================================
//  TEXTURES (générées par code)
// ============================================================
function makeTex(w, h, draw, rx = 1, ry = 1) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}
const rnd = (a, b) => a + Math.random() * (b - a);

const asphaltTex = makeTex(256, 512, (g, w, h) => {
  g.fillStyle = '#3a3b3e'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 12000; i++) {
    const v = rnd(38, 95) | 0;
    g.fillStyle = `rgb(${v},${v},${v + 3})`;
    g.fillRect(Math.random() * w, Math.random() * h, 1.4, 1.4);
  }
  g.fillStyle = 'rgba(0,0,0,0.12)';
  g.fillRect(w * 0.28, 0, w * 0.1, h); g.fillRect(w * 0.62, 0, w * 0.1, h);
  g.fillStyle = '#ececec';
  g.fillRect(10, 0, 6, h); g.fillRect(w - 16, 0, 6, h);
  g.fillRect(w / 2 - 3, 0, 6, h * 0.45);
});
const curbTex = makeTex(64, 64, (g, w, h) => {
  g.fillStyle = '#c8202c'; g.fillRect(0, 0, w, h / 2);
  g.fillStyle = '#f2f2f2'; g.fillRect(0, h / 2, w, h / 2);
});
const grassTex = makeTex(512, 512, (g, w, h) => {
  g.fillStyle = '#4b7a2f'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 26000; i++) {
    g.fillStyle = `rgba(${rnd(50, 95) | 0},${rnd(100, 150) | 0},${rnd(30, 55) | 0},0.55)`;
    g.fillRect(Math.random() * w, Math.random() * h, 1.2, rnd(2, 5));
  }
}, 400, 400);
const sandTex = makeTex(512, 512, (g, w, h) => {
  g.fillStyle = '#d4b07a'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 30000; i++) {
    const v = rnd(-30, 30);
    g.fillStyle = `rgba(${210 + v | 0},${172 + v | 0},${118 + v | 0},0.6)`;
    g.fillRect(Math.random() * w, Math.random() * h, rnd(1, 2.5), rnd(1, 2.5));
  }
}, 400, 400);
const checkerTex = makeTex(128, 16, (g, w, h) => {
  const s = 8;
  for (let x = 0; x < w / s; x++) for (let y = 0; y < h / s; y++) {
    g.fillStyle = (x + y) % 2 ? '#111' : '#f5f5f5';
    g.fillRect(x * s, y * s, s, s);
  }
});
const roadMat = new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.92, metalness: 0 });
const curbMat = new THREE.MeshStandardMaterial({ map: curbTex, roughness: 0.7 });
const grassMat = new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 });
const sandMat = new THREE.MeshStandardMaterial({ map: sandTex, roughness: 1 });
const metal = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.7, roughness: 0.35 });
const concrete = new THREE.MeshStandardMaterial({ color: 0xb8b8b0, roughness: 0.9 });

// ============================================================
//  CONSTRUCTION D'UN CIRCUIT
// ============================================================
let T = null;          // données du circuit (core.js)
let world = null;      // objets 3D du circuit

function ribbon(a, b, y, material, vLen) {
  const { PTS, NOR, DIST, N } = T;
  const pos = [], uv = [], nrm = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const p = PTS[i % N], n = NOR[i % N], v = DIST[i] / vLen;
    pos.push(p.x + n.x * a, y, p.z + n.z * a, p.x + n.x * b, y, p.z + n.z * b);
    uv.push(0, v, 1, v);
    nrm.push(0, 1, 0, 0, 1, 0);
  }
  for (let i = 0; i < N; i++) {
    const L = i * 2, R = L + 1, L1 = L + 2, R1 = L + 3;
    idx.push(L, L1, R, R, L1, R1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setIndex(idx);
  const m = new THREE.Mesh(geo, material);
  m.receiveShadow = true;
  world.add(m);
}

function distToTrack(x, z) {
  let best = Infinity;
  for (let i = 0; i < T.N; i += 3) {
    const dx = T.PTS[i].x - x, dz = T.PTS[i].z - z, d = dx * dx + dz * dz;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

function scatter(count, minDist, place) {
  const xs = T.PTS.map(p => p.x), zs = T.PTS.map(p => p.z);
  const minX = Math.min(...xs) - 250, maxX = Math.max(...xs) + 250;
  const minZ = Math.min(...zs) - 250, maxZ = Math.max(...zs) + 250;
  let placed = 0, tries = 0;
  while (placed < count && tries < count * 30) {
    tries++;
    const x = rnd(minX, maxX), z = rnd(minZ, maxZ);
    if (distToTrack(x, z) < minDist) continue;
    place(placed++, x, z);
  }
  return placed;
}

function buildWorld(def) {
  if (world) {
    scene.remove(world);
    world.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  }
  T = buildTrack(def);
  world = new THREE.Group();
  scene.add(world);
  const th = THEMES[def.theme];

  // Ambiance
  FOG.setHex(th.fog);
  skyTop.setHex(th.skyTop);
  hemi.color.setHex(th.hemiSky);
  hemi.groundColor.setHex(th.hemiGround);
  sun.color.setHex(th.sun);
  sun.intensity = th.sunI;
  SUN_OFFSET.set(...th.sunOff);

  // Piste
  ribbon(-HW, HW, 0.03, roadMat, 12);
  ribbon(-HW - CURB_W, -HW, 0.05, curbMat, 3);
  ribbon(HW, HW + CURB_W, 0.05, curbMat, 3);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), th.ground === 'sand' ? sandMat : grassMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  world.add(ground);

  // Décor
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
  if (th.deco === 'trees') {
    const COUNT = 700;
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.35, 2.4, 6).translate(0, 1.2, 0),
      new THREE.MeshStandardMaterial({ color: 0x5a3d26, roughness: 1 }), COUNT);
    const leaves = new THREE.InstancedMesh(new THREE.ConeGeometry(1.9, 5.5, 7).translate(0, 4.9, 0),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }), COUNT);
    const n = scatter(COUNT, HW + 14, (i, x, z) => {
      const k = rnd(0.7, 1.7);
      m.compose(p.set(x, 0, z), q.setFromAxisAngle(up, rnd(0, 6.28)), s.set(k, k * rnd(0.85, 1.25), k));
      trunks.setMatrixAt(i, m); leaves.setMatrixAt(i, m);
      leaves.setColorAt(i, col.setHSL(rnd(0.24, 0.33), rnd(0.35, 0.55), rnd(0.18, 0.3)));
    });
    trunks.count = leaves.count = n;
    trunks.castShadow = leaves.castShadow = true;
    world.add(trunks, leaves);
  } else {
    const COUNT = 420;
    const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1.6, 0),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true }), COUNT);
    const n = scatter(COUNT, HW + 12, (i, x, z) => {
      const k = rnd(0.6, 4);
      q.setFromEuler(new THREE.Euler(rnd(0, 3), rnd(0, 6.28), rnd(0, 3)));
      m.compose(p.set(x, k * 0.4, z), q, s.set(k * rnd(0.8, 1.6), k * rnd(0.5, 1), k * rnd(0.8, 1.6)));
      rocks.setMatrixAt(i, m);
      rocks.setColorAt(i, col.setHSL(rnd(0.05, 0.09), rnd(0.35, 0.5), rnd(0.32, 0.5)));
    });
    rocks.count = n;
    rocks.castShadow = rocks.receiveShadow = true;
    const CC = 160;
    const cacti = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.35, 0.4, 4, 8).translate(0, 2, 0),
      new THREE.MeshStandardMaterial({ color: 0x3f7a3a, roughness: 0.8 }), CC);
    const nc = scatter(CC, HW + 10, (i, x, z) => {
      const k = rnd(0.7, 1.4);
      m.compose(p.set(x, 0, z), q.identity(), s.set(k, k, k));
      cacti.setMatrixAt(i, m);
    });
    cacti.count = nc;
    cacti.castShadow = true;
    world.add(rocks, cacti);
  }

  // Collines / montagnes au loin
  const hillMat = new THREE.MeshStandardMaterial({ color: th.hill, roughness: 1, flatShading: true });
  const cx = T.PTS.reduce((a, b) => a + b.x, 0) / T.N, cz = T.PTS.reduce((a, b) => a + b.z, 0) / T.N;
  for (let i = 0; i < 46; i++) {
    const a = (i / 46) * Math.PI * 2 + rnd(-0.05, 0.05), r = rnd(1050, 1500), rad = rnd(140, 320);
    const hill = new THREE.Mesh(new THREE.SphereGeometry(rad, 10, 6), hillMat);
    hill.scale.y = th.deco === 'rocks' ? rnd(0.4, 0.8) : rnd(0.25, 0.55);
    hill.position.set(cx + Math.cos(a) * r, -10, cz + Math.sin(a) * r);
    world.add(hill);
  }

  // Ligne de départ, portique, tribune
  const sp = T.PTS[T.START], h = T.headingAt(T.START), n = T.NOR[T.START];
  const g = new THREE.Group();
  g.position.set(sp.x, 0, sp.z);
  g.rotation.y = h;
  const line = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, 2), new THREE.MeshStandardMaterial({ map: checkerTex, roughness: 0.8 }));
  line.rotation.x = -Math.PI / 2;
  line.position.y = 0.04;
  line.receiveShadow = true;
  g.add(line);
  for (const sx of [-1, 1]) {
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7, 0.5), metal);
    pole.position.set(sx * (HW + 2), 3.5, 0);
    pole.castShadow = true;
    g.add(pole);
  }
  const bannerTex = makeTex(512, 64, (c, w, hh) => {
    c.fillStyle = '#d7192f'; c.fillRect(0, 0, w, hh);
    c.fillStyle = '#fff'; c.font = 'italic 900 38px system-ui, sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(def.name.toUpperCase() + ' · START', w / 2, hh / 2 + 2);
  });
  const bMat = new THREE.MeshStandardMaterial({ map: bannerTex });
  const banner = new THREE.Mesh(new THREE.BoxGeometry(ROAD_W + 4.5, 1.6, 0.4), [metal, metal, metal, metal, bMat, bMat]);
  banner.position.y = 7;
  banner.castShadow = true;
  g.add(banner);
  world.add(g);

  const stand = new THREE.Group();
  stand.position.set(sp.x + n.x * (HW + 9), 0, sp.z + n.z * (HW + 9));
  stand.rotation.y = h;
  const seats = [0x1f5fbf, 0xe0e0e0, 0xd7192f];
  for (let i = 0; i < 6; i++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(2, 1 + i * 1.1, 60), concrete);
    step.position.set(i * 2, (1 + i * 1.1) / 2, 0);
    step.castShadow = step.receiveShadow = true;
    stand.add(step);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.4, 60), new THREE.MeshStandardMaterial({ color: seats[i % 3], roughness: 0.6 }));
    seat.position.set(i * 2 + 0.3, 1 + i * 1.1 + 0.2, 0);
    stand.add(seat);
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(14, 0.4, 62), metal);
  roof.position.set(5, 11, 0);
  roof.castShadow = true;
  stand.add(roof);
  for (const z of [-29, 0, 29]) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.4, 11, 0.4), metal);
    c.position.set(11, 5.5, z);
    stand.add(c);
  }
  world.add(stand);

  buildMinimapBase();
}

// ============================================================
//  VOITURE 3D (la même pour tout le monde, seule la couleur change)
// ============================================================
function buildCar(color) {
  const car = new THREE.Group();
  const body = new THREE.Group();
  car.add(body);
  const paint = new THREE.MeshPhysicalMaterial({ color, metalness: 0.5, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.08 });
  const black = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0d1620, metalness: 0.2, roughness: 0.05, clearcoat: 1 });
  const add = (geo, mat, x, y, z, parent = body) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  add(new THREE.BoxGeometry(1.95, 0.42, 4.5), paint, 0, 0.55, 0);
  add(new THREE.BoxGeometry(1.9, 0.18, 1.5), paint, 0, 0.82, 1.35);
  add(new THREE.BoxGeometry(1.55, 0.46, 2.0), glass, 0, 0.98, -0.25);
  add(new THREE.BoxGeometry(1.5, 0.06, 1.6), paint, 0, 1.23, -0.3);
  add(new THREE.BoxGeometry(2.0, 0.12, 0.5), black, 0, 0.36, 2.2);
  add(new THREE.BoxGeometry(1.9, 0.07, 0.45), black, 0, 1.2, -2.05);
  for (const sx of [-0.6, 0.6]) add(new THREE.BoxGeometry(0.08, 0.35, 0.2), black, sx, 0.98, -2.05);
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4d0, emissiveIntensity: 1.5 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff1010, emissiveIntensity: 0.6 });
  for (const sx of [-0.68, 0.68]) {
    add(new THREE.BoxGeometry(0.42, 0.1, 0.05), headMat, sx, 0.66, 2.26);
    add(new THREE.BoxGeometry(0.46, 0.12, 0.05), tailMat, sx, 0.64, -2.26);
  }
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 22).rotateZ(Math.PI / 2);
  const tire = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.85 });
  const rimGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.31, 10).rotateZ(Math.PI / 2);
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xb0b6bd, metalness: 0.9, roughness: 0.25 });
  const wheels = [];
  for (const [x, z, front] of [[0.92, 1.35, true], [-0.92, 1.35, true], [0.92, -1.4, false], [-0.92, -1.4, false]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.36, z);
    const spin = new THREE.Group();
    pivot.add(spin);
    add(wheelGeo, tire, 0, 0, 0, spin);
    add(rimGeo, rimMat, 0, 0, 0, spin);
    car.add(pivot);
    wheels.push({ pivot, spin, front });
  }
  car.userData = { body, wheels, tailMat };
  return car;
}

// ============================================================
//  RÉGLAGES DE LA COURSE (sauvegardés sur l'appareil)
// ============================================================
const settings = Object.assign(
  { track: 'vert', opponents: true, difficulty: 'moyen', count: 3 },
  JSON.parse(localStorage.getItem('circuit3d_settings') || '{}')
);
if (!TRACKS.find(t => t.id === settings.track)) settings.track = 'vert';
if (!DIFFICULTIES[settings.difficulty]) settings.difficulty = 'moyen';
const saveSettings = () => localStorage.setItem('circuit3d_settings', JSON.stringify(settings));
const trackDef = () => TRACKS.find(t => t.id === settings.track);

// ============================================================
//  ÉTAT DU JEU
// ============================================================
const player = makeCar();
player.mesh = buildCar(player.color);
scene.add(player.mesh);
let cars = [player];
let state = 'menu';          // menu | countdown | race | finished
let countdown = 0, raceTime = 0;
let finishOrder = [];

function setupGrid(withAI) {
  for (const c of cars) if (c !== player) scene.remove(c.mesh);
  cars = [];
  if (withAI) {
    for (let i = 0; i < settings.count; i++) {
      const ai = makeAI(settings.difficulty, i);
      ai.mesh = buildCar(ai.color);
      scene.add(ai.mesh);
      cars.push(ai);
    }
  }
  cars.push(player);                          // le joueur part en dernier
  const slots = gridSlots(T, cars.length);
  cars.forEach((c, k) => { resetRace(c); placeCar(c, T, slots[k].idx, slots[k].lat); });
  player.isAI = false;
  player.ai = null;
}

// ============================================================
//  COMMANDES
// ============================================================
const keys = new Set();
const touch = { left: false, right: false, gas: false, brake: false, hand: false };
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  keys.add(e.code);
  if (e.code === 'KeyR' && state === 'race') placeCar(player, T, player.idx, 0);
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
document.querySelectorAll('#touch [data-k]').forEach(b => {
  const k = b.dataset.k;
  const on = e => { e.preventDefault(); touch[k] = true; b.classList.add('on'); startAudio(); };
  const off = e => { e.preventDefault(); touch[k] = false; b.classList.remove('on'); };
  b.addEventListener('pointerdown', on);
  b.addEventListener('pointerup', off);
  b.addEventListener('pointercancel', off);
  b.addEventListener('pointerleave', off);
  b.addEventListener('contextmenu', e => e.preventDefault());
});
const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

function readInput() {
  if (player.done) return;                     // après l'arrivée, la voiture roule toute seule
  const k = c => keys.has(c), inp = player.input;
  const left = k('ArrowLeft') || k('KeyA') || touch.left;
  const right = k('ArrowRight') || k('KeyD') || touch.right;
  inp.steer = (left ? 1 : 0) - (right ? 1 : 0);
  inp.throttle = (k('ArrowUp') || k('KeyW') || touch.gas) ? 1 : 0;
  inp.brake = (k('ArrowDown') || k('KeyS') || touch.brake) ? 1 : 0;
  inp.hand = (k('Space') || touch.hand) ? 1 : 0;
  if (state !== 'race') inp.throttle = inp.brake = inp.hand = 0;
}

// ============================================================
//  SON MOTEUR (synthétisé)
// ============================================================
let audio = null, muted = false;
const GEARS = [0, 13, 24, 35, 46, 58, 80];
function startAudio() {
  if (audio) { if (audio.ctx.state === 'suspended') audio.ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  const ctx = new AC();
  const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
  o1.type = 'sawtooth'; o2.type = 'square';
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass'; filter.frequency.value = 900; filter.Q.value = 2;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  o1.connect(filter); o2.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
  o1.start(); o2.start();
  audio = { ctx, o1, o2, filter, gain };
}
function gearInfo(speed) {
  let g = 1;
  while (g < GEARS.length - 1 && speed > GEARS[g]) g++;
  const lo = GEARS[g - 1], hi = GEARS[g];
  return { gear: g, rpm: 0.2 + 0.8 * Math.min(1, (speed - lo) / (hi - lo)) };
}
function updateAudio(speed) {
  if (!audio) return;
  const { rpm } = gearInfo(speed);
  const t = audio.ctx.currentTime;
  const load = player.input.throttle ? 1 : 0.55;
  const f = 45 + rpm * 150;
  audio.o1.frequency.setTargetAtTime(f, t, 0.05);
  audio.o2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
  audio.filter.frequency.setTargetAtTime(500 + rpm * 1400 * load, t, 0.08);
  const vol = muted || state === 'menu' ? 0 : 0.035 + 0.035 * load;
  audio.gain.gain.setTargetAtTime(vol, t, 0.1);
}
document.getElementById('mute').addEventListener('click', e => {
  muted = !muted;
  e.currentTarget.textContent = muted ? '🔇' : '🔊';
});

// ============================================================
//  INTERFACE
// ============================================================
const $ = id => document.getElementById(id);
const fmt = ms => {
  if (!isFinite(ms)) return '--';
  const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000), x = Math.floor(ms % 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(x).padStart(3, '0')}`;
};
const ordinal = n => (n === 1 ? '1er' : n + 'e');
const hex = c => '#' + c.toString(16).padStart(6, '0');
let flashTimer = 0;
function flash(text, ms = 1800) {
  const el = $('msg');
  el.textContent = text;
  el.style.opacity = 1;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => (el.style.opacity = 0), ms);
}
$('laps').textContent = LAPS;

// --- Menu : choix du circuit / adversaires / difficulté ---
function segmented(containerId, options, current, onPick) {
  const box = $(containerId);
  box.innerHTML = '';
  for (const [value, label, sub] of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = value === current ? 'sel' : '';
    b.innerHTML = sub ? `<b></b><small></small>` : '';
    if (sub) { b.querySelector('b').textContent = label; b.querySelector('small').textContent = sub; }
    else b.textContent = label;
    b.addEventListener('click', () => onPick(value));
    box.appendChild(b);
  }
}
function renderMenu() {
  segmented('opt-track', TRACKS.map(t => [t.id, t.name, t.desc]), settings.track, v => {
    settings.track = v; saveSettings();
    buildWorld(trackDef()); setupGrid(false); renderMenu();
  });
  segmented('opt-opp', [[true, 'Oui'], [false, 'Non (seul)']], settings.opponents, v => {
    settings.opponents = v; saveSettings(); renderMenu();
  });
  segmented('opt-diff', Object.entries(DIFFICULTIES).map(([k, d]) => [k, d.label]), settings.difficulty, v => {
    settings.difficulty = v; saveSettings(); renderMenu();
  });
  segmented('opt-count', [1, 2, 3, 4, 5].map(n => [n, String(n)]), settings.count, v => {
    settings.count = v; saveSettings(); renderMenu();
  });
  $('ai-options').classList.toggle('hidden', !settings.opponents);
  $('lb-title').textContent = trackDef().name;
  renderLeaderboard('lb-menu');
}

// --- Mini-carte ---
const mm = $('minimap'), mctx = mm.getContext('2d');
const mmBase = document.createElement('canvas');
mmBase.width = mm.width; mmBase.height = mm.height;
let toMM = () => [0, 0];
function buildMinimapBase() {
  const xs = T.PTS.map(p => p.x), zs = T.PTS.map(p => p.z);
  const minX = Math.min(...xs), minZ = Math.min(...zs);
  const sc = (mm.width - 20) / Math.max(Math.max(...xs) - minX, Math.max(...zs) - minZ);
  toMM = (x, z) => [10 + (x - minX) * sc, 10 + (z - minZ) * sc];
  const g = mmBase.getContext('2d');
  g.clearRect(0, 0, mm.width, mm.height);
  g.lineJoin = 'round';
  for (const [w, c] of [[7, '#fff'], [4, '#555']]) {
    g.beginPath();
    T.PTS.forEach((p, i) => { const [x, y] = toMM(p.x, p.z); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.closePath(); g.lineWidth = w; g.strokeStyle = c; g.stroke();
  }
  const [sx, sy] = toMM(T.PTS[T.START].x, T.PTS[T.START].z);
  g.fillStyle = '#ffd54a'; g.fillRect(sx - 3, sy - 3, 6, 6);
}
function drawMinimap() {
  mctx.clearRect(0, 0, mm.width, mm.height);
  mctx.drawImage(mmBase, 0, 0);
  for (const c of [...cars.filter(o => o !== player), player]) {   // le joueur dessiné par-dessus
    const [x, y] = toMM(c.x, c.z);
    mctx.beginPath(); mctx.arc(x, y, c === player ? 5 : 4, 0, Math.PI * 2);
    mctx.fillStyle = hex(c.color); mctx.fill();
    mctx.lineWidth = c === player ? 2 : 1; mctx.strokeStyle = c === player ? '#fff' : '#000'; mctx.stroke();
  }
}

// --- Classements ---
function ranking() {
  return [...cars].sort((a, b) => {
    if (a.done && b.done) return a.finishTime - b.finishTime;
    if (a.done) return -1;
    if (b.done) return 1;
    return progress(b, T) - progress(a, T);
  });
}

async function renderLeaderboard(listId, highlight) {
  const ol = $(listId);
  ol.innerHTML = '<li class="empty">Chargement…</li>';
  try {
    const rows = await fetchTop(trackDef().collection, 10);
    ol.innerHTML = '';
    if (!rows.length) ol.innerHTML = '<li class="empty">Aucun temps sur ce circuit. Sois le premier !</li>';
    for (const r of rows) {
      const li = document.createElement('li');
      li.textContent = r.name;
      const span = document.createElement('span');
      span.textContent = fmt(r.time);
      li.appendChild(span);
      if (highlight && r.name === highlight.name && r.time === highlight.time) li.classList.add('me');
      ol.appendChild(li);
    }
  } catch (e) {
    console.error(e);
    ol.innerHTML = '<li class="empty">Classement indisponible (vérifie Firebase).</li>';
  }
}

function renderResults() {
  const ol = $('results');
  ol.innerHTML = '';
  ranking().forEach(c => {
    const li = document.createElement('li');
    if (c === player) li.classList.add('me');
    const dot = document.createElement('i');
    dot.style.background = hex(c.color);
    li.appendChild(dot);
    li.appendChild(document.createTextNode(c.name));
    const span = document.createElement('span');
    span.textContent = c.done ? fmt(c.finishTime) : 'en course…';
    li.appendChild(span);
    ol.appendChild(li);
  });
}

// --- Déroulement ---
function startRace() {
  startAudio();
  buildWorldIfNeeded();
  $('menu').classList.add('hidden');
  $('end').classList.add('hidden');
  $('hud').classList.remove('hidden');
  if (isTouch) $('touch').classList.remove('hidden');
  setupGrid(settings.opponents);
  $('pos-row').classList.toggle('hidden', cars.length === 1);
  $('save').classList.remove('done');
  raceTime = 0;
  finishOrder = [];
  countdown = 3.999;
  state = 'countdown';
  camera.position.set(player.x - Math.sin(player.h) * 8, 3.1, player.z - Math.cos(player.h) * 8);
}
function buildWorldIfNeeded() {
  if (!T || T.def.id !== settings.track) buildWorld(trackDef());
}

function onLapEvent(c, ev) {
  if (ev === 'finish') {
    finishOrder.push(c);
    if (c === player) finishRace();
    else if (state === 'finished') renderResults();
    return;
  }
  if (c === player) {
    flash(`Tour ${c.lapsDone} : ${fmt(c.lastLap)}${c.lastLap <= c.bestLap ? ' ★' : ''}`);
  }
}

function finishRace() {
  state = 'finished';
  const pos = finishOrder.indexOf(player) + 1;
  // Après l'arrivée, la voiture du joueur roule toute seule tranquillement
  player.ai = { latA: 12, brakeA: 15, lane: 0, curLane: player.lat, stuck: 0 };
  const solo = cars.length === 1;
  flash(solo ? '🏁 ARRIVÉE !' : pos === 1 ? '🏆 VICTOIRE !' : `🏁 ${ordinal(pos)} / ${cars.length}`, 1500);
  setTimeout(() => {
    $('touch').classList.add('hidden');
    $('end-title').textContent = solo ? 'ARRIVÉE' : pos === 1 ? 'VICTOIRE !' : `${ordinal(pos)} SUR ${cars.length}`;
    $('total').textContent = fmt(player.finishTime);
    $('bestlap').textContent = fmt(player.bestLap);
    $('results-box').classList.toggle('hidden', solo);
    renderResults();
    $('name').value = localStorage.getItem('circuit3d_name') || '';
    $('lb-end-title').textContent = trackDef().name;
    $('end').classList.remove('hidden');
    renderLeaderboard('lb-end');
  }, 1500);
}

function backToMenu() {
  state = 'menu';
  $('end').classList.add('hidden');
  $('hud').classList.add('hidden');
  $('touch').classList.add('hidden');
  $('menu').classList.remove('hidden');
  setupGrid(false);
  renderMenu();
}

$('play').addEventListener('click', startRace);
$('again').addEventListener('click', startRace);
$('to-menu').addEventListener('click', backToMenu);
$('save').addEventListener('submit', async e => {
  e.preventDefault();
  const name = $('name').value.trim().slice(0, 16);
  if (!name) return;
  localStorage.setItem('circuit3d_name', name);
  $('save').classList.add('done');
  try {
    await submitTime(trackDef().collection, name, player.finishTime, player.bestLap);
  } catch (err) {
    console.error(err);
    flash('Erreur d’enregistrement', 2500);
    $('save').classList.remove('done');
    return;
  }
  renderLeaderboard('lb-end', { name, time: Math.round(player.finishTime) });
});

// ============================================================
//  BOUCLE PRINCIPALE
// ============================================================
const camLook = new THREE.Vector3(), tmp = new THREE.Vector3();
let menuAngle = 0, last = performance.now(), acc = 0;
const STEP = 1 / 120;

function updateCarVisual(c, dt) {
  c.mesh.position.set(c.x, 0, c.z);
  c.mesh.rotation.y = c.h;
  const { body, wheels, tailMat } = c.mesh.userData;
  const roll = THREE.MathUtils.clamp(c.yaw * c.vF * 0.0028, -0.07, 0.07);
  const pitch = THREE.MathUtils.clamp(-c.accel * 0.0035, -0.05, 0.05);
  body.rotation.z += (roll - body.rotation.z) * Math.min(1, dt * 6);
  body.rotation.x += (pitch - body.rotation.x) * Math.min(1, dt * 6);
  for (const w of wheels) {
    w.spin.rotation.x += (c.vF * dt) / 0.36;
    if (w.front) w.pivot.rotation.y = c.angle;
  }
  tailMat.emissiveIntensity = c.input.brake > 0 && c.vF > 0.5 ? 3 : 0.6;
}

function updateCamera(dt) {
  const fx = Math.sin(player.h), fz = Math.cos(player.h);
  if (state === 'menu') {
    menuAngle += dt * 0.25;
    camera.position.set(player.x + Math.cos(menuAngle) * 9, 2.6, player.z + Math.sin(menuAngle) * 9);
    camera.lookAt(player.x, 0.8, player.z);
    camera.fov = 50;
  } else {
    tmp.set(player.x - fx * 7.8, 3.1, player.z - fz * 7.8);
    camera.position.lerp(tmp, 1 - Math.exp(-7 * dt));
    camLook.set(player.x + fx * 5, 1.1, player.z + fz * 5);
    camera.lookAt(camLook);
    camera.fov = 60 + Math.min(18, Math.abs(player.vF) * 0.22);
  }
  camera.updateProjectionMatrix();
  sky.position.copy(camera.position);
  sun.position.set(player.x, 0, player.z).add(SUN_OFFSET);
  sun.target.position.set(player.x, 0, player.z);
}

let hudTimer = 0;
function updateHUD(dt) {
  $('speed').textContent = Math.round(Math.abs(player.vF) * 3.6);
  $('gear').textContent = player.vF < -0.5 ? 'R' : gearInfo(Math.abs(player.vF)).gear;
  $('lap').textContent = Math.min(player.lapsDone + 1, LAPS);
  $('time').textContent = fmt(player.done ? player.finishTime : raceTime);
  $('best').textContent = fmt(player.bestLap);
  hudTimer -= dt;
  if (cars.length > 1 && hudTimer <= 0) {
    hudTimer = 0.25;
    $('pos').textContent = ranking().indexOf(player) + 1;
    $('pos-total').textContent = cars.length;
  }
  drawMinimap();
}

function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  readInput();

  if (state === 'countdown') {
    countdown -= dt;
    const c = Math.ceil(countdown);
    $('countdown').textContent = c > 0 ? c : '';
    if (countdown <= 0) {
      state = 'race';
      $('countdown').textContent = '';
      flash('GO !', 900);
    }
  }
  const racing = state === 'race' || state === 'finished';
  if (racing) raceTime += dt * 1000;

  if (state !== 'menu') {
    acc += dt;
    while (acc >= STEP) {
      for (const c of cars) {
        if (c.ai) aiControl(c, cars, T, STEP, racing);
        physics(c, STEP);
        trackQuery(c, T);
        if (racing) {
          const ev = lapLogic(c, T, raceTime);
          if (ev) onLapEvent(c, ev);
        }
      }
      collide(cars);
      acc -= STEP;
    }
    updateHUD(dt);
  }
  for (const c of cars) updateCarVisual(c, dt);
  updateCamera(dt);
  updateAudio(Math.abs(player.vF));
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ============================================================
//  DÉMARRAGE
// ============================================================
buildWorld(trackDef());
setupGrid(false);
renderMenu();
requestAnimationFrame(loop);
initLeaderboard().then(online => {
  $('lbmode').textContent = online ? '(en ligne)' : '(sur cet appareil)';
  renderLeaderboard('lb-menu');
});
