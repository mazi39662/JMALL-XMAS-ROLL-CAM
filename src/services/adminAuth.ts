import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User
} from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db, getAuthorizedAdminEmails, isFirebaseConfigured } from './firebase'

const LOCAL_ADMIN_SESSION_KEY = 'xmas_roll_admin_session_v1'

export interface AdminUserSession {
  uid: string
  email: string
  isAdminVerified: boolean
  authProvider: 'firebase' | 'local-dev'
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
  return Boolean(email && allowlist.includes(email))
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
      isAdminVerified: true,
      authProvider: 'firebase'
    }
  }

  // Local Development Auth Adapter (Only active when Firebase .env keys are not yet configured)
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
        resolve({
          uid: user.uid,
          email: user.email || '',
          isAdminVerified: true,
          authProvider: 'firebase'
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

