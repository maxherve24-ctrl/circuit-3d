// Classement : Firebase Firestore si configuré, sinon sauvegarde locale.
// Chaque circuit a sa propre collection (ex : "scores", "scores_ovale"…).
import { firebaseConfig } from './firebase-config.js';

const FB = 'https://www.gstatic.com/firebasejs/11.0.2/';
let db = null;
let fs = null;

export function isConfigured() {
  return !!(firebaseConfig.apiKey && firebaseConfig.apiKey !== 'COLLE_ICI' && firebaseConfig.projectId);
}

export async function initLeaderboard() {
  if (!isConfigured()) return false;
  try {
    const appMod = await import(FB + 'firebase-app.js');
    fs = await import(FB + 'firebase-firestore.js');
    const app = appMod.initializeApp(firebaseConfig);
    db = fs.getFirestore(app);
    return true;
  } catch (e) {
    console.warn('Firebase indisponible, classement local utilisé.', e);
    db = null;
    return false;
  }
}

export const isOnline = () => db !== null;

const localKey = col => 'circuit3d_' + col;
function readLocal(col) {
  try { return JSON.parse(localStorage.getItem(localKey(col))) || []; } catch { return []; }
}

export async function submitTime(col, name, time, bestLap) {
  const entry = { name: String(name).trim().slice(0, 16), time: Math.round(time), bestLap: Math.round(bestLap) };
  if (db) {
    await fs.addDoc(fs.collection(db, col), { ...entry, createdAt: fs.serverTimestamp() });
  } else {
    const all = readLocal(col);
    all.push(entry);
    all.sort((a, b) => a.time - b.time);
    localStorage.setItem(localKey(col), JSON.stringify(all.slice(0, 50)));
  }
}

export async function fetchTop(col, n = 10) {
  if (db) {
    const q = fs.query(fs.collection(db, col), fs.orderBy('time'), fs.limit(n));
    const snap = await fs.getDocs(q);
    return snap.docs.map(d => d.data());
  }
  return readLocal(col).slice(0, n);
}
