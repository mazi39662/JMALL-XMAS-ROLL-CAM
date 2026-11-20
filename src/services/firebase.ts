import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth'
import { getFirestore, type Firestore } from 'firebase/firestore'

const isTestEnv =
  typeof import.meta !== 'undefined' &&
  import.meta.env?.MODE === 'test' &&
  import.meta.env?.VITE_FORCE_FIREBASE_IN_TEST !== 'true'

// Firebase Web App configuration for project: jmall-xmas-roll
export const firebaseConfig = {
  apiKey:
    import.meta.env.VITE_FIREBASE_API_KEY?.trim() ||
    'AIzaSyCE9LcoPzXsZ3Df-R3i3tFmvLuhws0OcJo',
  authDomain:
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN?.trim() ||
    'jmall-xmas-roll.firebaseapp.com',
  projectId:
    import.meta.env.VITE_FIREBASE_PROJECT_ID?.trim() ||
    'jmall-xmas-roll',
  storageBucket:
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET?.trim() ||
    'jmall-xmas-roll.firebasestorage.app',
  messagingSenderId:
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID?.trim() ||
    '672029754347',
  appId:
    import.meta.env.VITE_FIREBASE_APP_ID?.trim() ||
    '1:672029754347:web:d4c3e77c6e32ec32f4cfae',
  measurementId:
    import.meta.env.VITE_FIREBASE_MEASUREMENT_ID?.trim() ||
    'G-K5YT9DE21S'
}

export const isFirebaseConfigured = Boolean(
  !isTestEnv &&
  firebaseConfig.apiKey &&
  firebaseConfig.projectId &&
  !firebaseConfig.apiKey.includes('YOUR_')
)

let app: FirebaseApp | null = null
let auth: Auth | null = null
let db: Firestore | null = null

export const googleProvider = new GoogleAuthProvider()
googleProvider.setCustomParameters({
  prompt: 'select_account'
})

if (isFirebaseConfigured) {
  try {
    app = initializeApp(firebaseConfig)
    auth = getAuth(app)
    db = getFirestore(app)
  } catch (error) {
    console.error('[XMAS ROLL] Failed to initialize Firebase:', error)
  }
}

export const DEFAULT_EVENT_ID = import.meta.env.VITE_DEFAULT_EVENT_ID?.trim() || 'xmas-party-2026'

export const SINGLE_ADMIN_USERNAME = 'admin'
export const SINGLE_ADMIN_EMAIL = 'admin@jmall.com'

export function getAuthorizedAdminEmails(): string[] {
  const raw = import.meta.env.VITE_ADMIN_EMAILS || SINGLE_ADMIN_EMAIL
  const parsed = raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  return parsed.length > 0 ? [parsed[0]!] : [SINGLE_ADMIN_EMAIL]
}

export { app, auth, db }
