# FoodApp — Web PWA & Capacitor Mobile Setup Guide

This guide covers the complete setup, build verification, and testing workflows for **FoodApp (`fapp`)** inside `apps/frontend` (pnpm + Turborepo + Biome v2), targeting **Web PWA**, **Android**, and **iOS** from a single codebase, along with local and cloud testing workflows.

---

## 1. Architecture Overview

- **Monorepo:** pnpm workspaces + Turborepo + Biome v2
- **Frontend Workspace:** `apps/frontend` (Vite 8 + React 19 + Tailwind CSS v4 + shadcn/ui `aria-luma`)
- **Web PWA:** `vite-plugin-pwa` + `@vite-pwa/assets-generator` + `workbox-window` (`registerType: "prompt"`)
- **Native Mobile Shell:** Capacitor (`@capacitor/core`, `@capacitor/cli`, `@capacitor/android`, `@capacitor/ios`)
- **Service Worker Isolation:** The PWA Service Worker is enabled for standard web builds (`pnpm build`) and automatically disabled during Capacitor Capacitor native builds (`CAPACITOR_BUILD=true`) so native WebViews never suffer from stale Service Worker caching.

---

## 2. Setup Steps Completed

### Phase 1: Web PWA Setup (`apps/frontend`)

1. **Installed PWA packages:**

   ```bash
   pnpm --filter frontend add -D vite-plugin-pwa @vite-pwa/assets-generator workbox-window
   ```

2. **Added source logo:**
   - Placed `apps/frontend/public/logo.svg` for automatic icon and favicon generation at build time.

3. **Created `apps/frontend/pwa.config.ts`:**
   - Configured `name: "FoodApp"`, `short_name: "fapp"`, `display: "standalone"`, `orientation: "any"`, `registerType: "prompt"`, and `CacheFirst` runtime caching (`statuses: [0, 200]`) for menu/food images.

4. **Updated `apps/frontend/index.html`:**
   - Added `viewport-fit=cover` for mobile notch/safe-area support and Apple PWA meta tags (`apple-mobile-web-app-capable`, `apple-mobile-web-app-title`).

5. **Updated TypeScript project references:**
   - Added `"vite-plugin-pwa/client"` to `compilerOptions.types` in `apps/frontend/tsconfig.app.json`.
   - Added `"pwa.config.ts"` to `include` in `apps/frontend/tsconfig.node.json`.

6. **Created update prompt UI:**
   - Built `apps/frontend/src/components/ui/pwa-reload-prompt.tsx` using `useRegisterSW` to notify users/cashiers before reloading when an update is ready.
   - Mounted `<PwaReloadPrompt />` inside `apps/frontend/src/App.tsx`.

---

### Phase 2: Capacitor Setup (`apps/frontend`)

1. **Installed Capacitor packages inside `apps/frontend`:**

   ```bash
   pnpm --filter frontend add @capacitor/core
   pnpm --filter frontend add -D @capacitor/cli @capacitor/android @capacitor/ios
   ```

   _(Installed directly inside `apps/frontend` so pnpm links `@capacitor/*` locally without needing a root `.npmrc`.)_

2. **Initialized Capacitor config**

   ```bash
   pnpm --filter frontend exec cap init "FoodApp" "com.foodapp.pos" --web-dir dist
   ```

3. **Generated native Android & iOS projects:**

   ```bash
   pnpm --filter frontend build
   pnpm --filter frontend exec cap add android
   pnpm --filter frontend exec cap add ios
   ```

4. **Updated `apps/frontend/vite.config.ts`:**
   - Disabled `VitePWA` when `CAPACITOR_BUILD=true` and used `import.meta.dirname` for Vite 8 compatibility:

   ```ts
   import path from 'node:path';
   import tailwindcss from '@tailwindcss/vite';
   import react from '@vitejs/plugin-react';
   import { defineConfig } from 'vite';
   import { VitePWA } from 'vite-plugin-pwa';
   import { pwaConfig } from './pwa.config.ts';

   const isCapacitor = process.env.CAPACITOR_BUILD === 'true';

   export default defineConfig({
     plugins: [
       react(),
       tailwindcss(),
       VitePWA({
         ...pwaConfig,
         disable: isCapacitor,
       }),
     ],
     resolve: {
       alias: {
         '@': path.resolve(import.meta.dirname, './src'),
       },
     },
   });
   ```

   ```ts
   - Wired `VitePWA({ ...pwaConfig, disable: isCapacitor })` and `import.meta.dirname`.
   ```

