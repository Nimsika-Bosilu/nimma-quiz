import { FirebaseApp, getApps, initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInAnonymously, signInWithPopup, signOut, User } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
};

export const hasFirebaseConfig = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

export function getFirebaseApp(): FirebaseApp {
  if (!hasFirebaseConfig) {
    throw new Error("Firebase environment variables are missing.");
  }

  return getApps()[0] ?? initializeApp(firebaseConfig);
}

/**
 * Returns the currently signed-in user for Firestore reads.
 *
 * KEY BEHAVIOUR: We wait for Firebase to fully restore auth state from
 * localStorage before making any decision. This prevents the projector
 * window (which opens fresh) from calling signInAnonymously() during the
 * brief moment when auth.currentUser is null — which would overwrite the
 * admin's session across ALL browser windows sharing the same origin.
 *
 * If a user (admin OR anonymous) is already signed in → reuse them.
 * If no user at all → sign in anonymously for read-only Firestore access.
 */
export function getAnonymousUser(): Promise<User> {
  const auth = getAuth(getFirebaseApp());

  return new Promise((resolve, reject) => {
    // onAuthStateChanged fires once immediately after auth is initialised.
    // This is the ONLY reliable way to know if a persisted session exists.
    const unsubscribe = onAuthStateChanged(
      auth,
      async (user) => {
        unsubscribe(); // detach listener after first call
        if (user) {
          // Any existing user (host or anonymous) — reuse, never sign out.
          resolve(user);
        } else {
          // Truly no session: sign in anonymously for read-only access.
          try {
            const result = await signInAnonymously(auth);
            resolve(result.user);
          } catch (err) {
            reject(err);
          }
        }
      },
      reject
    );
  });
}

export async function signInHostWithGoogle() {
  const auth = getAuth(getFirebaseApp());
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const result = await signInWithPopup(auth, provider);
  return result.user;
}

export async function signOutHost() {
  await signOut(getAuth(getFirebaseApp()));
}

export function getFirebaseAuth() {
  return getAuth(getFirebaseApp());
}

export function getDb() {
  return getFirestore(getFirebaseApp());
}
