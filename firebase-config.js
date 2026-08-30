// =====================================================================
// Mystical Wellness — Shared Firebase Configuration & Helpers
// Include this on every page with: <script type="module" src="firebase-config.js"></script>
// Other pages import from it: import { auth, db, ... } from './firebase-config.js';
// =====================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, sendPasswordResetEmail, setPersistence,
  browserLocalPersistence, browserSessionPersistence
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  getFirestore, doc, setDoc, getDoc, updateDoc, collection, addDoc,
  query, where, orderBy, getDocs, serverTimestamp, runTransaction
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDXfMK8nxFQ9-wbazPYqgPmF58QFS_Y1Vs",
  authDomain: "mystical-wellness.firebaseapp.com",
  projectId: "mystical-wellness",
  storageBucket: "mystical-wellness.firebasestorage.app",
  messagingSenderId: "859227928719",
  appId: "1:859227928719:web:88f098c46bed52e44318fa"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// ---- ADMIN ACCOUNTS ----------------------------------------------------
export const ADMIN_EMAILS = [
  'mysticalwellness26@gmail.com',
  'mysticalwellness26recovery@gmail.com'
];
export function isAdminEmail(email) {
  return ADMIN_EMAILS.includes((email || '').toLowerCase());
}

// ---- REWARD TIERS --------------------------------------------------------
// ⚠️ PLACEHOLDER NUMBERS — please confirm/edit these to match your exact
// program before launch. Nothing else in the code needs to change if you
// adjust these values or add/remove tiers.
export const REWARD_TIERS = [
  { points: 20, reward: '$2 off your next order' },
  { points: 40, reward: '$4 off your next order' },
  { points: 75, reward: '1 free Nourishment' },
  { points: 150, reward: '2 free Nourishments + free topping upgrade' }
];
export const POINTS_PER_DOLLAR = 1; // 1 point earned per $1 spent on completed orders

// ---- APPS SCRIPT BACKEND (for email notifications) -----------------------
export const BACKEND_URL = 'https://script.google.com/macros/s/AKfycbyhJ9XFAB8dlyziBxKLi1gb4cfumb4D6BD2NxL0yp7fQ_y7PASSJOsAph4Mi_AHWBIa/exec';

// ---- AUTH HELPERS ----------------------------------------------------------
export async function signUpCustomer({ name, phone, email, password }) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await setDoc(doc(db, 'users', cred.user.uid), {
    name, phone, email,
    address: null,
    points: 0,
    activeReward: null,
    isAdmin: isAdminEmail(email),
    createdAt: serverTimestamp()
  });
  return cred.user;
}

export async function logIn(email, password, rememberMe) {
  await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);
  localStorage.setItem('mw_last_active', String(Date.now()));
  localStorage.setItem('mw_remember_me', rememberMe ? '1' : '0');
  return signInWithEmailAndPassword(auth, email, password);
}

export function logOut() {
  localStorage.removeItem('mw_last_active');
  localStorage.removeItem('mw_remember_me');
  return signOut(auth);
}
export function resetPassword(email) { return sendPasswordResetEmail(auth, email); }
export function watchAuth(callback) { return onAuthStateChanged(auth, callback); }

// Call once on every protected page load to enforce the 24-hour
// inactivity timeout (skipped entirely if "Remember Me" was checked).
export function enforceSessionTimeout() {
  const remembered = localStorage.getItem('mw_remember_me') === '1';
  if (remembered) return true;

  const last = Number(localStorage.getItem('mw_last_active') || 0);
  const twentyFourHours = 24 * 60 * 60 * 1000;
  if (Date.now() - last > twentyFourHours) {
    logOut();
    return false;
  }
  localStorage.setItem('mw_last_active', String(Date.now()));
  return true;
}

// ---- USER PROFILE HELPERS ---------------------------------------------------
export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? snap.data() : null;
}
export async function updateUserProfile(uid, data) {
  return updateDoc(doc(db, 'users', uid), data);
}

// ---- ORDER HELPERS ------------------------------------------------------------
export async function saveOrderToFirestore(order, uid) {
  return addDoc(collection(db, 'orders'), {
    uid: uid || null,
    ...order,
    status: 'New',
    pointsAwarded: false,
    createdAt: serverTimestamp()
  });
}

