import * as THREE from 'three';
import { initLeaderboard, isOnline, submitTime, fetchTop } from './leaderboard.js';

// ============================================================
//  RÉGLAGES (modifie-les pour changer le jeu)
// ============================================================
const LAPS = 3;            // nombre de tours
const ROAD_W = 14;         // largeur de la piste (m)
const CURB_W = 1.4;        // largeur des vibreurs (m)
const SAMPLES = 900;       // précision du tracé
const SCALE = 1.4;         // taille du circuit
const CAR = {
  maxSpeed: 72,            // m/s (~260 km/h)
  engine: 9.5,             // accélération (m/s²)
  brake: 26,               // freinage (m/s²)
  grip: 8,                 // adhérence latérale
  gripDrift: 1.2,          // adhérence au frein à main
  wheelBase: 2.6
};
// Points du circuit (x, z) — ajoute/déplace des points pour créer ton propre tracé
const TRACK_POINTS = [
  [0, 0], [0, -120], [30, -200], [110, -230], [200, -200], [240, -130], [210, -60],
  [150, -40], [130, 20], [180, 80], [260, 90], [300, 160], [260, 240], [160, 250],
  [60, 220], [-20, 250], [-110, 230], [-150, 150], [-120, 80], [-60, 60], [-20, 30]
];

const HW = ROAD_W / 2;

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
const FOG = new THREE.Color(0xd3e3ef);
scene.fog = new THREE.Fog(FOG, 200, 1400);
scene.background = FOG;

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 4000);

