// Firebase client: initialisation and thin wrappers.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, sendEmailVerification, signOut,
  updatePassword, EmailAuthProvider, reauthenticateWithCredential, connectAuthEmulator
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, collection, query, where, orderBy, limit,
  onSnapshot, serverTimestamp, runTransaction, writeBatch, increment, arrayUnion, connectFirestoreEmulator
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

// Local testing against the Firebase emulators: open http://localhost:5173/?emulator
// (`npx firebase emulators:start --project demo-pmsims` in another terminal). Never active on a real domain.
const EMULATOR = ["localhost", "127.0.0.1"].includes(location.hostname) && new URLSearchParams(location.search).has("emulator");
export const CONFIGURED = EMULATOR || !String(firebaseConfig.apiKey || "").startsWith("PASTE_");
export const app = initializeApp(EMULATOR ? { apiKey: "demo-key", authDomain: "demo-pmsims.firebaseapp.com", projectId: "demo-pmsims", appId: "demo" } : firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
if (EMULATOR) {
  connectAuthEmulator(auth, `http://${location.hostname}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db, location.hostname, 8080);
}

export {
  onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, sendEmailVerification, signOut,
  updatePassword, EmailAuthProvider, reauthenticateWithCredential,
  doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, collection, query, where, orderBy, limit,
  onSnapshot, serverTimestamp, runTransaction, writeBatch, increment, arrayUnion, connectFirestoreEmulator
};

export function authError(e) {
  const map = {
    "auth/invalid-credential": "Incorrect email or password.", "auth/wrong-password": "Incorrect email or password.",
    "auth/user-not-found": "No account uses that email. Create an account first.", "auth/invalid-email": "That email address is not valid.",
    "auth/email-already-in-use": "An account with this email already exists. Sign in instead, or use “Continue with Google” for a Gmail address.",
    "auth/weak-password": "Use a password of at least 8 characters.", "auth/too-many-requests": "Too many attempts. Wait a few minutes, then try again.",
    "auth/network-request-failed": "No internet connection.", "auth/popup-blocked": "Your browser blocked the Google window. Allow pop-ups and try again.",
    "auth/unauthorized-domain": "This website address is not yet allowed to sign in (Firebase → Authentication → Settings → Authorized domains).",
    "auth/operation-not-allowed": "This sign-in method is not enabled yet (Firebase → Authentication → Sign-in method).",
    "auth/account-exists-with-different-credential": "This email already uses a different sign-in method.",
    "auth/requires-recent-login": "For your security, sign out and sign in again, then change your password."
  };
  return map[e?.code] || (e?.message || "Sign-in failed.").replace(/^Firebase:\s*/, "");
}

/** Readable message for a Firestore error. */
export function dbError(e) {
  if (e?.code === "permission-denied") return "You don't have permission to do that, or the record changed. Refresh and try again.";
  if (e?.code === "unavailable") return "No connection to the database. Check your internet connection.";
  return (e?.message || "Something went wrong.").replace(/^FirebaseError:\s*/, "");
}
