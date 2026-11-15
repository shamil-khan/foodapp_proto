# ADR 001: TanStack Router SPA, OpenAPI 3.1 Codegen, `openapi-fetch` & POS Terminal Lock

**Target Package:** `@foodapp/frontend` (`apps/frontend`)  
**Stack:** React `^19.3.1`, Vite `^8.3.6`, Tailwind CSS v4, React Aria `shadcn/ui`, TanStack Router `^1.170.46`, TanStack Query `^5.107.1`, `openapi-fetch` `^0.17.0`, Capacitor `^8.6.2`, `@logtape/logtape` `^2.4.2`, Biome  
**Status:** Completed & Verified

---

## 1. Architectural Decisions & User Commentary

### 1.1 Routing Mode & Static Build Compatibility (`Option 1A — SPA Mode`)

- **Decision:** Use `@tanstack/react-router` (`^1.170.46`) + `@tanstack/router-plugin` (`^1.169.0`) in static SPA mode with file-based routing in `src/routes/`.
- **Rationale:** `apps/frontend` builds both a Web PWA (`vite-plugin-pwa`) for Cloudflare Pages and a static Capacitor bundle (`webDir: 'dist'`) for iOS/Android (`com.foodapp.pos`) without a Node server.

### 1.2 Route Hierarchy & Restaurant Terminal Lock (`Option 2C — Hybrid Default + Terminal Lock`)

- **Decision:** Public web users land directly on the Customer Storefront (`/`, `/restaurants/$restaurantId`, `/account/loyalty`) with zero setup friction, while staff login at `/pos/login` locks the device into POS/KDS/Kiosk mode (`/pos/_authenticated/*`) until an `OWNER`, `ADMIN`, or `MANAGER` explicitly exits Terminal Mode.
- **User Commentary:** Highlighted that in real restaurant environments, counter tablets and kitchen displays must stay locked to a specific restaurant across shift switches and offline reboots rather than allowing staff to navigate back to a public customer directory.

### 1.3 Data Fetching & Offline-First Persistence (`Option 3A — TanStack Router + TanStack Query`)

- **Decision:** Route `loader`s call `queryClient.ensureQueryData(...)` backed by `networkMode: 'offlineFirst'`, `staleTime: 2m`, and `gcTime: 24h`, generating client-side UUIDs (`crypto.randomUUID()`) for offline POS order creation.

### 1.4 Decoupled HTTP Client (`Option 4B — openapi-fetch Replacing axios Completely`)

- **Decision:** Uninstalled `axios` completely and replaced it with `openapi-fetch` (`^0.17.0`) configured with `VITE_API_URL`, `AbortSignal.timeout(8000)`, `Authorization: Bearer` request middleware, `401` session cleanup, `ApiClientError` normalization, and `@logtape/logtape` warning diagnostics.
- **User Commentary:** Decided to remove `axios` altogether rather than splitting auth and data requests across two HTTP clients, gaining strict compile-time safety on URL paths, path/query parameters, and request/response payloads across separate cloud hosts (Cloudflare Pages + AWS Lambda/Azure).

### 1.5 Unified Bearer Auth & Platform Storage (`Option 5A`)

- **Decision:** Single `Authorization: Bearer <token>` pipeline persisted via `@capacitor/preferences` (`^8.0.1`) on native iOS/Android and `localStorage` on Web, hydrated asynchronously in `main.tsx` before mounting `RouterProvider`.
- **Rationale:** Eliminates cross-domain `HttpOnly` cookie and Safari ITP issues across Cloudflare Pages, AWS/Azure, and `capacitor://localhost`.

### 1.6 Single-Location Auto-Generated OpenAPI Client Layer

- **Decision:** Built a self-contained, zero-AST-dependency Node generator (`scripts/generate-api.ts`, compatible with TypeScript `~7.0.2` / `tsgo`) that fetches `$VITE_API_URL/api/doc` (syncing `apps/frontend/contracts/openapi.json` for offline/CI fallback) and emits three files in `src/api/`:
  1. `schema.generated.ts` — Full OpenAPI 3.1 `paths` and `components` interfaces.
  2. `models.generated.ts` — Exported DTO type aliases for every schema in `components.schemas`.
  3. `endpoints.generated.ts` — Typed TanStack Query `queryOptions(...)` factories (`apiQueries`) for every `GET` endpoint.
- **User Commentary:** Requested that `contracts/openapi.json` reside inside `apps/frontend` for decoupled deployment and that all models and GET query factories be auto-generated at one central location rather than duplicated across route files.

---

## 2. Installed Packages & Resolved Versions (`apps/frontend/package.json`)

- **Removed:** `axios`
- **Runtime Dependencies:**
  - `openapi-fetch`: `^0.17.0`
  - `@tanstack/react-router`: `^1.170.46`
  - `@tanstack/react-query`: `^5.107.1`
  - `@capacitor/core`: `^8.6.2`
  - `@capacitor/preferences`: `^8.0.1`
  - `@logtape/logtape`: `^2.4.2`
  - `react`: `^19.3.1` / `react-dom`: `^19.3.1`
  - `react-aria-components`: `^1.22.1`
  - `tailwindcss`: `^4.3.5` / `@tailwindcss/vite`: `^4.3.5`
- **DevDependencies:**
  - `@tanstack/router-plugin`: `^1.169.0`
  - `@tanstack/react-router-devtools`: `^1.167.3`
  - `@tanstack/react-query-devtools`: `^5.107.1`
  - `typescript`: `~7.0.2`
  - `vite`: `^8.3.6`
  - `vite-plugin-pwa`: `^2.0.0`

---

## 3. Environment & Tooling Configuration

### 3.1 `apps/frontend/.env` & `.env.example`

```env
VITE_API_URL=http://localhost:3000
```

