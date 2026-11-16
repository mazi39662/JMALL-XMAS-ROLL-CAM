/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY?: string
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string
  readonly VITE_FIREBASE_PROJECT_ID?: string
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string
  readonly VITE_FIREBASE_APP_ID?: string
  readonly VITE_DEFAULT_EVENT_ID?: string
  readonly VITE_ADMIN_EMAILS?: string
  readonly VITE_STORAGE_PROVIDER?: 'cloudinary' | 'imgbb' | 'local'
  readonly VITE_CLOUDINARY_CLOUD_NAME?: string
  readonly VITE_CLOUDINARY_UPLOAD_PRESET?: string
  readonly VITE_CLOUDINARY_FOLDER?: string
  readonly VITE_IMGBB_API_KEY?: string
  readonly VITE_PRESERVE_ORIGINAL_PHOTO?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

