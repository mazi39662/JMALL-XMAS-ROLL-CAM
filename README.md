# XMAS ROLL — Christmas Party Digital Disposable Camera

> **“One night. One camera. A thousand memories.”**

**XMAS ROLL** is a mobile-first web application built with **Vue 3, TypeScript, Vite, Pinia, Vue Router, SCSS, and Firebase (Spark Plan)** that turns every guest’s smartphone into a nostalgic 35mm disposable film camera during the Christmas party.

Each registered guest receives **10 photo exposures**. Captured photos are processed client-side through an authentic 35mm Canvas pipeline (silver-halide film grain, Kodak Gold / Fuji Superia / Holiday Velvet vintage color grading, xenon flash simulation, optical vignette, 35mm rebate borders, and quartz date stamps) and collected in a centralized event gallery for the organizer to moderate and export as a structured **ZIP archive** for the Christmas party slideshow.

---

## 1. Architecture & Free-Tier Infrastructure Design

### Why Firebase Storage Is Not Required (Zero Billing / No Blaze Plan Needed)
Firebase Storage requires upgrading a Firebase project to the **Blaze (pay-as-you-go)** billing plan. To guarantee **XMAS ROLL** remains 100% usable without a paid subscription or credit card, this project uses:

1. **Cloud Firestore (Spark Free Plan)** for guest registrations, duplicate-prevention locks, atomic 10-shot camera sessions, event settings, and photo metadata (**no binary image data is ever stored in Firestore**).
2. **Firebase Authentication (Spark Free Plan)** for organizer/admin login and role verification.
3. **Firebase Hosting (Spark Free Plan)** for fast global HTTPS hosting (required for mobile browser `navigator.mediaDevices.getUserMedia` camera access).
4. **Storage Provider Abstraction (`src/services/storageAdapter.ts`)** supporting three pluggable image-storage adapters:

### Free Image-Storage Providers & Limitations

| Provider (`VITE_STORAGE_PROVIDER`) | Free Tier Quota & Bandwidth | Publicly Accessible Across Devices? | Limitations & Production Notes |
| :--- | :--- | :--- | :--- |
| **`cloudinary`** *(Recommended for Production)* | **25 Monthly Credits** (~25 GB storage or 25 GB monthly bandwidth, enough for **~12,000+ compressed 35mm party photos**) | **Yes** (Global HTTPS CDN URLs stored in Firestore) | Uses an **Unsigned Upload Preset** (`VITE_CLOUDINARY_UPLOAD_PRESET`). Restrict allowed formats (`jpg,png,webp`) and max file size (`8 MB`) in your Cloudinary preset settings. |
| **`imgbb`** *(Alternative Free API)* | Unlimited total storage; **32 MB max file size** per image | **Yes** (Public HTTPS URLs stored in Firestore) | Uses a free API key from `https://api.imgbb.com/`. Because the key is used client-side, create a dedicated key for the event and rotate/delete it after exporting the party ZIP. |
| **`local`** *(Default Development Adapter)* | Limited only by local browser storage (`IndexedDB`) | **No** (`isPublic: false` — single browser/device only) | Automatically used when no cloud keys are configured yet so you can run, test, and verify the entire app immediately. **Never use `local` for a multi-device live party**; configure `cloudinary` or `imgbb` before live deployment. |

---

## 2. Project Structure