5. **Updated `apps/frontend/package.json` scripts:**

   ```json
   {
     "scripts": {
       "dev": "vite --host",
       "build": "tsc -b && vite build",
       "build:cap": "CAPACITOR_BUILD=true tsc -b && CAPACITOR_BUILD=true vite build",
       "cap:sync": "pnpm build:cap && cap sync",
       "cap:android": "cap open android",
       "cap:ios": "cap open ios",
       "format": "biome format --write src",
       "fixed": "biome check --write src",
       "lint": "biome lint src",
       "preview": "vite preview"
     }
   }
   ```

6. **Configured Turborepo (`turbo.json`) & Biome (`biome.json`):**
   - Added `"CAPACITOR_BUILD"` to `globalEnv` in root `turbo.json` so PWA and Capacitor build caches stay separate.
   - Excluded generated native folders in root `biome.json`:

   ```json
   {
     "files": {
       "includes": ["**", "!**/dist", "!**/android", "!**/ios"]
     }
   }
   ```

---

## 3. PWA Build & Testing Workflow

Service Workers only run in production builds (`vite preview`), not in `vite dev`. Follow these steps to verify the PWA build:

### Step 1: Run Production PWA Build & Verify `dist/`

```bash
pnpm --filter frontend build
```
Confirm the build output generates:

- `dist/sw.js` and `dist/workbox-*.js`
- `dist/manifest.webmanifest`
- Auto-generated PWA icons (`pwa-64x64.png`, `pwa-192x192.png`, `pwa-512x512.png`, `maskable-icon-512x512.png`, `apple-touch-icon.png`)

### Step 2: Start Local Preview Server

```bash
pnpm --filter frontend preview --host
```
Open `http://localhost:4173` in Firefox or Chrome.

### Step 3: Verify Manifest & Service Worker

- **Chrome:** Open **DevTools (`F12`) → Application → Manifest** (verify `FoodApp` / `fapp` and icons load with zero warnings) and **Service Workers** (confirm `sw.js` is activated and running).
- **Firefox:** Open `about:debugging#/runtime/this-firefox` → **Service Workers** to confirm `sw.js` is registered and running.

### Step 4: Test Offline Mode

1. In Firefox, select **File → Work Offline** (or in Chrome/Firefox DevTools **Network** tab, change throttling to **Offline**).
2. Refresh the page (`F5`).
3. Confirm the entire UI shell and cached assets load immediately without an internet connection.

### Step 5: Test the `registerType: "prompt"` Update Flow

1. Keep `pnpm --filter frontend preview` running in Terminal 1.
2. Edit visible text in `apps/frontend/src/App.tsx`.
3. Run `pnpm --filter frontend build` in Terminal 2 to generate a new `sw.js` bundle.
4. Refresh the open browser tab (`http://localhost:4173`).
5. Confirm the **"New version of FoodApp available"** prompt appears in the bottom-right corner, click **Reload & Update**, and verify the new text renders.

---

## 4. Capacitor Sync & Mobile Testing Workflow

Whenever you update React code, Tailwind styles, or install new Capacitor plugins, sync the bundle to `android/` and `ios/`:

```bash
pnpm --filter frontend cap:sync
```
_(This runs `CAPACITOR_BUILD=true` so `dist/` is built without `sw.js` and copied into `android/` and `ios/`.)_

### Option A: Test Without Android Studio or a Mac (Cloud Build + Online Simulator)

1. **Build `.apk` (Android) and `.app` (iOS) via Cloud CI:**
   - Use **GitHub Actions**, **Codemagic**, or **Ionic Appflow**:
     - **Android:** Run `./gradlew assembleDebug` inside `apps/frontend/android` on `ubuntu-latest` to generate `app-debug.apk`.
     - **iOS:** Run `xcodebuild -scheme App -sdk iphonesimulator -configuration Debug` inside `apps/frontend/ios/App` on `macos-latest` to generate `App.app`.
