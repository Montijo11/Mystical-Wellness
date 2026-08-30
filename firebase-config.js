// ============================================================
// Mystical Wellness — Firebase Backend Configuration
// ============================================================
// This file is fully configured with your live Firebase project
// keys and admin accounts. The only remaining step is pasting
// your deployed Google Apps Script /exec URL into BACKEND_URL
// below once you deploy Code.gs.
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  addDoc,
  collection,
  query,
  where,
  orderBy,
  getDocs,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ------------------------------------------------------------
// Firebase project configuration (live — mystical-wellness)
// ------------------------------------------------------------
const firebaseConfig = {
  apiKey: "AIzaSyDXfMK8nxFQ9-wbazPYqgPmF58QFS_Y1Vs",
  authDomain: "mystical-wellness.firebaseapp.com",
  projectId: "mystical-wellness",
  storageBucket: "mystical-wellness.firebasestorage.app",
  messagingSenderId: "859227928719",
  appId: "1:859227928719:web:88f098c46bed52e44318fa",
  measurementId: "G-6XV6XJX2MX"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// ------------------------------------------------------------
// PASTE YOUR GOOGLE APPS SCRIPT WEB APP URL HERE
// ------------------------------------------------------------
export const BACKEND_URL = "https://script.google.com/macros/s/AKfycbyhJ9XFAB8dlyziBxKLi1gb4cfumb4D6BD2NxL0yp7fQ_y7PASSJOsAph4Mi_AHWBIa/exec";

// ------------------------------------------------------------
// Admin access
// ------------------------------------------------------------
const ADMIN_EMAILS = [
  "mysticalwellness26@gmail.com",
  "mysticalwellness26admin@gmail.com"
];

export function isAdminEmail(email) {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.toLowerCase());
}

// ------------------------------------------------------------
// Reward tiers
// ------------------------------------------------------------
export const REWARD_TIERS = [
  { points: 50, reward: "Free topping on your next order" },
  { points: 100, reward: "$5 off your next order" },
  { points: 200, reward: "One free 12oz Nourishment" },
  { points: 350, reward: "$15 off your next order" }
];

// ------------------------------------------------------------
// Auth state watcher
// ------------------------------------------------------------
export function watchAuth(callback) {
  return onAuthStateChanged(auth, (user) => {
    callback(user);
  });
}

/**
 * Logs in a user. rememberMe controls whether the session persists
 * across browser restarts (local) or clears when the tab closes (session).
 */
export async function logIn(email, password, rememberMe = true) {
  await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);
  return signInWithEmailAndPassword(auth, email, password);
}

/**
 * Creates a new customer account and their Firestore profile document.
 * Called from login.html's sign-up form as:
 * signUpCustomer({ name, phone, email, password })
 */
export async function signUpCustomer({ name, phone, email, password }) {
  const credential = await createUserWithEmailAndPassword(auth, email, password);

  if (name) {
    await updateProfile(credential.user, { displayName: name });
  }

  await setDoc(doc(db, "users", credential.user.uid), {
    name: name || "",
    phone: phone || "",
    email,
    address: "",
    points: 0,
    activeReward: null,
    createdAt: serverTimestamp()
  });

  return credential;
}

/**
 * Sends a password reset email to the given address.
 */
export async function resetPassword(email) {
  return sendPasswordResetEmail(auth, email);
}

export async function logOut() {
  return signOut(auth);
}

// ------------------------------------------------------------
// Session timeout — auto logs out after 30 minutes of inactivity
// ------------------------------------------------------------
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export function enforceSessionTimeout() {
  const now = Date.now();
  const lastActive = Number(localStorage.getItem("mw_last_active") || now);

  if (now - lastActive > SESSION_TIMEOUT_MS) {
    localStorage.removeItem("mw_last_active");
    logOut();
    return false;
  }

  localStorage.setItem("mw_last_active", String(now));
  return true;
}

// ------------------------------------------------------------
// User profile helpers
// ------------------------------------------------------------
export async function getUserProfile(uid) {
  if (!uid) return null;
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

export async function updateUserProfile(uid, updates) {
  if (!uid) throw new Error("Missing user ID.");
  await updateDoc(doc(db, "users", uid), updates);
}

// ------------------------------------------------------------
// Greeting helper — used on account.html welcome screen
// ------------------------------------------------------------
export function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

// ------------------------------------------------------------
// Orders — save + fetch
// ------------------------------------------------------------
export async function saveOrderToFirestore(orderData, uid) {
  const payload = {
    ...orderData,
    uid: uid || null,
    status: "Pending",
    createdAt: serverTimestamp()
  };
  const docRef = await addDoc(collection(db, "orders"), payload);

  if (uid && orderData.totalNourishments) {
    const userRef = doc(db, "users", uid);
    const userSnap = await getDoc(userRef);
    if (userSnap.exists()) {
      const currentPoints = userSnap.data().points || 0;
      const earned = orderData.totalNourishments * 10;
      await updateDoc(userRef, { points: currentPoints + earned });
    }
  }

  return docRef.id;
}

export async function getOrdersForUser(uid) {
  if (!uid) return [];
  const ordersQuery = query(
    collection(db, "orders"),
    where("uid", "==", uid),
    orderBy("createdAt", "desc")
  );
  const snap = await getDocs(ordersQuery);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getAllOrders() {
  const ordersQuery = query(collection(db, "orders"), orderBy("createdAt", "desc"));
  const snap = await getDocs(ordersQuery);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function updateOrderStatus(orderId, status) {
  await updateDoc(doc(db, "orders", orderId), { status });
}

// ------------------------------------------------------------
// Rewards — lookup + redemption
// ------------------------------------------------------------
function generateRewardCode() {
  const random = Math.floor(1000 + Math.random() * 9000);
  return `MW-${random}`;
}

export async function redeemReward(uid, tierIndex) {
  const tier = REWARD_TIERS[tierIndex];
  if (!tier) throw new Error("Invalid reward tier.");

  const userRef = doc(db, "users", uid);
  const userSnap = await getDoc(userRef);
  if (!userSnap.exists()) throw new Error("User profile not found.");

  const profile = userSnap.data();
  if (profile.activeReward) {
    throw new Error("You already have an active reward. Redeem it at pickup before claiming another.");
  }
  if ((profile.points || 0) < tier.points) {
    throw new Error("You do not have enough points for this reward yet.");
  }

  const code = generateRewardCode();
  const activeReward = { code, reward: tier.reward, tierIndex, redeemedAt: new Date().toISOString() };

  await updateDoc(userRef, { activeReward });
  await setDoc(doc(db, "rewardCodes", code), {
    uid,
    reward: tier.reward,
    used: false,
    createdAt: serverTimestamp()
  });

  return code;
}

export async function lookupRewardCode(code) {
  if (!code) return null;
  const cleanCode = code.trim().toUpperCase();
  const snap = await getDoc(doc(db, "rewardCodes", cleanCode));
  if (!snap.exists()) return null;

  const data = snap.data();
  if (data.used) return null;

  return { code: cleanCode, reward: data.reward };
}

export async function markRewardCodeUsed(code, uid) {
  const cleanCode = code.trim().toUpperCase();
  await updateDoc(doc(db, "rewardCodes", cleanCode), { used: true });

  if (uid) {
    await updateDoc(doc(db, "users", uid), { activeReward: null });
  }
}