### 3.2 `apps/frontend/vite.config.ts`

- Registers `tanstackRouter({ target: 'react', autoCodeSplitting: true })` **before** `react()`.
- Disables `VitePWA` when `CAPACITOR_BUILD=true` so native WebViews never register a Service Worker.

### 3.3 `apps/frontend/package.json` Scripts

```json
{
  "dev": "vite",
  "api:generate": "node scripts/generate-api.ts",
  "api:generate:offline": "node scripts/generate-api.ts --offline",
  "build": "tsc -b && vite build",
  "build:gen": "vite build && tsc -b",
  "build:cap": "CAPACITOR_BUILD=true tsc -b && CAPACITOR_BUILD=true vite build",
  "cap:sync": "pnpm build:cap && cap sync",
  "format": "biome format --write src",
  "fixed": "biome check --write src",
  "lint": "biome lint src"
}
```

---

## 4. Folder & File Structure (`apps/frontend/`)

```text
apps/frontend/
├── .env
├── .env.example
├── capacitor.config.ts
├── package.json
├── vite.config.ts
├── contracts/
│   └── openapi.json                   # Offline OpenAPI 3.1 contract fallback
├── scripts/
│   └── generate-api.ts                # Dual-source OpenAPI 3.1 -> TS codegen script
├── docs/
│   └── adr/
│       └── 001-router-openapi-terminal-lock.md
└── src/
    ├── main.tsx                       # Hydrates authStore before mounting RouterProvider
    ├── logger.ts                      # @logtape/logtape browser console logger
    ├── routeTree.gen.ts               # Auto-generated by @tanstack/router-plugin
    ├── api/
    │   ├── schema.generated.ts        # Auto-generated OpenAPI 3.1 paths & components
    │   ├── models.generated.ts        # Auto-generated schema type exports
    │   └── endpoints.generated.ts     # Auto-generated apiQueries (queryOptions)
    ├── lib/
    │   ├── storage.ts                 # @capacitor/preferences (native) + localStorage (web)
    │   ├── auth-store.ts              # Unified Bearer session & POS TerminalLock store
    │   ├── api-client.ts              # openapi-fetch client + Bearer/timeout/error middleware
    │   ├── query-client.ts            # TanStack Query offlineFirst client
    │   └── format.ts                  # Safe GBP currency formatter (£0.00)
    └── routes/
        ├── __root.tsx                 # Root shell, RootErrorBoundary & <PwaReloadPrompt />
        ├── index.tsx                  # Storefront Directory (redirects to /pos if locked)
        ├── restaurants.$restaurantId.tsx # Customer Menu & Allergens view
        ├── account.loyalty.tsx        # Customer Loyalty Balance & 50pt Redemption
        └── pos/
            ├── login.tsx              # POS Shift Login (locks device to restaurantId & mode)
            └── _authenticated.tsx     # POS auth guard (GET /api/me) + Shift/Terminal controls
                ├── index.tsx          # Station mode router (POS / KDS / KIOSK)
                ├── register.tsx       # Cashier POS Register (client UUID offline-safe orders)
                ├── orders.tsx         # Active POS Orders & Bill Settlement
                ├── kds.tsx            # Kitchen Display System (10s polling)
                ├── kiosk.tsx          # Locked Self-Order Kiosk screen
                ├── menu.tsx           # Manager/Owner Optimistic Concurrency Price Update
                └── ledger.tsx         # Owner/Admin Double-Entry Financial Ledger
```

---

## 5. Build, Codegen & End-to-End Verification Steps

### 5.1 Codegen, Linting, PWA Build & Capacitor Sync

```bash
# 1. Sync OpenAPI 3.1 spec from http://localhost:3000/api/doc and generate src/api/*.generated.ts
pnpm --filter frontend api:generate

# 2. Format & lint with Biome
pnpm --filter frontend fixed

# 3. Generate routeTree.gen.ts, typecheck with tsc -b, and build production PWA
pnpm --filter frontend build:gen

# 4. Build Capacitor bundle (Service Worker disabled) and sync iOS/Android projects
pnpm --filter frontend cap:sync
```

### 5.2 Manual & Offline End-to-End Test Checklist

1. **Customer Storefront (`http://localhost:5173/`):**
   - Verify restaurants load from `GET /api/restaurants` and clicking a restaurant renders categories, prices (`basePrice`), and `allergenFlags` from `GET /api/restaurants/:id/menu`.
2. **POS Shift Login & Terminal Lock (`/pos/login`):**
   - Sign in with `staff1.0001@pos-tenant.co.uk` / `password123` (Restaurant ID: `a0000000-0000-4000-8000-000000000001`).
   - Confirm redirect to `/pos/register` and confirm navigating to `/` immediately redirects back to `/pos/register`.
3. **POS Order Placement, Settlement & Double-Entry Ledger:**
   - Tap a menu item on `/pos/register` (`POST /api/pos/orders` with `crypto.randomUUID()`).
   - Open `/pos/orders` and click **Settle Bill** (`POST /api/pos/orders/:id/settle`).
   - Open `/pos/ledger` and confirm balanced double-entry payout entries appear (`GET /api/ledger/restaurant`).
4. **Shift Switch vs. Manager Unlock:**
   - Click **Lock / Switch Staff** -> returns to `/pos/login` while keeping the device locked to the restaurant.
   - Log back in as `OWNER`/`MANAGER` and click **Exit Terminal Mode** -> clears `fapp_terminal_lock` and returns to `/`.
5. **Offline PWA Boot:**
   - Run `pnpm --filter frontend preview --host`, log into `/pos/login`, switch DevTools Network to **Offline**, and reload (`F5`) -> confirm `/pos/register` and cached menu render offline without redirecting to login.
