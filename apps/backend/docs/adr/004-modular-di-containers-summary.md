// apps/backend/docs/adr/004-modular-di-containers-summary.md

# ADR-004 Summary: Modular Per-Context DI Composition in `src/container.ts`

- **Status:** Implemented & Verified
- **Target Package:** `apps/backend` (`@foodapp/backend`)
- **Related ADRs:** `001-ARCHITECTURE.md`, `003-multi-tenant-rbac-rights-summary.md`, `005-decouple-order-settlement-saga.md` (out-of-scope flaw logged)

---

## 1. Architectural Decisions & Chosen Options

1. **Question 1 — Single-File Modular Composition + Centralized `DI_TOKENS` Registry (`Option D`):**
   - Replaced flat monolithic `.registerClass(...)` chains in `apps/backend/src/container.ts` with a centralized, namespaced `DI_TOKENS` `as const` dictionary (`CORE`, `IDENTITY`, `CATALOG`, `ORDERING`, `LEDGER`) and pure context builder functions (`createCoreModule`, `registerIdentityModule`, `registerCatalogModule`, `registerOrderingModule`, `registerLedgerModule`).
   - Preserved all existing string token keys (`'db'`, `'redis'`, `'rolePermissionCache'`, `'identityController'`, `'catalogController'`, `'orderController'`, `'ledgerController'`, etc.) for zero breaking changes across middlewares and routes.
2. **Question 2 — Co-Located Context Command, Query & Event Registrars (`Option A`):**
   - Grouped each bounded context's command and query bus registrations into dedicated helpers (`registerIdentityCommands`, `registerIdentityQueries`, `registerCatalogCommands`, `registerCatalogQueries`, `registerOrderingCommands`, `registerOrderingQueries`, `registerLedgerCommands`, `registerLedgerQueries`) alongside `registerDomainEventSubscribers`, making every bounded context a self-contained extractable block inside `src/container.ts`.

---

## 2. User Architectural Commentary

- **Rationale for Modularity vs. Line Limits:** The 100-line chunking threshold in `agent-protocol.md` is strictly an AI generation reliability safeguard (preventing context loss and malformed copy/paste output) rather than an arbitrary cap on source file length; structuring `src/container.ts` into context registration functions is driven by maintainability and clean microservice extraction boundaries.
- **Centralized Wiring & Cross-Token Visibility:** Keeping all DI registrations and `DI_TOKENS` inside `src/container.ts` avoids unnecessary file fragmentation while making any accidental cross-context token reference immediately visible as an obvious typo/bug and easy to resolve during debugging.
- **`erasableSyntaxOnly` Compatibility:** Using an `as const` `DI_TOKENS` object literal (rather than TypeScript `enum` syntax) works cleanly with `"erasableSyntaxOnly": true` in `tsconfig.json` without emitting runtime enum overhead or requiring compiler flag changes.

---

## 3. Out-of-Scope Flaws Captured

- **`ADR-005` (`005-decouple-order-settlement-saga.md` — `Status: Proposed`):** Captured that `OrderSettlementSaga` (`ordering`) directly imports `LedgerRepository` and `RecordOrderSettlementHandler` (`ledger`). Kept untouched in ADR-004 to maintain strict task scope isolation.

---

## 4. Packages, Env Vars & Modified File Tree

- **New Packages Installed:** None
- **New Environment Variables:** None
- **Modified & Created Files:**
  - `apps/backend/src/container.ts` _(modularized with `DI_TOKENS` + per-context container & bus functions)_
  - `apps/backend/docs/adr/004-modular-di-containers.md`
  - `apps/backend/docs/adr/004-modular-di-containers-summary.md`
  - `apps/backend/docs/adr/005-decouple-order-settlement-saga.md`
  - `apps/backend/docs/adr/README.md`
  - `apps/backend/docs/adr/_templates/tech-stack.md`

---

## 5. Verified `curl` Smoke Results

- `GET /api/health` -> `HTTP 200` (`{"status":"ok","service":"foodapp-backend",...}`)
- `GET /api/restaurants?take=5` -> `HTTP 200` (5 seeded UK restaurants returned via `CatalogController` + `QueryBus`)
- `POST /api/pos/auth/login` (`westminster-patty` / `staff1.0002@pos-tenant.co.uk`) -> `HTTP 200` (issued HS256 shift JWT + live Redis RBAC permissions via `IdentityController` + `CommandBus`)
