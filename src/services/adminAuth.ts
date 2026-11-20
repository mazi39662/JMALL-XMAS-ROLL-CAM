import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User
} from 'firebase/auth'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import {
  auth,
  db,
  getAuthorizedAdminEmails,
  googleProvider,
  isFirebaseConfigured
} from './firebase'

const LOCAL_ADMIN_SESSION_KEY = 'xmas_roll_admin_session_v1'

export interface AdminUserSession {
  uid: string
  email: string
  displayName?: string
  photoURL?: string
  isAdminVerified: boolean
  authProvider: 'firebase' | 'google' | 'local-dev'
}

export interface GoogleGuestProfile {
  uid: string
  fullName: string
  email: string
  photoURL?: string
}

function formatFirebaseAuthError(err: any): string {
  const code = err?.code || ''
  if (code === 'auth/unauthorized-domain') {
    return 'Google Sign-In error [auth/unauthorized-domain]: Please ensure this domain (e.g., localhost) is in the Authorized Domains list in Firebase Console > Authentication > Settings.'
  }
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return 'Google Sign-In popup was closed before completing sign-in.'
  }
  if (code === 'auth/popup-blocked') {
    return 'Sign-in popup was blocked by your browser. Please allow popups for this site and try again.'
  }
  if (
    code === 'auth/invalid-credential' ||
    code === 'auth/wrong-password' ||
    code === 'auth/user-not-found'
  ) {
    return 'Invalid admin email or password.'
  }
  return err?.message || 'Authentication failed. Please try again.'
}

/**
 * Verifies whether a Firebase User holds admin privileges via:
 * 1. Custom token claim `admin === true`
 * 2. Presence in Firestore `admins/{uid}` collection
 * 3. Match against configured `VITE_ADMIN_EMAILS` allowlist
 */
export async function verifyFirebaseUserAdminRole(user: User): Promise<boolean> {
  try {
    const tokenResult = await user.getIdTokenResult()
    if (tokenResult.claims.admin === true) {
      return true
    }
  } catch {
    // Continue to Firestore / allowlist check
  }

  if (db) {
    try {
      const adminDoc = await getDoc(doc(db, 'admins', user.uid))
      if (adminDoc.exists() && adminDoc.data()?.role === 'admin') {
        return true
      }
    } catch {
      // Continue to allowlist check
    }
  }

  const email = user.email?.toLowerCase() || ''
  const allowlist = getAuthorizedAdminEmails()
  const isAllowlisted = Boolean(email && allowlist.includes(email))

  if (isAllowlisted && db) {
    try {
      await setDoc(
        doc(db, 'admins', user.uid),
        {
          role: 'admin',
          email,
          updatedAt: new Date().toISOString()
        },
        { merge: true }
      )
    } catch {
      // Non-fatal if rules restrict write
    }
  }

  return isAllowlisted
}

export async function signInAdmin(
  emailInput: string,
  passwordInput: string
): Promise<AdminUserSession> {
  const email = emailInput.trim().toLowerCase()
  const password = passwordInput.trim()

  if (!email || !password) {
    throw new Error('Please enter both your admin email and password.')
  }

  if (isFirebaseConfigured && auth) {
    try {
      const credential = await signInWithEmailAndPassword(auth, email, password)
      const isVerified = await verifyFirebaseUserAdminRole(credential.user)
      if (!isVerified) {
        await firebaseSignOut(auth)
        throw new Error(
          'Access denied: This account does not have organizer/admin permissions for XMAS ROLL.'
        )
      }

      return {
        uid: credential.user.uid,
        email: credential.user.email || email,
        displayName: credential.user.displayName || undefined,
        photoURL: credential.user.photoURL || undefined,
        isAdminVerified: true,
        authProvider: 'firebase'
      }
    } catch (err: any) {
      if (err?.message?.startsWith('Access denied:')) {
        throw err
      }
      throw new Error(formatFirebaseAuthError(err))
    }
  }

  // Local Development Auth Adapter (Only active in test / unconfigured mode)
  const allowedEmails = getAuthorizedAdminEmails()
  if (!allowedEmails.includes(email)) {
    throw new Error(
      `Access denied: "${email}" is not in VITE_ADMIN_EMAILS (${allowedEmails.join(', ')}).`
    )
  }

  if (password.length < 6) {
    throw new Error('Invalid organizer password (minimum 6 characters).')
  }

  const session: AdminUserSession = {
    uid: `local_admin_${btoa(email).replace(/=/g, '')}`,
    email,
    isAdminVerified: true,
    authProvider: 'local-dev'
  }
  sessionStorage.setItem(LOCAL_ADMIN_SESSION_KEY, JSON.stringify(session))
  return session
}

