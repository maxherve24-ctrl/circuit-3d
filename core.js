// ============================================================
//  CŒUR DU JEU : circuits, physique, IA (sans 3D, testable seul)
// ============================================================

export const ROAD_W = 14;        // largeur de la piste (m)
export const HW = ROAD_W / 2;
export const CURB_W = 1.4;       // largeur des vibreurs (m)
export const SAMPLES = 900;      // précision du tracé
export const LAPS = 3;           // nombre de tours

export const CAR = {
  maxSpeed: 72,                  // m/s (~260 km/h)
  engine: 9.5,                   // accélération (m/s²)
  brake: 26,                     // freinage (m/s²)
  grip: 8,                       // adhérence latérale
  gripDrift: 1.2,                // adhérence au frein à main
  wheelBase: 2.6
};

// Niveaux de l'IA : latA = vitesse en virage, vmax = % de la vitesse max, engine = puissance
export const DIFFICULTIES = {
  facile:    { label: 'Facile',    latA: 12, vmax: 0.85, engine: 0.88, brakeA: 15 },
  moyen:     { label: 'Moyen',     latA: 21, vmax: 0.94, engine: 0.97, brakeA: 19 },
  difficile: { label: 'Difficile', latA: 34, vmax: 1.00, engine: 1.05, brakeA: 23 }
};

export const AI_COLORS = [0x1f5fbf, 0xf2b705, 0x1a9e4b, 0xeeeeee, 0x7b2fbe];
export const AI_NAMES = ['Bleu', 'Jaune', 'Vert', 'Blanc', 'Violet'];

// Les circuits : ajoute-en un en copiant un bloc !
export const TRACKS = [
  {
    id: 'vert', name: 'Circuit Vert', desc: 'Le circuit d’origine, technique et varié',
    collection: 'scores', scale: 1.4, theme: 'vert',
    points: [
      [0, 0], [0, -120], [30, -200], [110, -230], [200, -200], [240, -130], [210, -60],
      [150, -40], [130, 20], [180, 80], [260, 90], [300, 160], [260, 240], [160, 250],
      [60, 220], [-20, 250], [-110, 230], [-150, 150], [-120, 80], [-60, 60], [-20, 30]
    ]
  },
  {
    id: 'ovale', name: 'Speedway', desc: 'Ovale ultra rapide au coucher du soleil',
    collection: 'scores_ovale', scale: 1.5, theme: 'sunset',
    points: [
      [0, 0], [0, -200], [20, -260], [80, -290], [140, -260], [160, -200],
      [160, 0], [140, 60], [80, 90], [20, 60]
    ]
  },
  {
    id: 'desert', name: 'Canyon Désert', desc: 'Sinueux, entre sable et rochers',
    collection: 'scores_desert', scale: 1.3, theme: 'desert',
    points: [
      [0, 0], [0, -100], [40, -160], [110, -150], [140, -90], [200, -60], [260, -100],
      [320, -60], [320, 20], [260, 60], [200, 40], [150, 80], [160, 150], [100, 200],
      [20, 180], [-40, 220], [-110, 190], [-120, 110], [-60, 70], [-30, 40]
    ]
  }
];

// ---------- Construction du tracé (spline Catmull-Rom centripète) ----------
const dist2 = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);
function crPoint(p0, p1, p2, p3, t) {
  const tj = (ti, a, b) => ti + Math.max(1e-4, Math.sqrt(dist2(a, b)));
  const t0 = 0, t1 = tj(t0, p0, p1), t2 = tj(t1, p1, p2), t3 = tj(t2, p2, p3);
  const tt = t1 + (t2 - t1) * t;
  const L = (a, b, ta, tb) => ({
    x: ((tb - tt) * a.x + (tt - ta) * b.x) / (tb - ta),
    z: ((tb - tt) * a.z + (tt - ta) * b.z) / (tb - ta)
  });
  const A1 = L(p0, p1, t0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3);
  const B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3);
  return L(B1, B2, t1, t2);
}