export async function getOrdersForUser(uid) {
  const q = query(collection(db, 'orders'), where('uid', '==', uid), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getAllOrders() {
  const q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ---- POINTS / REWARDS LOGIC -----------------------------------------------------
export function currentTierIndexForPoints(points) {
  let idx = -1;
  REWARD_TIERS.forEach((tier, i) => { if (points >= tier.points) idx = i; });
  return idx;
}

function generateRewardCode() {
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `MW-${rand}`;
}

// Admin calls this when marking an order "Completed."
// Guest orders (no uid) simply get marked complete with no points.
export async function markOrderCompletedAndAwardPoints(orderId) {
  const orderRef = doc(db, 'orders', orderId);
  const orderSnap = await getDoc(orderRef);
  if (!orderSnap.exists()) throw new Error('Order not found');
  const order = orderSnap.data();

  await updateDoc(orderRef, { status: 'Completed', completedAt: serverTimestamp() });

  if (!order.uid || order.pointsAwarded) return;

  const earned = Math.floor(Number(order.subtotal || 0) * POINTS_PER_DOLLAR);
  const userRef = doc(db, 'users', order.uid);

  await runTransaction(db, async (tx) => {
    const userSnap = await tx.get(userRef);
    const userData = userSnap.data();
    const newPoints = (userData.points || 0) + earned;
    tx.update(userRef, { points: newPoints });
  });

  await updateDoc(orderRef, { pointsAwarded: true });
}

export async function markOrderCancelled(orderId) {
  return updateDoc(doc(db, 'orders', orderId), { status: 'Cancelled' });
}

// Redeem a reward — blocked if the customer already has an active,
// unused reward. Leftover points beyond the tier threshold carry over.
export async function redeemReward(uid, tierIndex) {
  const userRef = doc(db, 'users', uid);
  const userSnap = await getDoc(userRef);
  const userData = userSnap.data();

  if (userData.activeReward) {
    throw new Error('You already have an active reward. Use it before redeeming another.');
  }

  const tier = REWARD_TIERS[tierIndex];
  if (!tier || userData.points < tier.points) {
    throw new Error('Not enough points for this reward yet.');
  }

  const code = generateRewardCode();
  const leftoverPoints = userData.points - tier.points;

  await setDoc(doc(db, 'rewardCodes', code), {
    code, uid, tier: tierIndex, reward: tier.reward,
    status: 'active', createdAt: serverTimestamp()
  });

  await updateDoc(userRef, {
    points: leftoverPoints,
    activeReward: { code, reward: tier.reward, tier: tierIndex }
  });

  return code;
}

// Admin marks a reward code as used once honored at pickup.
export async function markRewardCodeUsed(code) {
  const codeRef = doc(db, 'rewardCodes', code);
  const codeSnap = await getDoc(codeRef);
  if (!codeSnap.exists()) throw new Error('Code not found');
  const data = codeSnap.data();

  await updateDoc(codeRef, { status: 'used', usedAt: serverTimestamp() });
  await updateDoc(doc(db, 'users', data.uid), { activeReward: null });
}

// Admin manual point adjustment — always requires a reason (audit trail).
export async function adjustUserPoints(uid, delta, reason, adminEmail) {
  if (!reason || !reason.trim()) throw new Error('A reason is required for point adjustments.');
  const userRef = doc(db, 'users', uid);
  const userSnap = await getDoc(userRef);
  const newPoints = Math.max(0, (userSnap.data().points || 0) + delta);
  await updateDoc(userRef, { points: newPoints });
  await addDoc(collection(db, 'pointAdjustments'), {
    uid, delta, reason: reason.trim(), adminEmail, createdAt: serverTimestamp()
  });
}

// Look up a reward code (used by the checkout "apply code" field).
export async function lookupRewardCode(code) {
  const snap = await getDoc(doc(db, 'rewardCodes', code.trim().toUpperCase()));
  if (!snap.exists()) return null;
  const data = snap.data();
  return data.status === 'active' ? data : null;
}

// ---- GREETING HELPER (business timezone: America/Los_Angeles) --------------
export function getGreeting() {
  const hour = Number(new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', hour12: false, timeZone: 'America/Los_Angeles'
  }).format(new Date()));
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}
