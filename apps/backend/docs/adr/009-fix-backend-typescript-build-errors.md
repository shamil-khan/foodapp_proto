# [ADR-009] Fix Backend TypeScript Build Errors & Enforce Strict Compilation

- **Status:** Implemented & Verified
- **Target Package:** `apps/backend` (`@foodapp/backend`) & `packages/db` (`@foodapp/db`)
- **Date:** 2026-03-30
- **Context:** Modularization of backend contexts (`src/identity/`, `src/catalog/`, `src/ordering/`, `src/ledger/`) under strict TypeScript 7 compilation flags (`"erasableSyntaxOnly": true`, `"verbatimModuleSyntax": true`, `"strict": true`).

---

## 1. Context & Problem Statement

Enabling strict TypeScript 7 compilation and `"erasableSyntaxOnly": true` exposed **381 error lines across 42 files** (`pnpm exec tsc --noEmit` baseline):

| Error Cluster                       | Count | Root Cause                                                                                                                             |
| :---------------------------------- | :---- | :------------------------------------------------------------------------------------------------------------------------------------- |
| TS1294                              | 109   | Class constructor parameter properties generate runtime init code (forbidden under `erasableSyntaxOnly`)                               |
| TS2345 (TableMeta → AnyTable)       | 89    | Generated `*Row` interfaces lack `Record<string, unknown>` index signatures; `AnyTable` constraint not covariance-friendly             |
| TS2769 / TS2740 / TS18046 / `never` | ~100  | `@inferdi/inferdi` v6.1.1 container typing collapses via deep `ReturnType<typeof …>` chains; `FactoryResolver` vs `Container` mismatch |
| TS2353 / TS2559 / TS2322            | 29    | CQRS `Command<T>`/`Query<T>` phantom markers reject payload literals; Hono OpenAPI rejects union-status `c.json(...)` returns          |
| TS2307                              | 16    | `apps/backend` missing `Pool` and `PoolClient` type exports                                                                            |
| TS7006 / TS2339 / TS7031            | 26    | Cascading inference collapse from the `AnyTable` + DI typing failures                                                                  |
| TS5097                              | 3     | `packages/db/src/index.ts` `.ts`-extension re-exports vs backend `tsconfig.json` lacking `allowImportingTsExtensions`                  |
| TS2352 / TS2741 / TS2739            | 4     | Domain event casts, saga `RequestContext` missing `permissions`, `better-auth` `SecondaryStorage` missing `getAndDelete`/`increment`   |

## 2. Decision Drivers

- **Ecosystem Alignment:** Align with modern Node.js native type-stripping and upcoming ECMAScript standards by banning non-erasable runtime syntax (parameter properties, enums, namespaces).
- **Single Database Boundary:** Keep `pg` encapsulated inside `@foodapp/db` so `@foodapp/backend` never installs `pg` or `@types/pg` directly.
- **Single Source of Truth for DI:** Keep all dependency, bus, and event subscriber registrations centralized in `apps/backend/src/container.ts` using `DI_TOKENS` (zero hardcoded token strings) and cohesive per-context `defineBoundedContext` blocks.
- **Clear Bus Separation:** Keep a singleton Core `EventBus` (`DI_TOKENS.CORE.EVENT_BUS`) for cross-context async domain events while each bounded context declares its own `commands` and `queries` bindings for request-scoped `CommandBus` and `QueryBus` execution.
- **Zero Build Friction:** Ensure 100% compatibility with high-performance bundlers (ESBuild, SWC, Vite) and `@inferdi/inferdi` v6.1.1.

## 3. Considered Options

- **Option A (Chosen):**
  1. **A0 Driver Encapsulation:** Re-export `Pool` and `PoolClient` types from `packages/db/src/index.ts` instead of installing `pg` in `@foodapp/backend`.
  2. **A1 Constructor Parameter Properties:** Replace all parameter properties with explicit class field declarations + constructor body assignments across `@foodapp/db` and `@foodapp/backend`.
  3. **A2 Single-Source Bounded Context DI Builder (`@inferdi/inferdi` v6.1.1):** Group each bounded context's `module`, `commands`, `queries`, and `subscribers` into a unified `defineBoundedContext` block (`identityModule`, `catalogModule`, `orderingModule`, `ledgerModule`) inside `src/container.ts`, aggregate them via `BOUNDED_CONTEXTS`, and expose an explicit `ScopeServices` / `RequestScope` interface for O(1) scoped lookups.
  4. **A3 SQL Builder Constraints (`AnyTable` & `CompiledQuery`):** Define a covariance-friendly structural `AnyTable` and non-optional phantom `_result: TResult` on `CompiledQuery<TResult>` without unsafe casts.
  5. **A4 CQRS & OpenAPI Narrowing:** Widen `CommandBus.dispatch` / `QueryBus.ask` payload constraints, branch controller responses into per-status literal `c.json(..., <status>)` returns, spread `readonly Permission[]` into mutable arrays, and align `400`/`403` union response schemas.
- **Option B:** Disable or relax strict flags (`erasableSyntaxOnly: false`, `strict: false`). _(Rejected: violates architecture baseline and prevents modern runtime optimizations.)_

## 4. Architectural Decision & Implemented Changes

- **`@foodapp/db` (3 files):** Re-exported `Pool` and `PoolClient` in `packages/db/src/index.ts`; updated `AnyTable`, `CompiledQuery`, and explicit fields in `packages/db/src/sql-builder.ts`; extracted `appendTableMetadata` in `packages/db/src/codegen.ts` to satisfy Biome cognitive complexity rules.
- **Backend Config & Root (`4 files`):** Enabled `"allowImportingTsExtensions": true` in `apps/backend/tsconfig.json`; converted `errors.ts`, `logger.ts`, and `container.ts` to explicit fields and unified `defineBoundedContext` blocks (with inline developer guide and dummy `Inventory` context example).
- **Core Kernel (`8 files`):** Updated `result.ts`, `aggregate-root.ts`, `specification.ts`, `authorization.ts`, `cqrs.ts`, `event-bus.ts`, `pg-event-store.ts`, and `pg-saga-repository.ts`.
- **Bounded Contexts (`29 files`):** Updated all handlers, repositories, controllers, and OpenAPI schemas across `identity/` (9 files), `catalog/` (7 files), `ordering/` (6 files), and `ledger/` (7 files), including extracting private helpers in `catalog-repository.ts` and `order-repository.ts` to satisfy Biome cognitive complexity rules.

## 5. Verification

- `pnpm fixed` (Biome check/format across `@foodapp/db` and `@foodapp/backend`): **0 errors, 0 warnings**.
- `pnpm --filter @foodapp/db fixed`: **0 errors, 0 warnings**.
- `pnpm --filter @foodapp/backend fixed`: **0 errors, 0 warnings**.
- `pnpm --filter @foodapp/db exec tsc --noEmit`: **0 errors**.
- `pnpm --filter @foodapp/backend exec tsc --noEmit`: **0 errors**.
- Runtime smoke tests verified on `GET /api/health`, `GET /api/doc`, `POST /api/pos/auth/login`, `GET /api/me`, and `GET /api/pos/roles`.