export function buildTrack(def) {
  const P = def.points.map(([x, z]) => ({ x: x * def.scale, z: z * def.scale }));
  const n = P.length, SUB = 40, fine = [];
  for (let i = 0; i < n; i++)
    for (let k = 0; k < SUB; k++)
      fine.push(crPoint(P[(i - 1 + n) % n], P[i], P[(i + 1) % n], P[(i + 2) % n], k / SUB));
  const fm = fine.length, cum = [0];
  for (let i = 1; i < fm; i++) cum.push(cum[i - 1] + dist2(fine[i], fine[i - 1]));
  const LEN = cum[fm - 1] + dist2(fine[0], fine[fm - 1]);

  // Points régulièrement espacés
  const N = SAMPLES, PTS = [];
  let j = 0;
  for (let i = 0; i < N; i++) {
    const s = (i * LEN) / N;
    while (j < fm - 1 && cum[j + 1] < s) j++;
    const a = fine[j], b = fine[(j + 1) % fm];
    const seg = (j + 1 < fm ? cum[j + 1] : LEN) - cum[j];
    const f = seg > 0 ? (s - cum[j]) / seg : 0;
    PTS.push({ x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f });
  }
  const TAN = [], NOR = [], DIST = [0];
  for (let i = 0; i < N; i++) {
    const a = PTS[(i - 1 + N) % N], b = PTS[(i + 1) % N];
    const l = dist2(a, b) || 1;
    const t = { x: (b.x - a.x) / l, z: (b.z - a.z) / l };
    TAN.push(t);
    NOR.push({ x: t.z, z: -t.x });
    if (i > 0) DIST.push(DIST[i - 1] + dist2(PTS[i], PTS[i - 1]));
  }
  DIST.push(LEN);
  const SPACING = LEN / N;

  // Courbure -> vitesse de passage "sûre" (pour l'IA)
  const W = 5, CURV = [];
  for (let i = 0; i < N; i++) {
    const a = TAN[(i - W + N) % N], b = TAN[(i + W) % N];
    const ang = Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.z * b.z)));
    CURV.push(ang / (2 * W * SPACING));
  }
  const SAFE = [];
  for (let i = 0; i < N; i++) {
    let c = 0;
    for (let d = -4; d <= 4; d++) c = Math.max(c, CURV[(i + d + N) % N]);
    SAFE.push(Math.sqrt(1 / Math.max(c, 1e-5)));   // à multiplier par sqrt(latA)
  }

  const START = Math.round(60 / SPACING);
  const CPS = [0.25, 0.5, 0.75].map(f => Math.round(f * N));
  return {
    def, PTS, TAN, NOR, DIST, N, LEN, SPACING, START, CPS, SAFE,
    rel: i => (i - START + N) % N,
    headingAt: i => Math.atan2(TAN[i].x, TAN[i].z)
  };
}

// ---------- Voitures ----------
export function makeCar(opts = {}) {
  return {
    x: 0, z: 0, h: 0, vx: 0, vz: 0, vF: 0, steer: 0, angle: 0, yaw: 0, accel: 0,
    idx: 0, lat: 0, offroad: false,
    lapsDone: 0, nextCp: 0, lapStart: 0, lastLap: 0, bestLap: Infinity, done: false, finishTime: 0,
    input: { steer: 0, throttle: 0, brake: 0, hand: 0 },
    engineMul: 1, maxMul: 1,
    isAI: false, ai: null, name: 'Toi', color: 0xc8102e,
    ...opts
  };
}

export function placeCar(c, T, idx, lat = 0) {
  const i = ((idx % T.N) + T.N) % T.N;
  c.idx = i;
  c.x = T.PTS[i].x + T.NOR[i].x * lat;
  c.z = T.PTS[i].z + T.NOR[i].z * lat;
  c.h = T.headingAt(i);
  c.vx = c.vz = c.vF = c.steer = c.yaw = c.accel = 0;
  c.lat = lat;
}

export function resetRace(c) {
  Object.assign(c, { lapsDone: 0, nextCp: 0, lapStart: 0, lastLap: 0, bestLap: Infinity, done: false, finishTime: 0 });
  if (c.ai) c.ai.stuck = 0;
}

// Grille de départ : 2 colonnes, une rangée tous les 9 m. Le joueur part en dernier.
export function gridSlots(T, count) {
  const slots = [];
  for (let k = 0; k < count; k++) {
    const row = Math.floor(k / 2);
    const back = 7 + row * 9 + (k % 2) * 3;
    slots.push({ idx: T.START - Math.round(back / T.SPACING), lat: count === 1 ? 0 : (k % 2 ? -3.4 : 3.4) });
  }
  return slots;
}

