// ============================================================
// Mystical Wellness — Firebase Backend Configuration
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
  deleteDoc,
  addDoc,
  collection,
  query,
  where,
  orderBy,
  getDocs,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getFunctions,
  httpsCallable
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

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
const functions = getFunctions(app);

export const BACKEND_URL = "https://script.google.com/macros/s/AKfycbyhJ9XFAB8dlyziBxKLi1gb4cfumb4D6BD2NxL0yp7fQ_y7PASSJOsAph4Mi_AHWBIa/exec";

const ADMIN_EMAILS = [
  "mysticalwellness26@gmail.com",
  "mysticalwellness26admin@gmail.com",
  "mysticalwellness26recovery@gmail.com"
];

export function isAdminEmail(email) {
  return Boolean(email) && ADMIN_EMAILS.includes(email.toLowerCase());
}

export const REWARD_TIERS = [
  { points: 50, reward: "Free topping on your next order" },
  { points: 100, reward: "$5 off your next order" },
  { points: 200, reward: "One free 12oz Nourishment" },
  { points: 350, reward: "$15 off your next order" }
];

export const DEFAULT_TOPPINGS = [
  "Almond flakes",
  "Coconut flakes",
  "Maple syrup",
  "Crushed walnuts",
  "Banana"
];

const TOPPINGS_SETTINGS_REF = doc(db, "settings", "manualOrder");

export function watchAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function logIn(email, password, rememberMe = true) {
  await setPersistence(
    auth,
    rememberMe ? browserLocalPersistence : browserSessionPersistence
  );
  return signInWithEmailAndPassword(auth, email, password);
}

export async function signUpCustomer({ name, phone, email, password }) {
  const normalizedEmail = email.trim().toLowerCase();
  const credential = await createUserWithEmailAndPassword(auth, normalizedEmail, password);

  if (name) {
    await updateProfile(credential.user, { displayName: name.trim() });
  }

  await setDoc(doc(db, "users", credential.user.uid), {
    name: name ? name.trim() : "",
    phone: phone ? phone.trim() : "",
    email: normalizedEmail,
    address: "",
    points: 0,
    activeReward: null,
    createdAt: serverTimestamp()
  });

  return credential;
}

export async function resetPassword(email) {
  return sendPasswordResetEmail(auth, email);
}

export async function logOut() {
  return signOut(auth);
}

const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

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