```text
├── .env.example                  # Environment variable template
├── firebase.json                 # Firebase Hosting & Firestore config
├── firestore.rules               # Server-side Firestore security rules (10-shot transaction enforcement)
├── firestore.indexes.json        # Composite Firestore indexes
├── src/
│   ├── __tests__/
│   │   └── xmasRoll.spec.ts      # Vitest suite covering registration, 10 shots, concurrency, & ZIP export
│   ├── components/
│   │   └── GuestHeader.vue       # Mobile-first navigation bar & live shot counter badge
│   ├── composables/
│   │   └── useDisposableCamera.ts# MediaDevices camera lifecycle, front/rear lens switch, & flash burst
│   ├── router/
│   │   └── index.ts              # Protected guest & admin routes
│   ├── services/
│   │   ├── adminAuth.ts          # Firebase Auth + Admin role verification (claims / admins/{uid} / allowlist)
│   │   ├── filmProcessor.ts      # 2D Canvas 35mm film grain, LUT color grading, vignette, & quartz stamp
│   │   ├── firebase.ts           # Firebase SDK initialization
│   │   ├── repository.ts         # Atomic Firestore transactions & local persistence fallback
│   │   ├── storageAdapter.ts     # Pluggable Cloudinary / ImgBB / Local IndexedDB storage provider
│   │   └── zipExporter.ts        # Individual photo download & JSZip organized bulk export
│   ├── stores/
│   │   └── sessionStore.ts       # Pinia store for active guest roll, event config, & admin session
│   ├── styles/
│   │   ├── variables.scss        # Retro palette (#F5F0E6, #183D32, #B53B35, #C7A66A, #252525)
│   │   └── main.scss             # Global typography, film sprocket strips, tactile buttons
│   ├── types/
│   │   └── index.ts              # Strict TypeScript interfaces
│   └── views/
│       ├── LandingView.vue       # Guest landing page with 35mm camera illustration
│       ├── RegisterView.vue      # Guest registration & returning session recovery
│       ├── CameraView.vue        # Main Digital Disposable Camera & film preview modal
│       ├── GuestGalleryView.vue  # Guest's personal 10-frame contact sheet
│       ├── AdminLoginView.vue    # Protected organizer login
│       └── AdminDashboardView.vue# Overview stats, Guest table, QR generator, Gallery moderation, & ZIP export
```

---

## 3. Local Development Setup

### Prerequisites
- **Node.js** `>= 20.x`
- **npm** `>= 10.x`

### Step 1: Install Dependencies
```bash
npm install
```

### Step 2: Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
*(Note: You can run the app immediately even before filling in `.env`—it will automatically activate the Local Persistence & Local Development Storage Adapter and display a transparent diagnostic banner in the Admin Dashboard.)*

### Step 3: Start Development Server
```bash
npm run dev
```

### Step 4: Run Automated Tests & Typecheck
```bash
npm run test
npm run typecheck
npm run build
```

---

## 4. Firebase Setup (Spark Free Plan)

1. Go to the [Firebase Console](https://console.firebase.google.com/) and create a new project (keep it on the **Spark Free Plan**).
2. **Enable Authentication**:
   - Navigate to **Build → Authentication → Sign-in method**.
   - Enable **Email/Password** authentication.
   - Under the **Users** tab, create your organizer account (e.g., `admin@jmall.com`).
3. **Enable Cloud Firestore**:
   - Navigate to **Build → Firestore Database** and click **Create database**.
   - Deploy the security rules in `firestore.rules` (or paste them into the Firestore **Rules** tab).
   - **Authorize your Admin UID**: In Firestore, create a collection named `admins` and add a document whose Document ID is your Firebase Auth User `uid` with field `{ "role": "admin" }`, and/or add your admin email to `VITE_ADMIN_EMAILS` in `.env`.
4. **Register a Web App**:
   - In **Project Settings → General → Your apps**, click the Web (`</>`) icon.
   - Copy `apiKey`, `authDomain`, `projectId`, `messagingSenderId`, and `appId` into your `.env` file.

---

## 5. Free Image Storage Setup (Cloudinary)

1. Create a free account at [Cloudinary](https://cloudinary.com/users/register_free) (no credit card required).
2. In the Cloudinary Console, copy your **Cloud Name** and set `VITE_CLOUDINARY_CLOUD_NAME` in `.env`.
3. Go to **Settings (Gear Icon) → Upload → Upload Presets** and click **Add Upload Preset**:
   - **Signing Mode**: Select **Unsigned**.
   - **Folder**: `xmas-roll-2026`
   - **Allowed Formats**: `jpg, png, webp`
   - Save the preset and copy its name into `VITE_CLOUDINARY_UPLOAD_PRESET` in `.env`.
4. Set `VITE_STORAGE_PROVIDER=cloudinary` in `.env`.

---

## 6. Deployment to Firebase Hosting

1. Install the Firebase CLI if not already installed:
   ```bash
   npm install -g firebase-tools
   ```
2. Log in and link your Firebase project:
   ```bash
   firebase login
   firebase use --add
   ```
3. Build the production bundle:
   ```bash
   npm run build
   ```
4. Deploy Firestore Security Rules, Indexes, and Hosting:
   ```bash
   firebase deploy --only firestore,hosting
   ```
5. Open your deployed `https://<your-project>.web.app/admin` URL, go to **QR Code Management**, and download or display the registration QR code for your guests!