// ---------- Physique ----------
export function physics(c, dt) {
  const fx = Math.sin(c.h), fz = Math.cos(c.h);
  const rx = -Math.cos(c.h), rz = Math.sin(c.h);
  let vF = c.vx * fx + c.vz * fz;   // vitesse vers l'avant
  let vR = c.vx * rx + c.vz * rz;   // glissement latéral
  const { throttle: thr, brake: brk, hand: hb } = c.input;
  const maxV = (c.offroad ? 30 : CAR.maxSpeed) * c.maxMul;

  let a = 0;
  if (thr > 0) a += vF < -0.5 ? 20 * thr : thr * CAR.engine * c.engineMul * Math.max(0, 1 - (vF / maxV) ** 2);
  if (brk > 0) a -= vF > 0.5 ? CAR.brake * brk : 7 * brk * Math.max(0, 1 + vF / 14);
  if (!thr && !brk) a -= Math.sign(vF) * 1.6;          // frein moteur
  a -= vF * 0.02 + 0.0003 * vF * Math.abs(vF);         // frottements + air
  if (c.offroad) a -= vF * 0.35;                       // herbe / sable
  if (hb) a -= Math.sign(vF) * 6;
  vF += a * dt;
  if (!thr && !brk && Math.abs(vF) < 0.3) vF = 0;

  const grip = hb ? CAR.gripDrift : c.offroad ? 3.5 : CAR.grip;
  vR *= Math.exp(-grip * dt);

  // Direction : plus on va vite, moins les roues braquent
  const target = c.input.steer;
  c.steer += (target - c.steer) * Math.min(1, dt * (target === 0 ? 7 : 3.5));
  const speed = Math.abs(vF);
  c.angle = c.steer * 0.62 / (1 + Math.pow(speed / 14, 1.3));
  let yaw = vF * Math.tan(c.angle) / CAR.wheelBase;
  if (hb) yaw *= 1.35;

  // La vitesse reste dans l'ancien repère et la voiture pivote : c'est ce qui crée la glisse
  c.vx = fx * vF + rx * vR;
  c.vz = fz * vF + rz * vR;
  c.h += yaw * dt;
  c.x += c.vx * dt;
  c.z += c.vz * dt;
  c.vF = vF; c.accel = a; c.yaw = yaw;
}

export function trackQuery(c, T) {
  const { PTS, NOR, N } = T;
  let best = Infinity, bi = c.idx;
  for (let d = -40; d <= 40; d++) {
    const i = (c.idx + d + N) % N;
    const dx = PTS[i].x - c.x, dz = PTS[i].z - c.z, dd = dx * dx + dz * dz;
    if (dd < best) { best = dd; bi = i; }
  }
  if (best > 60 * 60) {                 // perdu : recherche sur tout le circuit
    for (let i = 0; i < N; i++) {
      const dx = PTS[i].x - c.x, dz = PTS[i].z - c.z, dd = dx * dx + dz * dz;
      if (dd < best) { best = dd; bi = i; }
    }
  }
  c.idx = bi;
  const n = NOR[bi];
  c.lat = (c.x - PTS[bi].x) * n.x + (c.z - PTS[bi].z) * n.z;
  c.offroad = Math.abs(c.lat) > HW + CURB_W;
  const lim = HW + 40;                  // on ne peut pas s'éloigner de plus de 40 m
  if (Math.abs(c.lat) > lim) {
    const over = Math.abs(c.lat) - lim;
    c.x -= n.x * over * Math.sign(c.lat);
    c.z -= n.z * over * Math.sign(c.lat);
    c.vx *= 0.5; c.vz *= 0.5;
  }
}

// Renvoie 'lap', 'finish' ou null
export function lapLogic(c, T, raceTime) {
  if (c.done) return null;
  const r = T.rel(c.idx);
  if (c.nextCp < 3 && r >= T.CPS[c.nextCp] && r < T.CPS[c.nextCp] + 40) c.nextCp++;
  if (c.nextCp === 3 && r < 30) {
    c.lastLap = raceTime - c.lapStart;
    c.bestLap = Math.min(c.bestLap, c.lastLap);
    c.lapStart = raceTime;
    c.nextCp = 0;
    c.lapsDone++;
    if (c.lapsDone >= LAPS) { c.done = true; c.finishTime = raceTime; return 'finish'; }
    return 'lap';
  }
  return null;
}

// Avancement dans la course (pour le classement en direct)
export function progress(c, T) {
  const r = T.rel(c.idx);
  return c.lapsDone * T.N + (c.nextCp === 0 && r > T.N / 2 ? r - T.N : r);
}