export async function getUserProfile(uid) {
  if (!uid) return null;
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

export async function updateUserProfile(uid, updates) {
  if (!uid) throw new Error("Missing user ID.");
  await updateDoc(doc(db, "users", uid), updates);
}

export async function getAllUsers() {
  const snap = await getDocs(collection(db, "users"));
  return snap.docs
    .map((entry) => ({ id: entry.id, ...entry.data() }))
    .sort((a, b) => {
      const aTime = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
      const bTime = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
      return bTime - aTime;
    });
}

export async function getManualToppings() {
  const snap = await getDoc(TOPPINGS_SETTINGS_REF);

  if (!snap.exists()) {
    return [...DEFAULT_TOPPINGS];
  }

  const toppings = snap.data()?.toppings;
  if (!Array.isArray(toppings) || toppings.length === 0) {
    return [...DEFAULT_TOPPINGS];
  }

  return toppings
    .map((topping) => String(topping || "").trim())
    .filter(Boolean);
}

export async function saveManualToppings(toppings) {
  if (!Array.isArray(toppings)) {
    throw new Error("Toppings must be a list.");
  }

  const cleanToppings = toppings
    .map((topping) => String(topping || "").trim())
    .filter(Boolean);

  if (cleanToppings.length === 0) {
    throw new Error("Keep at least one topping.");
  }

  const uniqueNames = new Set(cleanToppings.map((topping) => topping.toLowerCase()));
  if (uniqueNames.size !== cleanToppings.length) {
    throw new Error("Each topping must have a unique name.");
  }

  await setDoc(
    TOPPINGS_SETTINGS_REF,
    {
      toppings: cleanToppings,
      updatedAt: serverTimestamp(),
      updatedBy: auth.currentUser?.email || "unknown"
    },
    { merge: true }
  );

  return cleanToppings;
}

export function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export async function saveOrderToFirestore(orderData, uid) {
  const payload = {
    ...orderData,
    uid: uid || null,
    status: "New",
    createdAt: serverTimestamp()
  };

  const docRef = await addDoc(collection(db, "orders"), payload);
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
  return snap.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
}

export async function getAllOrders() {
  const ordersQuery = query(collection(db, "orders"), orderBy("createdAt", "desc"));
  const snap = await getDocs(ordersQuery);
  return snap.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
}

export async function updateOrderStatus(orderId, status) {
  await updateDoc(doc(db, "orders", orderId), { status });
}

export async function markOrderCompletedAndAwardPoints(orderId) {
  const orderRef = doc(db, "orders", orderId);
  const orderSnap = await getDoc(orderRef);

  if (!orderSnap.exists()) throw new Error("Order not found.");

  const order = orderSnap.data();
  if (order.status === "Completed") return;

  await updateDoc(orderRef, { status: "Completed" });

  if (!order.uid) return;

  const userRef = doc(db, "users", order.uid);
  const userSnap = await getDoc(userRef);

  if (!userSnap.exists()) return;

  const currentPoints = Number(userSnap.data().points || 0);
  const earned = Math.max(0, Math.floor(Number(order.subtotal || 0)));
  await updateDoc(userRef, { points: currentPoints + earned });
}

export async function markOrderCancelled(orderId) {
  await updateDoc(doc(db, "orders", orderId), { status: "Cancelled" });
}

function generateRewardCode() {
  return `MW-${Math.floor(1000 + Math.random() * 9000)}`;
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

  if (Number(profile.points || 0) < tier.points) {
    throw new Error("You do not have enough points for this reward yet.");
  }

  const code = generateRewardCode();
  const activeReward = {
    code,
    reward: tier.reward,
    tierIndex,
    redeemedAt: new Date().toISOString()
  };

  await updateDoc(userRef, { activeReward });
  await setDoc(doc(db, "rewardCodes", code), {
    uid,
    reward: tier.reward,
    status: "active",
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
  if (data.status !== "active") return null;

  return { code: cleanCode, reward: data.reward };
}

export async function markRewardCodeUsed(code) {
  const cleanCode = code.trim().toUpperCase();
  const codeRef = doc(db, "rewardCodes", cleanCode);
  const codeSnap = await getDoc(codeRef);

  if (!codeSnap.exists()) throw new Error("Reward code not found.");

  const data = codeSnap.data();
  await updateDoc(codeRef, { status: "used" });

  if (data.uid) {
    await updateDoc(doc(db, "users", data.uid), { activeReward: null });
  }
}

export async function adjustUserPoints(uid, delta, reason, adminEmail) {
  const userRef = doc(db, "users", uid);
  const userSnap = await getDoc(userRef);

  if (!userSnap.exists()) throw new Error("Customer not found.");

  const currentPoints = Number(userSnap.data().points || 0);
  const newPoints = Math.max(0, currentPoints + Number(delta || 0));

  await updateDoc(userRef, { points: newPoints });
  await addDoc(collection(db, "customerAudits"), {
    uid,
    action: "Adjusted points",
    note: reason || "",
    adminEmail: adminEmail || "unknown",
    details: `Points changed by ${Number(delta) > 0 ? "+" : ""}${delta} (now ${newPoints})`,
    createdAt: serverTimestamp()
  });

  return newPoints;
}

export async function updateCustomerProfileWithAudit(uid, updates, note, adminEmail) {
  if (!note || !note.trim()) {
    throw new Error("A note is required for every customer change.");
  }

  await updateDoc(doc(db, "users", uid), updates);

  await addDoc(collection(db, "customerAudits"), {
    uid,
    action: "Edited profile",
    note: note.trim(),
    adminEmail: adminEmail || "unknown",
    details: `Updated: ${Object.keys(updates).join(", ")}`,
    createdAt: serverTimestamp()
  });
}

export async function getCustomerAudits() {
  const auditsQuery = query(collection(db, "customerAudits"), orderBy("createdAt", "desc"));
  const snap = await getDocs(auditsQuery);
  return snap.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
}

export async function deleteCustomerAccount(uid, note) {
  const callable = httpsCallable(functions, "deleteCustomerAccount");
  const result = await callable({ uid, note });
  return result.data;
}

export async function updateCustomerEmail(uid, newEmail, note) {
  const callable = httpsCallable(functions, "updateCustomerEmail");
  const result = await callable({ uid, newEmail, note });
  return result.data;
}

export async function createCustomerAccount({ name, phone, email, password, note }) {
  if (!name || !email || !password) {
    throw new Error("Name, email, and temporary password are required.");
  }

  if (password.length < 6) {
    throw new Error("The temporary password must contain at least 6 characters.");
  }

  if (!note || !note.trim()) {
    throw new Error("A note is required.");
  }

  const normalizedEmail = email.trim().toLowerCase();
  const secondaryApp = initializeApp(firebaseConfig, `customer-create-${Date.now()}`);
  const secondaryAuth = getAuth(secondaryApp);
  const adminEmail = auth.currentUser?.email || "unknown";

  try {
    const credential = await createUserWithEmailAndPassword(
      secondaryAuth,
      normalizedEmail,
      password
    );

    await updateProfile(credential.user, { displayName: name.trim() });

    await setDoc(doc(db, "users", credential.user.uid), {
      name: name.trim(),
      phone: phone ? phone.trim() : "",
      email: normalizedEmail,
      address: "",
      points: 0,
      activeReward: null,
      createdAt: serverTimestamp()
    });

    await addDoc(collection(db, "customerAudits"), {
      uid: credential.user.uid,
      action: "Customer account created",
      note: note.trim(),
      adminEmail,
      details: `Created customer account for ${normalizedEmail}.`,
      createdAt: serverTimestamp()
    });

    return { uid: credential.user.uid, email: normalizedEmail };
  } finally {
    await signOut(secondaryAuth).catch(() => {});
  }
}