2. **Test in a Browser-Based Virtual Device:**
   - Upload `app-debug.apk` or zipped `App.app` to **[Appetize.io](https://appetize.io)** (free tier) or **BrowserStack App Live** to test FoodApp on virtual iPhones, iPads, and Android tablets in your browser.
3. **Quick Wi-Fi Mobile Check (No Compilation):**
   - Run `pnpm --filter frontend dev`, open `http://<YOUR-LAN-IP>:5173` on a phone/tablet, and use **Add to Home Screen** on iOS Safari to test WebKit layout and safe-area insets.

### Option B. Test Locally with Native Tooling (Optional)

- **Android (CLI Only — No Android Studio IDE Required):**
  1. Install OpenJDK 21 + Android Command Line Tools (`sdkmanager` with `platform-tools` and `build-tools`).
  2. Connect an Android device via USB with **USB Debugging** enabled.
  3. Run:

     ```bash
     pnpm --filter frontend cap:sync
     pnpm --filter frontend exec cap run android
     ```

- **Android (Android Studio):**

  ```bash
  pnpm --filter frontend cap:sync
  pnpm --filter frontend cap:android
  ```

- **iOS (macOS + Xcode Required):**

  ```bash
  pnpm --filter frontend cap:sync
  pnpm --filter frontend cap:ios
  ```

---

# Capacitor Health Check Guide (While Developing PWA-First)

Since primary development is focused on the **Web PWA** without local Android Studio or Xcode installations, use this checklist to ensure the **Android** and **iOS** Capacitor targets never silently break as you add features and dependencies.

---

## 1. Routine Terminal Check (`cap:sync`)

Run this command after installing new npm packages, changing `vite.config.ts`, or finishing a major PWA feature:

```bash
pnpm --filter frontend cap:sync
```

### What This Verifies Automatically on Linux:

1. **`CAPACITOR_BUILD=true tsc -b && vite build`**: Confirms TypeScript and Vite compile cleanly with `VitePWA` disabled.
2. **`cap sync`**: Copies `dist/` into `apps/frontend/android` and `apps/frontend/ios`, regenerates `capacitor.plugins.json`, and validates that all installed Capacitor plugins resolve properly.

> **Tip:** After running `cap:sync`, check `git status`—only synced web assets or updated plugin registries should change. Avoid deleting `apps/frontend/android` or `apps/frontend/ios`.

---

## 2. Three Coding Rules That Prevent Native Breakage

### Rule 1: Always Guard Native-Only APIs

Capacitor runs on `capacitor://localhost` (iOS) and `http://localhost` (Android), whereas your PWA runs in a standard browser. Whenever you add native features (SQLite, Bluetooth thermal printing, biometrics, etc.), always check `Capacitor.isNativePlatform()`:

```ts
import { Capacitor } from '@capacitor/core';

if (Capacitor.isNativePlatform()) {
  // Native iOS / Android implementation
} else {
  // Web PWA fallback (e.g., IndexedDB / browser APIs)
}
```

### Rule 2: Never Use Relative `/api` Paths for Backend Requests

Inside a WebView (`http://localhost`), a relative fetch like `fetch('/api/orders')` will try to hit the local phone filesystem instead of your backend server.

- Always configure a full base URL via environment variables:

  ```ts
  const API_URL = import.meta.env.VITE_API_URL; // e.g., https://foodapp.com
  ```

### Rule 3: Import Local Assets Instead of Hardcoding Root Paths

For icons, sounds (e.g., new order alert chimes), or images inside `src/`, import them via ES modules so Vite bundles them cleanly for both Web and Capacitor:

```ts
import orderChime from '@/assets/sounds/new-order.mp3';
```

---

## 3. Automated Cloud Compile Check (No Mac or Android Studio Required)

If your repository is hosted on GitHub, add `.github/workflows/capacitor-check.yml` to automatically verify that both **Android (`.apk`)** and **iOS Simulator (`.app`)** compile cleanly whenever you push to `main`:

```yaml
name: Capacitor Build Check

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  verify-web-and-sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: "pnpm"
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter frontend cap:sync

  verify-android:
    needs: verify-web-and-sync
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: "pnpm"
      - uses: actions/setup-java@v4
        with:
          distribution: "temurin"
          java-version: "21"
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter frontend cap:sync
      - name: Build Android Debug APK
        working-directory: apps/frontend/android
        run: ./gradlew assembleDebug
      - uses: actions/upload-artifact@v4
        with:
          name: foodapp-android-debug
          path: apps/frontend/android/app/build/outputs/apk/debug/app-debug.apk

  verify-ios:
    needs: verify-web-and-sync
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: "pnpm"
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter frontend cap:sync
      - name: Build iOS Simulator Bundle
        working-directory: apps/frontend/ios/App
        run: |
          xcodebuild -project App.xcodeproj \
            -scheme App \
            -sdk iphonesimulator \
            -configuration Debug \
            -derivedDataPath build \
            CODE_SIGNING_ALLOWED=NO
      - uses: actions/upload-artifact@v4
        with:
          name: foodapp-ios-simulator
          path: apps/frontend/ios/App/build/Build/Products/Debug-iphonesimulator/App.app
```

### How to Use the CI Artifacts:

- Download `foodapp-android-debug` (`app-debug.apk`) or `foodapp-ios-simulator` (`App.app`, zipped) from the GitHub Actions run.
- Upload either file to **[Appetize.io](https://appetize.io)** to test your live app on virtual iPhones, iPads, and Android tablets directly in your browser.
