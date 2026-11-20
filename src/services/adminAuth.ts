import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User
} from 'firebase/auth'
import { doc, setDoc } from 'firebase/firestore'
import {
  auth,
  db,
  getAuthorizedAdminEmails,
  googleProvider,
  isFirebaseConfigured,
  SINGLE_ADMIN_EMAIL,
  SINGLE_ADMIN_USERNAME
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

function getSingleAuthorizedAdminEmail(): string {
  const allowed = getAuthorizedAdminEmails()
  return (allowed[0] || SINGLE_ADMIN_EMAIL).toLowerCase()
}

export function resolveAdminLoginEmail(usernameOrEmail: string): string {
  const normalized = usernameOrEmail.trim().toLowerCase()
  if (normalized === SINGLE_ADMIN_USERNAME) {
    return getSingleAuthorizedAdminEmail()
  }
  return normalized
}

function extractErrorCode(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code?: unknown }).code
    if (typeof code === 'string') return code
  }
  return ''
}

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const msg = (err as { message?: unknown }).message
    if (typeof msg === 'string') return msg
  }
  return ''
}

function formatFirebaseAuthError(err: unknown): string {
  const code = extractErrorCode(err)
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
    code === 'auth/user-not-found' ||
    code === 'auth/invalid-email'
  ) {
    return 'Invalid admin username or password.'
  }
  return extractErrorMessage(err) || 'Authentication failed. Please try again.'
}

/**
 * Verifies whether a Firebase User is the single authorized XMAS ROLL admin account.
 */
export async function verifyFirebaseUserAdminRole(user: User): Promise<boolean> {
  const email = user.email?.trim().toLowerCase() || ''
  const singleAdminEmail = getSingleAuthorizedAdminEmail()
  const isAuthorized = Boolean(email && email === singleAdminEmail)

  if (isAuthorized && db) {
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

  return isAuthorized
}

export async function signInAdmin(
  usernameOrEmailInput: string,
  passwordInput: string
): Promise<AdminUserSession> {
  const email = resolveAdminLoginEmail(usernameOrEmailInput)
  const password = passwordInput.trim()

  if (!email || !password) {
    throw new Error('Please enter both your admin username and password.')
  }

  const singleAdminEmail = getSingleAuthorizedAdminEmail()
  if (email !== singleAdminEmail) {
    throw new Error('Access denied: Invalid admin username or password.')
  }

  if (isFirebaseConfigured && auth) {
    try {
      const credential = await signInWithEmailAndPassword(auth, email, password)
      const isVerified = await verifyFirebaseUserAdminRole(credential.user)
      if (!isVerified) {
        await firebaseSignOut(auth)
        throw new Error(
          'Access denied: This account does not have admin permissions for XMAS ROLL.'
        )
      }

      return {
        uid: credential.user.uid,
        email: credential.user.email || email,
        displayName: credential.user.displayName || 'Admin',
        photoURL: credential.user.photoURL || undefined,
        isAdminVerified: true,
        authProvider: 'firebase'
      }
    } catch (err: unknown) {
      const msg = extractErrorMessage(err)
      if (msg.startsWith('Access denied:')) {
        throw err instanceof Error ? err : new Error(msg)
      }
      throw new Error(formatFirebaseAuthError(err))
    }
  }

  // Local test-mode adapter (only active when Firebase is disabled in tests)
  if (password.length < 6) {
    throw new Error('Invalid admin password (minimum 6 characters).')
  }

  const session: AdminUserSession = {
    uid: `local_admin_${btoa(email).replace(/=/g, '')}`,
    email,
    displayName: 'Admin',
    isAdminVerified: true,
    authProvider: 'local-dev'
  }
  sessionStorage.setItem(LOCAL_ADMIN_SESSION_KEY, JSON.stringify(session))
  return session
}

/**
 * Legacy helper kept for compatibility; strictly enforces the single authorized admin email.
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
          'Access denied: Only the designated single admin account can access the admin panel.'
        )
      }

      return {
        uid: user.uid,
        email: user.email || '',
        displayName: user.displayName || 'Admin',
        photoURL: user.photoURL || undefined,
        isAdminVerified: true,
        authProvider: 'google'
      }
    } catch (err: unknown) {
      const msg = extractErrorMessage(err)
      if (msg.startsWith('Access denied:')) {
        throw err instanceof Error ? err : new Error(msg)
      }
      throw new Error(formatFirebaseAuthError(err))
    }
  }

  const singleAdminEmail = getSingleAuthorizedAdminEmail()
  const session: AdminUserSession = {
    uid: `local_google_admin_${btoa(singleAdminEmail).replace(/=/g, '')}`,
    email: singleAdminEmail,
    displayName: 'Admin',
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
    } catch (err: unknown) {
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
          displayName: user.displayName || 'Admin',
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
    const singleAdminEmail = getSingleAuthorizedAdminEmail()
    if (
      parsed &&
      parsed.isAdminVerified &&
      parsed.email?.toLowerCase() === singleAdminEmail
    ) {
      return Promise.resolve(parsed)
    }
    return Promise.resolve(null)
  } catch {
    return Promise.resolve(null)
  }
}