// ---------- Chocs entre voitures ----------
export function collide(cars) {
  const R = 1.35;
  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i], b = cars[j];
      // Chaque voiture = 2 cercles (avant / arrière)
      for (const sa of [-1.1, 1.1]) for (const sb of [-1.1, 1.1]) {
        const ax = a.x + Math.sin(a.h) * sa, az = a.z + Math.cos(a.h) * sa;
        const bx = b.x + Math.sin(b.h) * sb, bz = b.z + Math.cos(b.h) * sb;
        const dx = bx - ax, dz = bz - az, d = Math.hypot(dx, dz);
        if (d > 0.0001 && d < 2 * R) {
          const nx = dx / d, nz = dz / d, push = (2 * R - d) / 2;
          a.x -= nx * push; a.z -= nz * push;
          b.x += nx * push; b.z += nz * push;
          const vrel = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
          if (vrel < 0) {
            const imp = -(1 + 0.3) * vrel / 2;
            a.vx -= nx * imp; a.vz -= nz * imp;
            b.vx += nx * imp; b.vz += nz * imp;
          }
        }
      }
    }
  }
}

// ---------- IA ----------
export function makeAI(diffKey, i) {
  const d = DIFFICULTIES[diffKey];
  const v = 1 + (Math.random() - 0.5) * 0.05;    // chaque pilote est un peu différent
  return makeCar({
    isAI: true, name: AI_NAMES[i % AI_NAMES.length], color: AI_COLORS[i % AI_COLORS.length],
    engineMul: d.engine * v, maxMul: d.vmax * v,
    ai: { latA: d.latA * v, brakeA: d.brakeA, lane: (Math.random() - 0.5) * 5, curLane: 0, stuck: 0 }
  });
}

const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));

export function aiControl(c, cars, T, dt, racing) {
  const inp = c.input, ai = c.ai, { N, PTS, NOR, SPACING, SAFE } = T;
  if (!racing) { inp.throttle = inp.brake = inp.hand = 0; inp.steer = 0; return; }
  const fx = Math.sin(c.h), fz = Math.cos(c.h), rx = -Math.cos(c.h), rz = Math.sin(c.h);
  const spd = Math.max(0, c.vF);

  // Choix de la trajectoire : sa ligne préférée, ou on déboîte pour doubler
  let lane = ai.lane;
  for (const o of cars) {
    if (o === c) continue;
    const dx = o.x - c.x, dz = o.z - c.z;
    const fwd = dx * fx + dz * fz, side = dx * rx + dz * rz;
    if (fwd > 0 && fwd < 10 + spd * 0.5 && Math.abs(side) < 2.8) {
      lane = side > 0 ? o.lat + 3.4 : o.lat - 3.4;
      break;
    }
  }
  lane = Math.max(-HW + 1.6, Math.min(HW - 1.6, lane));
  ai.curLane += (lane - ai.curLane) * Math.min(1, dt * 1.5);

  // Direction : viser un point devant sur la piste
  const ahead = Math.max(3, Math.round((7 + spd * 0.4) / SPACING));
  const ti = (c.idx + ahead) % N;
  const tx = PTS[ti].x + NOR[ti].x * ai.curLane, tz = PTS[ti].z + NOR[ti].z * ai.curLane;
  const diff = wrapAngle(Math.atan2(tx - c.x, tz - c.z) - c.h);
  inp.steer = Math.max(-1, Math.min(1, diff * 3.2 * (c.vF < 0 ? -1 : 1)));

  // Vitesse : regarder les virages qui arrivent et freiner à temps
  let target = CAR.maxSpeed * c.maxMul;
  const look = Math.round(170 / SPACING), sq = Math.sqrt(ai.latA);
  for (let j = 0; j <= look; j += 2) {
    const v = SAFE[(c.idx + j) % N] * sq;
    const allowed = Math.sqrt(v * v + 2 * ai.brakeA * j * SPACING);
    if (allowed < target) target = allowed;
  }
  if (c.done) target *= 0.6;
  inp.throttle = c.vF < target - 0.5 ? 1 : 0;
  inp.brake = c.vF > target + 2 ? Math.min(1, (c.vF - target) / 6) : 0;
  inp.hand = 0;

  // Bloqué ? On le remet sur la piste
  if (Math.abs(c.vF) < 2) ai.stuck += dt; else ai.stuck = 0;
  if (ai.stuck > 2.5) {
    placeCar(c, T, c.idx, 0);
    ai.stuck = 0;
  }
}
