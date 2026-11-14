# AI Assistant Context & Coding Guidelines — FoodApp (`fapp`)

> **Purpose:** Use this file as system/project context when prompting AI coding assistants (Cursor, Claude Code, GitHub Copilot, Gemini, etc.) so generated code adheres strictly to our monorepo architecture, React Aria UI primitives, offline-first POS requirements, and Capacitor compatibility.

---

## 1. Project Identity & Core Domain

- **App Name:** FoodApp (`fapp`)
- **App ID:** `com.foodapp.pos`
- **Domain:** Hybrid **Offline-First Point of Sale (POS)** (for restaurant cashiers/tablets) and **Food Ordering App** (for mobile/web customers).
- **Target Platforms:** Single codebase running as a **Web PWA**, **Android app**, and **iOS app** via Capacitor.
- **Primary Development Mode:** PWA-first on Linux, with periodic Capacitor sync checks (`pnpm --filter frontend cap:sync`).

---

## 2. Tech Stack & Exact Versions

- **Package Manager & Monorepo:** `pnpm@12.16.1` workspaces + **Turborepo** (`Node.js >= 22.13`, recommended Node 24/26 LTS)
- **Linter & Formatter:** **Biome v2** (root `biome.json` — single quotes, 2-space indent, `files.includes` excluding `dist`, `android`, `ios`)
- **Frontend Workspace (`apps/frontend`):**
  - **Bundler & Framework:** Vite 8 (`rolldown`), React 19, TypeScript (`~7.0`, `erasableSyntaxOnly: true`, `verbatimModuleSyntax: true`)
  - **Styling:** Tailwind CSS v4 (`@tailwindcss/vite`, `@theme inline` in `src/index.css`, `tw-animate-css`)
  - **UI Components:** `shadcn/ui` with **`aria-luma` style** built on **`react-aria-components`** (NOT Radix UI)
  - **Class Merging Utility:** `import { cn } from 'cn'` (or `@/lib/utils`)
  - **Icons & Fonts:** `lucide-react`, `@fontsource-variable/inter`
  - **Logging:** `@logtape/logtape` (`import { logger } from '@/logger'`)
  - **PWA:** `vite-plugin-pwa` + `@vite-pwa/assets-generator` + `workbox-window` (`registerType: 'prompt'`)
  - **Native Wrapper:** Capacitor v8 (`@capacitor/core`, `@capacitor/cli`, `@capacitor/android`, `@capacitor/ios`)

---

## 3. Critical Coding Conventions (Strict Rules)

### A. React Aria `shadcn/ui` (`aria-luma`) Rules

Our UI components in `apps/frontend/src/components/ui/` are built on **`react-aria-components`**, NOT Radix UI.

1. **Events:** Use `onPress` instead of `onClick` on `<Button>` and `<LinkButton>` components from `@/components/ui/button`.
2. **Tabs:** `<Tabs>`, `<TabsList>`, `<TabsTrigger>`, and `<TabsContent>` wrap `react-aria-components` (`TabList`, `Tab`, `TabPanel`). Use `id` props instead of `value` for tab selection keys.
3. **Sheets / Modals:** `<Sheet>` wraps `ModalOverlay` + `Modal` + `Dialog` from `react-aria-components`. Use `<SheetTrigger>` around a `<Button>` and `<Sheet>` (with `side="bottom" | "right" | "left" | "top"`).
4. **Styling & Variants:** Follow `aria-luma` pill/rounded aesthetics (`rounded-3xl`, `rounded-4xl`, `rounded-full`) and existing CSS tokens (`bg-background`, `text-foreground`, `bg-muted`, `border-border`).

### B. TypeScript & Biome v2 Rules

1. **`erasableSyntaxOnly: true` is enabled:** NEVER use TypeScript `enum`, `namespace`, or parameter properties (`constructor(private x: string)`). Use `as const` union objects instead of `enum`.
2. **`verbatimModuleSyntax: true` is enabled:** Always use explicit `import type { ... }` for type-only imports.
3. **Logging:** Never leave raw `console.log` in application code; use `import { logger } from '@/logger'` (`logger.debug`, `logger.info`, `logger.warning`, `logger.error`). Note that LogTape uses `'warning'`, NOT `'warn'`.
4. **Formatting:** Use single quotes (`'`) in TS/TSX files and run `pnpm --filter frontend fixed` to satisfy Biome.

### C. Offline-First POS & Capacitor Compatibility Rules

1. **Guard Native APIs:** Any native plugin (SQLite, Bluetooth thermal printing, biometrics, filesystem) MUST check `Capacitor.isNativePlatform()` and provide a Web PWA fallback:

   ```ts
   import { Capacitor } from '@capacitor/core';

   if (Capacitor.isNativePlatform()) {
     // Native iOS / Android call
   } else {
     // Web PWA fallback (IndexedDB / browser API)
   }
   ```
2. **Client-Generated IDs:** Always generate order IDs, cart IDs, and offline invoice numbers client-side using `crypto.randomUUID()` (or ULIDs) so offline POS devices never collide during background sync.
3. **No Relative `/api` Fetch Calls:** Capacitor WebViews run on `http://localhost` (Android) and `capacitor://localhost` (iOS). Always prefix API requests with `import.meta.env.VITE_API_URL`.
4. **Safe-Area Awareness:** Account for mobile notches and home indicators (`viewport-fit=cover` is set in `index.html`) using `pt-[env(safe-area-inset-top)]` and `pb-[env(safe-area-inset-bottom)]` on full-screen headers and bottom bars.
5. **Service Worker Isolation:** Never modify `vite.config.ts` to enable `VitePWA` during `CAPACITOR_BUILD=true`; the Service Worker must remain disabled inside native Capacitor shells.

---

## 4. Key Files Reference (`apps/frontend`)

- `apps/frontend/vite.config.ts` — Vite config (`@` alias -> `./src`, conditional `VitePWA`)
- `apps/frontend/pwa.config.ts` — PWA manifest (`FoodApp` / `fapp`), `registerType: 'prompt'`, Workbox `CacheFirst` image caching
- `apps/frontend/capacitor.config.ts` — Capacitor app config (`appId: 'com.foodapp.pos'`, `webDir: 'dist'`)
- `apps/frontend/src/logger.ts` — LogTape setup (`logger` exported under category `['app']`)
- `apps/frontend/src/components/ui/pwa-reload-prompt.tsx` — Controlled PWA update toast/prompt
- `apps/frontend/src/index.css` — Tailwind v4 `@theme inline` tokens and OKLCH color variables

---

## 5. Standard Commands

```bash
pnpm --filter frontend dev          # Start Vite dev server (--host)
pnpm --filter frontend build        # Type-check + build Web PWA
pnpm --filter frontend preview      # Preview production PWA locally
pnpm --filter frontend cap:sync     # Build with CAPACITOR_BUILD=true & sync to android/ios
pnpm --filter frontend fixed        # Run Biome check & auto-fix on src/
```

---

## 6. Prompt Template for New Features

When asking an AI assistant to build a new feature in this repo, copy-paste this header:

> "Follow all conventions in `AI_CONTEXT.md`. Use React 19, TypeScript (`erasableSyntaxOnly`, `verbatimModuleSyntax`), Tailwind CSS v4, and our existing `react-aria-components`-based `shadcn/ui` (`aria-luma`) components in `@/components/ui/*` (remember `onPress` instead of `onClick`). Ensure full offline-first support and `Capacitor.isNativePlatform()` compatibility."