/**
 * Signs in an organizer/admin using Google Sign-In (`signInWithPopup` + `GoogleAuthProvider`)
 */
export async function signInAdminWithGoogle(): Promise<AdminUserSession> {
  if (isFirebaseConfigured && auth) {
    try {
      const result = await signInWithPopup(auth, googleProvider)
      GoogleAuthProvider.credentialFromResult(result)
      const user = result.user

      const isVerified = await verifyFirebaseUserAdminRole(user)
      if (!isVerified) {
        await firebaseSignOut(auth)
        throw new Error(
          `Access denied: "${user.email || 'Your Google account'}" is not authorized as an organizer/admin for XMAS ROLL.`
        )
      }

      return {
        uid: user.uid,
        email: user.email || '',
        displayName: user.displayName || undefined,
        photoURL: user.photoURL || undefined,
        isAdminVerified: true,
        authProvider: 'google'
      }
    } catch (err: any) {
      if (err?.message?.startsWith('Access denied:')) {
        throw err
      }
      throw new Error(formatFirebaseAuthError(err))
    }
  }

  // Fallback for local test mode when Firebase is disabled
  const allowedEmails = getAuthorizedAdminEmails()
  const fallbackEmail = allowedEmails[0] || 'mazi39662@gmail.com'
  const session: AdminUserSession = {
    uid: `local_google_admin_${btoa(fallbackEmail).replace(/=/g, '')}`,
    email: fallbackEmail,
    displayName: 'Organizer (Google)',
    isAdminVerified: true,
    authProvider: 'google'
  }
  sessionStorage.setItem(LOCAL_ADMIN_SESSION_KEY, JSON.stringify(session))
  return session
}

/**
 * Signs in a party guest using Google Sign-In (`signInWithPopup` + `GoogleAuthProvider`)
 * so they can quickly populate their registration details or recover their camera roll.
 */
export async function signInGuestWithGoogle(): Promise<GoogleGuestProfile> {
  if (isFirebaseConfigured && auth) {
    try {
      const result = await signInWithPopup(auth, googleProvider)
      GoogleAuthProvider.credentialFromResult(result)
      const user = result.user
      const email = user.email?.trim().toLowerCase() || ''
      const fallbackName = email ? email.split('@')[0]!.replace(/[._-]+/g, ' ') : 'Party Guest'
      return {
        uid: user.uid,
        fullName: user.displayName?.trim() || fallbackName,
        email,
        photoURL: user.photoURL || undefined
      }
    } catch (err: any) {
      throw new Error(formatFirebaseAuthError(err))
    }
  }

  return {
    uid: 'local_google_guest_1',
    fullName: 'Google Guest',
    email: 'guest@gmail.com'
  }
}

export async function signOutAdmin(): Promise<void> {
  sessionStorage.removeItem(LOCAL_ADMIN_SESSION_KEY)
  if (isFirebaseConfigured && auth) {
    await firebaseSignOut(auth)
  }
}

export function getCurrentAdminSession(): Promise<AdminUserSession | null> {
  if (isFirebaseConfigured && auth) {
    const firebaseAuth = auth
    return new Promise((resolve) => {
      const unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
        unsubscribe()
        if (!user) {
          resolve(null)
          return
        }
        const verified = await verifyFirebaseUserAdminRole(user)
        if (!verified) {
          resolve(null)
          return
        }
        const isGoogle = user.providerData?.some((p) => p.providerId === 'google.com')
        resolve({
          uid: user.uid,
          email: user.email || '',
          displayName: user.displayName || undefined,
          photoURL: user.photoURL || undefined,
          isAdminVerified: true,
          authProvider: isGoogle ? 'google' : 'firebase'
        })
      })
    })
  }

  try {
    const raw = sessionStorage.getItem(LOCAL_ADMIN_SESSION_KEY)
    if (!raw) return Promise.resolve(null)
    const parsed = JSON.parse(raw) as AdminUserSession
    if (parsed && parsed.isAdminVerified && parsed.email) {
      return Promise.resolve(parsed)
    }
    return Promise.resolve(null)
  } catch {
    return Promise.resolve(null)
  }
}
