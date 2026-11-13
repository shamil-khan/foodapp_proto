# FoodApp — Architecture & Engineering Reference

## 1. Monorepo Layout & Tooling

- **Package Manager & Orchestrator:** `pnpm` workspaces + Turborepo (`turbo dev`, `turbo build`, `turbo lint`, `turbo format`).
- **TypeScript Configuration:** `"module": "preserve"` + `"moduleResolution": "bundler"` across `apps/backend` using extensionless `@/*` path aliases (`tsx watch src/index.ts`, no separate runtime tsconfig).
- **Linting & Formatting:** Biome (`pn lint`, `pn format`, `pn fixed`) for TypeScript/JSON and `sql-formatter` for PostgreSQL migrations/seeds.
- **Local Infrastructure:** Podman Compose (`compose.yaml`) running PostgreSQL 18 (`foodapp-pg` on `5432`) and Redis 8 (`foodapp-redis` on `6379`).

---

## 2. Architectural Style & Bounded Contexts

The backend (`apps/backend`) follows **Domain-Driven Design (DDD)**, **CQRS**, and **Event Sourcing** on **Hono**:

1. **Identity Context (`src/contexts/identity`):**
   - **Global Users (`CUSTOMER`, `DRIVER`, `PLATFORM_ADMIN`):** Managed by Better Auth (`better-auth`) backed by PostgreSQL (`"User"`, `"Session"`, `"Account"`, `"Verification"`) and Redis secondary storage (`auth:*`).
   - **POS Tenant Staff (`OWNER`, `ADMIN`, `MANAGER`, `ORDER_TAKER`):** Shift-based HS256 JWT cookies/bearer tokens (`pos_staff_token`, 12-hour TTL).
2. **Catalog Context (`src/contexts/catalog`):**
   - Storefront directory (`GET /api/restaurants`) and 3-tier read-through menu cache (`Redis -> MenuSnapshot JSONB -> SQL rebuild`).
   - Optimistic concurrency price updates (`rowVersion`) publishing `RestaurantMenuUpdated` to refresh snapshots asynchronously.
3. **Ordering Context (`src/contexts/ordering`):**
   - Event-sourced `OrderAggregate` with GoF **State** lifecycle (`PLACED -> FOOD_PREPARING -> SERVED -> SETTLED`) and GoF **Visitor** (`KdsTicketVisitor` routing items to `KITCHEN_SCREEN`, `BAR_PRINTER`, `PASTRY_STATION`).
   - Transactional projection into `"Order"`, `"OrderLineItem"`, `"OrderLineModifier"`, and `"OrderMilestoneLog"`.
   - Persistent `OrderSettlementSaga` (`"_Saga_State"`) listening to `PosOrderSettled`.
4. **Ledger & Loyalty Context (`src/contexts/ledger`):**
   - Event-sourced `FinancialLedgerAggregate` enforcing strict double-entry accounting (`totalDebits === totalCredits`):
     - Debit: `GATEWAY_CLEARING` (gross total including VAT & tips)
     - Credit: `RESTAURANT_<id>` (net subtotal minus platform commission + 100% of tips)
     - Credit: `PLATFORM_REVENUE` (commission on net subtotal only)
     - Credit: `HMRC_VAT_<id>` (20% UK output VAT reserve)
   - Loyalty points accrual (`LoyaltyPointsEligible`) and redemption (`RedeemLoyaltyPoints`).

---

## 3. Core Engineering Rules & Conventions

- **Dependency Injection (`@inferdi/inferdi` v6 + `@inferdi/hono` v6):**
  - Singletons: `db`, `redis`, `eventBus`, `eventStore`, `sagaRepo`, repositories, read-only query handlers, and event subscribers/sagas.
  - Request-scoped (`c.var.di`): `request` (`RequestContext`), `log` (`AppLogger`), `commandBus`, `queryBus`, and HTTP controllers (`identityController`, `catalogController`, `orderController`, `ledgerController`).
  - Factories receive the active scope `(c) => ...` and resolve dependencies via `c.get(...)`.
- **Database Access (`@foodapp/db`):**
  - Introspected metadata in `packages/db/src/schema.generated.ts` (`*Table` constants + `*Row` / `*Insert` types).
  - Always use `sqlSelect`, `sqlInsert`, `sqlUpdate`, and `sqlSoftDelete`—never write inline SQL strings in repositories.
  - Remember `pg` returns `rows` as an array; always index `rows[0]` for single-row lookups.
- **Observability & Error Handling (`@logtape/logtape`):**
  - `AsyncLocalStorage` + `withContext({ requestId })` propagates correlation IDs across all layers automatically.
  - Development uses `hono/logger` + synchronous `fs.appendFileSync` into `apps/backend/logs/dev_YYYY-MM-DD.log` for chronological `<-- Start / [ERR] Stack Trace / --> End` tracing (`@logtape/file` and `@logtape/hono` remain installed for production structured logging).
  - Domain failures return typed `Result<T, DomainError>`; unexpected exceptions are caught by `globalErrorHandler`.

---

## 4. Essential Commands & Seed Credentials

- **Full DB Reset (Drop Volumes, Migrate 001–008, Codegen, Seed):** `pn db:reset`
- **Start Containers Only:** `pn db:up`
- **Start Backend Dev Server:** `pn --filter @foodapp/backend dev`
- **Lint & Format:** `pn lint` / `pn format`
- **Export Context for AI Sessions:** `pn ai-context`
- **Seeded POS Staff Login:** `staff1.0001@pos-tenant.co.uk` / `password123` (Restaurant ID: `a0000000-0000-0000-0000-000000000001`)

---

## 5. Next Milestones

1. **Zod + OpenAPI (`@hono/zod-openapi`):** Add request/response validation schemas and expose `/api/doc` + Scalar/Swagger UI.
2. **Automated Tests:** Unit tests for `OrderAggregate`, `FinancialLedgerAggregate`, and `CatalogRepository` optimistic locking.
3. **Production Logging Switch:** Swap `logger.ts` and `index.ts` to `@logtape/file` + `@logtape/hono` structured logging before deployment.
4. **Frontend Integration (`apps/frontend`):** Connect TanStack Router + Start to the backend API.
