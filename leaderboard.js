// Classement : Firebase Firestore si configuré, sinon sauvegarde locale.
import { firebaseConfig } from './firebase-config.js';

const FB = 'https://www.gstatic.com/firebasejs/11.0.2/';
const LOCAL_KEY = 'circuit3d_scores';
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

function readLocal() {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY)) || []; } catch { return []; }
}

export async function submitTime(name, time, bestLap) {
  const entry = { name: String(name).trim().slice(0, 16), time: Math.round(time), bestLap: Math.round(bestLap) };
  if (db) {
    await fs.addDoc(fs.collection(db, 'scores'), { ...entry, createdAt: fs.serverTimestamp() });
  } else {
    const all = readLocal();
    all.push(entry);
    all.sort((a, b) => a.time - b.time);
    localStorage.setItem(LOCAL_KEY, JSON.stringify(all.slice(0, 50)));
  }
}

export async function fetchTop(n = 10) {
  if (db) {
    const q = fs.query(fs.collection(db, 'scores'), fs.orderBy('time'), fs.limit(n));
    const snap = await fs.getDocs(q);
    return snap.docs.map(d => d.data());
  }
  return readLocal().slice(0, n);
}
