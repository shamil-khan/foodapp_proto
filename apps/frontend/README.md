# 🍔 FoodApp (`fapp`)

An **offline-first Point of Sale (POS) and Food Ordering application** built from a single codebase to run seamlessly across **Web (PWA)**, **Android**, and **iOS**.

---

## ✨ What Has Been Completed

- [x] **Monorepo Foundation:** Configured with **pnpm workspaces**, **Turborepo**, and **Biome v2** for fast builds, strict linting, and consistent formatting.
- [x] **Modern Frontend & Accessible UI:** Set up **Vite 8**, **React 19**, **TypeScript**, **Tailwind CSS v4**, and **shadcn/ui (`aria-luma` style)** powered by **React Aria Components** and **Lucide Icons**.
- [x] **Structured Logging:** Integrated **LogTape** (`@logtape/logtape`) with environment-aware log levels (`debug` in development, `warning` in production).
- [x] **Offline-Ready Web PWA:**
  - Configured `vite-plugin-pwa` with automatic asset/icon generation (`@vite-pwa/assets-generator`) from `public/logo.svg`.
  - Implemented `CacheFirst` runtime caching for menu and food images so catalogs remain visible offline.
  - Built a custom `<PwaReloadPrompt />` component (`registerType: "prompt"`) so active POS checkouts are never interrupted by background reloads.
- [x] **Cross-Platform Mobile Shells (Android & iOS):**
  - Integrated **Capacitor** (`com.foodapp.pos`) directly inside `apps/frontend` with generated `android/` and `ios/` projects.
  - Configured environment isolation (`CAPACITOR_BUILD=true`) so the PWA Service Worker runs on Web while remaining disabled inside native Capacitor WebViews.
- [x] **Documentation & Maintenance Guides:** Added `MOBILE_AND_PWA.md` and `CAPACITOR_HEALTH_CHECK.md` for local/cloud testing and native build verification.

---

## 🛠️ Tech Stack

| Category                  | Technology                                                            | Purpose                                                          |
| :------------------------ | :-------------------------------------------------------------------- | :--------------------------------------------------------------- |
| **Monorepo & Tooling**    | pnpm, Turborepo, Biome v2                                             | Workspace management, build caching, linting & formatting        |
| **Core Framework**        | React 19, Vite 8, TypeScript                                          | Fast SPA bundling with HMR and strict type safety                |
| **Styling & UI**          | Tailwind CSS v4, shadcn/ui (`aria-luma`), React Aria                  | Accessible, touch-friendly components for POS & mobile           |
| **Icons & Typography**    | Lucide React, Inter Variable (`@fontsource-variable/inter`)           | Crisp vector icons and self-hosted variable fonts                |
| **PWA & Offline Caching** | `vite-plugin-pwa`, Workbox, `@vite-pwa/assets-generator`              | Installable Web App, asset precaching, controlled update prompts |
| **Native Mobile Runtime** | Capacitor (`@capacitor/core`, `@capacitor/android`, `@capacitor/ios`) | Wraps the web bundle into native Android & iOS apps              |
| **Logging**               | LogTape (`@logtape/logtape`)                                          | Lightweight, structured client-side diagnostics                  |

---

## 📂 Project Structure

```text
foodapp_proto/
├── apps/
│   └── frontend/                  # Main Vite + React + PWA + Capacitor app
│       ├── android/               # Native Android project (Capacitor)
│       ├── ios/                   # Native iOS project (Capacitor)
│       ├── public/
│       │   └── logo.svg           # Source logo for auto-generated PWA icons
│       ├── src/
│       │   ├── components/
│       │   │   └── ui/            # shadcn/ui (React Aria) + PwaReloadPrompt
│       │   ├── lib/               # Utility helpers (cn)
│       │   ├── App.tsx            # Root application component
│       │   ├── index.css          # Tailwind v4 theme & design tokens
│       │   ├── logger.ts          # LogTape configuration
│       │   └── main.tsx           # App entry point
│       ├── capacitor.config.ts    # Capacitor native app config
│       ├── pwa.config.ts          # PWA manifest & Workbox caching rules
│       └── vite.config.ts         # Vite bundler + conditional PWA setup
├── biome.json                     # Biome v2 linter & formatter rules
├── turbo.json                     # Turborepo task & environment pipeline
├── MOBILE_AND_PWA.md              # PWA & Capacitor setup and testing guide
├── CAPACITOR_HEALTH_CHECK.md      # Native compatibility & CI check guide
└── README.md                      # Project overview
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** `>= 22.13` (Node.js 24 LTS or 26 Active LTS recommended)
- **pnpm** `12.16.1`

### Installation

```bash
pnpm install
```

### Development (Web & LAN Mobile Preview)

```bash
pnpm --filter frontend dev
```
Starts the Vite dev server with `--host` enabled so you can open it on both your desktop browser and mobile devices on the same Wi-Fi network.

### Production PWA Build & Preview

```bash
pnpm --filter frontend build
pnpm --filter frontend preview --host
```

### Sync Bundle to Native Mobile Projects (Android & iOS)

```bash
pnpm --filter frontend cap:sync
```

### Code Quality (Biome)

```bash
pnpm --filter frontend lint     # Run linter
pnpm --filter frontend format   # Format files
pnpm --filter frontend fixed    # Auto-fix lint & format issues
```

---

## 📖 Additional Documentation

- **[MOBILE_AND_PWA.md](./MOBILE_AND_PWA.md)** — Full walkthrough of PWA offline verification, update prompt testing, and cloud/local Android & iOS testing.
- **[CAPACITOR_HEALTH_CHECK.md](./CAPACITOR_HEALTH_CHECK.md)** — Guidelines and GitHub Actions CI workflow to keep Android/iOS builds healthy while developing PWA-first.

---

## 🗺️ Roadmap (Next Steps)

- [ ] **Routing:** Add type-safe client routing (`TanStack Router`) for POS register, kitchen view, and customer ordering screens.
- [ ] **Offline-First Storage & Sync:** Integrate local persistence (`Dexie.js` on Web / `@capacitor-community/sqlite` on Native) with background order syncing when connectivity returns.
- [ ] **POS & Ordering UI:** Build menu catalog, cart/modifier drawers, order checkout, and receipt/KOT generation.