// Ciel en dégradé
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(3000, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x2f6fc4) }, bottom: { value: FOG } },
    vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 bottom; varying vec3 vP;
      void main(){ float h = clamp(vP.y, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, pow(h, 0.55)), 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`
  })
);
scene.add(sky);

// Lumières
scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x4d5a3a, 1.1));
const sun = new THREE.DirectionalLight(0xfff0d8, 3.0);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 400 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
const SUN_OFFSET = new THREE.Vector3(70, 120, 45);

// ============================================================
//  TEXTURES (générées par code, pas besoin d'images)
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
  // traces de pneus plus sombres
  g.fillStyle = 'rgba(0,0,0,0.12)';
  g.fillRect(w * 0.28, 0, w * 0.1, h); g.fillRect(w * 0.62, 0, w * 0.1, h);
  // lignes
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
    const r = rnd(50, 95) | 0, gg = rnd(100, 150) | 0, b = rnd(30, 55) | 0;
    g.fillStyle = `rgba(${r},${gg},${b},0.55)`;
    g.fillRect(Math.random() * w, Math.random() * h, 1.2, rnd(2, 5));
  }
}, 400, 400);
const checkerTex = makeTex(128, 16, (g, w, h) => {
  const s = 8;
  for (let x = 0; x < w / s; x++) for (let y = 0; y < h / s; y++) {
    g.fillStyle = (x + y) % 2 ? '#111' : '#f5f5f5';
    g.fillRect(x * s, y * s, s, s);
  }
});

// ============================================================
//  CIRCUIT
// ============================================================
const curve = new THREE.CatmullRomCurve3(
  TRACK_POINTS.map(([x, z]) => new THREE.Vector3(x * SCALE, 0, z * SCALE)), true, 'centripetal');
const PTS = curve.getSpacedPoints(SAMPLES).slice(0, SAMPLES);
const N = PTS.length;
const TAN = [], NOR = [], DIST = [0];
for (let i = 0; i < N; i++) {
  const t = PTS[(i + 1) % N].clone().sub(PTS[(i - 1 + N) % N]).normalize();
  TAN.push(t);
  NOR.push(new THREE.Vector3(t.z, 0, -t.x));
  if (i > 0) DIST.push(DIST[i - 1] + PTS[i].distanceTo(PTS[i - 1]));
}
DIST.push(DIST[N - 1] + PTS[0].distanceTo(PTS[N - 1]));
const TRACK_LEN = DIST[N];
const START = Math.round(60 / (TRACK_LEN / N)); // ligne de départ à 60 m du début
const headingAt = i => Math.atan2(TAN[i].x, TAN[i].z);

// Bande de géométrie le long du circuit, entre les décalages latéraux a et b
function ribbon(a, b, y, material, vLen) {
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
  scene.add(m);
  return m;
}

const roadMat = new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.92, metalness: 0 });
const curbMat = new THREE.MeshStandardMaterial({ map: curbTex, roughness: 0.7 });
ribbon(-HW, HW, 0.03, roadMat, 12);
ribbon(-HW - CURB_W, -HW, 0.05, curbMat, 3);
ribbon(HW, HW + CURB_W, 0.05, curbMat, 3);

// Herbe
const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000),
  new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// Distance minimale d'un point au circuit (pour placer le décor)
function distToTrack(x, z) {
  let best = Infinity;
  for (let i = 0; i < N; i += 3) {
    const dx = PTS[i].x - x, dz = PTS[i].z - z;
    const d = dx * dx + dz * dz;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

// Arbres
{
  const box = new THREE.Box3().setFromPoints(PTS).expandByScalar(250);
  const COUNT = 700;
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.35, 2.4, 6).translate(0, 1.2, 0);
  const leafGeo = new THREE.ConeGeometry(1.9, 5.5, 7).translate(0, 4.9, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x5a3d26, roughness: 1 }), COUNT);
  const leaves = new THREE.InstancedMesh(leafGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }), COUNT);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const col = new THREE.Color();
  let placed = 0, tries = 0;
  while (placed < COUNT && tries < 20000) {
    tries++;
    const x = rnd(box.min.x, box.max.x), z = rnd(box.min.z, box.max.z);
    if (distToTrack(x, z) < HW + 14) continue;
    const k = rnd(0.7, 1.7);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd(0, Math.PI * 2));
    m.compose(p.set(x, 0, z), q, s.set(k, k * rnd(0.85, 1.25), k));
    trunks.setMatrixAt(placed, m);
    leaves.setMatrixAt(placed, m);
    leaves.setColorAt(placed, col.setHSL(rnd(0.24, 0.33), rnd(0.35, 0.55), rnd(0.18, 0.3)));
    placed++;
  }
  trunks.count = leaves.count = placed;
  trunks.castShadow = leaves.castShadow = true;
  scene.add(trunks, leaves);
}

// Collines au loin
{
  const mat = new THREE.MeshStandardMaterial({ color: 0x56704a, roughness: 1, flatShading: true });
  const center = new THREE.Box3().setFromPoints(PTS).getCenter(new THREE.Vector3());
  for (let i = 0; i < 46; i++) {
    const a = (i / 46) * Math.PI * 2 + rnd(-0.05, 0.05), r = rnd(1050, 1500), rad = rnd(140, 320);
    const hill = new THREE.Mesh(new THREE.SphereGeometry(rad, 10, 6), mat);
    hill.scale.y = rnd(0.25, 0.55);
    hill.position.set(center.x + Math.cos(a) * r, -10, center.z + Math.sin(a) * r);
    scene.add(hill);
  }
}

// Ligne de départ, portique et tribune
{
  const p = PTS[START], h = headingAt(START), n = NOR[START];
  const g = new THREE.Group();
  g.position.copy(p);
  g.rotation.y = h;
  const line = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, 2), new THREE.MeshStandardMaterial({ map: checkerTex, roughness: 0.8 }));
  line.rotation.x = -Math.PI / 2;
  line.position.y = 0.04;
  line.receiveShadow = true;
  g.add(line);
  const metal = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.7, roughness: 0.35 });
  for (const sx of [-1, 1]) {
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7, 0.5), metal);
    pole.position.set(sx * (HW + 2), 3.5, 0);
    pole.castShadow = true;
    g.add(pole);
  }
  const bannerTex = makeTex(512, 64, (c, w, hh) => {
    c.fillStyle = '#d7192f'; c.fillRect(0, 0, w, hh);
    c.fillStyle = '#fff'; c.font = 'italic 900 40px system-ui, sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('CIRCUIT 3D · START / FINISH', w / 2, hh / 2 + 2);
  });
  const banner = new THREE.Mesh(new THREE.BoxGeometry(ROAD_W + 4.5, 1.6, 0.4),
    [metal, metal, metal, metal, new THREE.MeshStandardMaterial({ map: bannerTex }), new THREE.MeshStandardMaterial({ map: bannerTex })]);
  banner.position.y = 7;
  banner.castShadow = true;
  g.add(banner);
  scene.add(g);

  // Tribune
  const stand = new THREE.Group();
  stand.position.copy(p).addScaledVector(n, HW + 9);
  stand.rotation.y = h;
  const concrete = new THREE.MeshStandardMaterial({ color: 0xb8b8b0, roughness: 0.9 });
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
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.4, 11, 0.4), metal);
    col.position.set(11, 5.5, z);
    stand.add(col);
  }
  scene.add(stand);
}

// ============================================================
//  VOITURE
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
  add(new THREE.BoxGeometry(1.95, 0.42, 4.5), paint, 0, 0.55, 0);           // caisse
  add(new THREE.BoxGeometry(1.9, 0.18, 1.5), paint, 0, 0.82, 1.35);         // capot
  add(new THREE.BoxGeometry(1.55, 0.46, 2.0), glass, 0, 0.98, -0.25);       // habitacle
  add(new THREE.BoxGeometry(1.5, 0.06, 1.6), paint, 0, 1.23, -0.3);         // toit
  add(new THREE.BoxGeometry(2.0, 0.12, 0.5), black, 0, 0.36, 2.2);          // lame avant
  add(new THREE.BoxGeometry(1.9, 0.07, 0.45), black, 0, 1.2, -2.05);        // aileron
  for (const sx of [-0.6, 0.6]) add(new THREE.BoxGeometry(0.08, 0.35, 0.2), black, sx, 0.98, -2.05);
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4d0, emissiveIntensity: 1.5 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff1010, emissiveIntensity: 0.6 });
  for (const sx of [-0.68, 0.68]) {
    add(new THREE.BoxGeometry(0.42, 0.1, 0.05), headMat, sx, 0.66, 2.26);
  }
  const tails = [-0.68, 0.68].map(sx => add(new THREE.BoxGeometry(0.46, 0.12, 0.05), tailMat, sx, 0.64, -2.26));

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
  car.userData = { body, wheels, tailMat, tails };
  return car;
}
const carMesh = buildCar(0xc8102e);
scene.add(carMesh);

// ============================================================
//  ÉTAT DU JEU
// ============================================================
const car = { x: 0, z: 0, h: 0, vx: 0, vz: 0, vF: 0, steer: 0, angle: 0, yaw: 0, accel: 0, idx: 0, lat: 0, offroad: false };
let state = 'menu';         // menu | countdown | race | finished
let countdown = 0, raceTime = 0, lapStart = 0, lap = 1, bestLap = Infinity, nextCp = 0;
const CPS = [0.25, 0.5, 0.75].map(f => Math.round(f * N));
const rel = i => (i - START + N) % N;

function placeCar(i) {
  car.idx = i;
  car.x = PTS[i].x; car.z = PTS[i].z;
  car.h = headingAt(i);
  car.vx = car.vz = car.vF = car.steer = 0;
}

// ============================================================
//  COMMANDES
// ============================================================
const keys = new Set();
const touch = { left: false, right: false, gas: false, brake: false, hand: false };
const input = { steer: 0, throttle: 0, brake: 0, hand: 0 };
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  keys.add(e.code);
  if (e.code === 'KeyR' && state === 'race') resetToTrack();
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
  const k = c => keys.has(c);
  const left = k('ArrowLeft') || k('KeyA') || touch.left;
  const right = k('ArrowRight') || k('KeyD') || touch.right;
  input.steer = (left ? 1 : 0) - (right ? 1 : 0);
  input.throttle = (k('ArrowUp') || k('KeyW') || touch.gas) ? 1 : 0;
  input.brake = (k('ArrowDown') || k('KeyS') || touch.brake) ? 1 : 0;
  input.hand = (k('Space') || touch.hand) ? 1 : 0;
  if (state !== 'race') input.throttle = input.brake = input.hand = 0;
  if (state === 'finished') input.brake = 0.3;
}

function resetToTrack() {
  placeCar(car.idx);
}

// ============================================================
//  PHYSIQUE
// ============================================================
function physics(dt) {
  const fx = Math.sin(car.h), fz = Math.cos(car.h);
  const rx = -Math.cos(car.h), rz = Math.sin(car.h);
  let vF = car.vx * fx + car.vz * fz;   // vitesse vers l'avant
  let vR = car.vx * rx + car.vz * rz;   // glissement latéral
  const { throttle: thr, brake: brk, hand: hb } = input;
  const maxV = car.offroad ? 30 : CAR.maxSpeed;

  let a = 0;
  if (thr > 0) a += vF < -0.5 ? 20 * thr : thr * CAR.engine * Math.max(0, 1 - (vF / maxV) ** 2);
  if (brk > 0) a -= vF > 0.5 ? CAR.brake * brk : 7 * brk * Math.max(0, 1 + vF / 14);
  if (!thr && !brk) a -= Math.sign(vF) * 1.6;               // frein moteur
  a -= vF * 0.02 + 0.0003 * vF * Math.abs(vF);              // frottements + air
  if (car.offroad) a -= vF * 0.35;                          // herbe
  if (hb) a -= Math.sign(vF) * 6;
  vF += a * dt;
  if (!thr && !brk && Math.abs(vF) < 0.3) vF = 0;

  const grip = hb ? CAR.gripDrift : car.offroad ? 3.5 : CAR.grip;
  vR *= Math.exp(-grip * dt);

  // Direction : plus on va vite, moins les roues braquent
  const target = input.steer;
  car.steer += (target - car.steer) * Math.min(1, dt * (target === 0 ? 7 : 3.5));
  const speed = Math.abs(vF);
  car.angle = car.steer * 0.62 / (1 + Math.pow(speed / 14, 1.3));
  let yaw = vF * Math.tan(car.angle) / CAR.wheelBase;
  if (hb) yaw *= 1.35;

  // La vitesse reste dans l'ancien repère, la voiture pivote : c'est ce qui crée la glisse
  car.vx = fx * vF + rx * vR;
  car.vz = fz * vF + rz * vR;
  car.h += yaw * dt;
  car.x += car.vx * dt;
  car.z += car.vz * dt;
  car.vF = vF; car.accel = a; car.yaw = yaw;
}

function trackQuery() {
  let best = Infinity, bi = car.idx;
  for (let d = -40; d <= 40; d++) {
    const i = (car.idx + d + N) % N;
    const dx = PTS[i].x - car.x, dz = PTS[i].z - car.z;
    const dd = dx * dx + dz * dz;
    if (dd < best) { best = dd; bi = i; }
  }
  // Si on s'est perdu (très loin), on cherche sur tout le circuit
  if (best > 60 * 60) {
    for (let i = 0; i < N; i++) {
      const dx = PTS[i].x - car.x, dz = PTS[i].z - car.z;
      const dd = dx * dx + dz * dz;
      if (dd < best) { best = dd; bi = i; }
    }
  }
  car.idx = bi;
  const n = NOR[bi];
  car.lat = (car.x - PTS[bi].x) * n.x + (car.z - PTS[bi].z) * n.z;
  car.offroad = Math.abs(car.lat) > HW + CURB_W;
  // Limite du terrain : on ne peut pas s'éloigner de plus de 40 m
  const lim = HW + 40;
  if (Math.abs(car.lat) > lim) {
    const over = Math.abs(car.lat) - lim;
    car.x -= n.x * over * Math.sign(car.lat);
    car.z -= n.z * over * Math.sign(car.lat);
    car.vx *= 0.5; car.vz *= 0.5;
  }
}

function lapLogic() {
  if (state !== 'race') return;
  const r = rel(car.idx);
  if (nextCp < 3 && r >= CPS[nextCp] && r < CPS[nextCp] + 40) nextCp++;
  if (nextCp === 3 && r < 30) {
    const t = raceTime - lapStart;
    const isBest = t < bestLap;
    bestLap = Math.min(bestLap, t);
    lapStart = raceTime;
    nextCp = 0;
    if (lap >= LAPS) return finishRace();
    lap++;
    flash(`Tour ${lap - 1} : ${fmt(t)}${isBest ? ' ★' : ''}`);
  }
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
  const load = input.throttle ? 1 : 0.55;
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
let flashTimer = 0;
function flash(text, ms = 1800) {
  const el = $('msg');
  el.textContent = text;
  el.style.opacity = 1;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => (el.style.opacity = 0), ms);
}
$('laps').textContent = LAPS;

// Mini-carte
const mm = $('minimap'), mctx = mm.getContext('2d');
const mmBase = document.createElement('canvas');
mmBase.width = mm.width; mmBase.height = mm.height;
const bounds = new THREE.Box3().setFromPoints(PTS);
const mmScale = (mm.width - 20) / Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z);
const toMM = (x, z) => [10 + (x - bounds.min.x) * mmScale, 10 + (z - bounds.min.z) * mmScale];
{
  const g = mmBase.getContext('2d');
  g.lineJoin = 'round';
  for (const [w, c] of [[7, '#fff'], [4, '#555']]) {
    g.beginPath();
    PTS.forEach((p, i) => { const [x, y] = toMM(p.x, p.z); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.closePath(); g.lineWidth = w; g.strokeStyle = c; g.stroke();
  }
  const [sx, sy] = toMM(PTS[START].x, PTS[START].z);
  g.fillStyle = '#ffd54a'; g.fillRect(sx - 3, sy - 3, 6, 6);
}
function drawMinimap() {
  mctx.clearRect(0, 0, mm.width, mm.height);
  mctx.drawImage(mmBase, 0, 0);
  const [x, y] = toMM(car.x, car.z);
  mctx.beginPath(); mctx.arc(x, y, 5, 0, Math.PI * 2);
  mctx.fillStyle = '#ff2a3a'; mctx.fill();
  mctx.lineWidth = 2; mctx.strokeStyle = '#fff'; mctx.stroke();
}

async function renderLeaderboard(listId, highlight) {
  const ol = $(listId);
  ol.innerHTML = '<li class="empty">Chargement…</li>';
  try {
    const rows = await fetchTop(10);
    ol.innerHTML = '';
    if (!rows.length) ol.innerHTML = '<li class="empty">Aucun temps pour l’instant. Sois le premier !</li>';
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

function startRace() {
  startAudio();
  $('menu').classList.add('hidden');
  $('end').classList.add('hidden');
  $('hud').classList.remove('hidden');
  if (isTouch) $('touch').classList.remove('hidden');
  placeCar((START - 8 + N) % N);
  lap = 1; raceTime = 0; lapStart = 0; bestLap = Infinity; nextCp = 0;
  countdown = 3.999;
  state = 'countdown';
  $('save').classList.remove('done');
}

let finalTime = 0;
function finishRace() {
  state = 'finished';
  finalTime = raceTime;
  flash('🏁 ARRIVÉE !', 1500);
  setTimeout(() => {
    $('touch').classList.add('hidden');
    $('total').textContent = fmt(finalTime);
    $('bestlap').textContent = fmt(bestLap);
    $('name').value = localStorage.getItem('circuit3d_name') || '';
    $('end').classList.remove('hidden');
    renderLeaderboard('lb-end');
  }, 1500);
}

$('play').addEventListener('click', startRace);
$('again').addEventListener('click', startRace);
$('save').addEventListener('submit', async e => {
  e.preventDefault();
  const name = $('name').value.trim().slice(0, 16);
  if (!name) return;
  localStorage.setItem('circuit3d_name', name);
  $('save').classList.add('done');
  try {
    await submitTime(name, finalTime, bestLap);
  } catch (err) {
    console.error(err);
    flash('Erreur d’enregistrement', 2500);
    $('save').classList.remove('done');
    return;
  }
  renderLeaderboard('lb-end', { name, time: Math.round(finalTime) });
});

// ============================================================
//  BOUCLE PRINCIPALE
// ============================================================
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), tmp = new THREE.Vector3();
let menuAngle = 0, last = performance.now(), acc = 0;
const STEP = 1 / 120;

function updateCarVisual(dt) {
  carMesh.position.set(car.x, 0, car.z);
  carMesh.rotation.y = car.h;
  const { body, wheels, tailMat } = carMesh.userData;
  const roll = THREE.MathUtils.clamp(car.yaw * car.vF * 0.0028, -0.07, 0.07);
  const pitch = THREE.MathUtils.clamp(-car.accel * 0.0035, -0.05, 0.05);
  body.rotation.z += (roll - body.rotation.z) * Math.min(1, dt * 6);
  body.rotation.x += (pitch - body.rotation.x) * Math.min(1, dt * 6);
  for (const w of wheels) {
    w.spin.rotation.x += (car.vF * dt) / 0.36;
    if (w.front) w.pivot.rotation.y = car.angle;
  }
  tailMat.emissiveIntensity = input.brake > 0 && car.vF > 0.5 ? 3 : 0.6;
}

function updateCamera(dt) {
  const fx = Math.sin(car.h), fz = Math.cos(car.h);
  if (state === 'menu') {
    menuAngle += dt * 0.25;
    camPos.set(car.x + Math.cos(menuAngle) * 9, 2.6, car.z + Math.sin(menuAngle) * 9);
    camera.position.copy(camPos);
    camera.lookAt(car.x, 0.8, car.z);
    camera.fov = 50;
  } else {
    tmp.set(car.x - fx * 7.8, 3.1, car.z - fz * 7.8);
    camera.position.lerp(tmp, 1 - Math.exp(-7 * dt));
    camLook.set(car.x + fx * 5, 1.1, car.z + fz * 5);
    camera.lookAt(camLook);
    camera.fov = 60 + Math.min(18, Math.abs(car.vF) * 0.22);
  }
  camera.updateProjectionMatrix();
  sky.position.copy(camera.position);
  sun.position.set(car.x, 0, car.z).add(SUN_OFFSET);
  sun.target.position.set(car.x, 0, car.z);
}

function updateHUD() {
  const kmh = Math.abs(car.vF) * 3.6;
  $('speed').textContent = Math.round(kmh);
  $('gear').textContent = car.vF < -0.5 ? 'R' : gearInfo(Math.abs(car.vF)).gear;
  $('lap').textContent = Math.min(lap, LAPS);
  $('time').textContent = fmt(raceTime);
  $('best').textContent = fmt(bestLap);
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
  if (state === 'race') raceTime += dt * 1000;

  if (state !== 'menu') {
    acc += dt;
    while (acc >= STEP) {
      physics(STEP);
      trackQuery();
      lapLogic();
      acc -= STEP;
    }
    updateHUD();
  }
  updateCarVisual(dt);
  updateCamera(dt);
  updateAudio(Math.abs(car.vF));
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Démarrage
placeCar((START - 8 + N) % N);
requestAnimationFrame(loop);
initLeaderboard().then(online => {
  $('lbmode').textContent = online ? '(en ligne)' : '(sur cet appareil — Firebase pas encore configuré)';
  renderLeaderboard('lb-menu');
});
