# ADR: Multi-Channel Orders, Double-Entry Billing & Multi-Scope Loyalty Architecture

- **Status:** Implemented & Verified

## 1. Problem Statement & Architectural Goal

- Evolve `@foodapp/backend` (United Kingdom market: `GBP` / `£`, UK VAT rules, Faster Payments / BACS merchant payouts, UK 3PL couriers, Capacitor iOS/Android apps, and offline-capable POS terminals) from an initial in-store POS ordering & flat ledger prototype into a microservice-ready, event-sourced modular monolith.
- Replace the coarse `ordering` and `ledger` modules with clean bounded contexts (`orders`, `billing`, and `loyalty`, alongside existing `identity` and `catalog`) enforcing strict `Order -> Billing -> Loyalty` settlement gates, exact arbitrary-precision `decimal.js` arithmetic, mandatory tenant-scoped data access, and resilient retry idempotency.

## 2. Architectural Decisions (Q&A)

### Q1. Bounded Context Decomposition (`ordering` & `ledger` Split)

- **Considered Options (up to 5: Option A – Option E):**
  - _Option A (Selected):_ Split order lifecycle and financial/loyalty processing into dedicated single-word bounded contexts: `orders` (replaces `ordering`), `billing` (fiat payments, gateways, double-entry accounting, B2B netting), and `loyalty` (B2C & B2B points ledger, maturation windows, governance freezes) — **Pros:** Clean DDD ownership; isolates payment gateways and double-entry ledgers from kitchen/delivery state machines; aligns with future microservice extraction | **Cons:** Multi-step checkout coordinates across `orders`, `loyalty`, and `billing` via `DomainEvent`s and Sagas.
  - _Option B:_ Keep `ordering` and `ledger` combined as a single commerce-ledger module — **Pros:** Single local transaction for everything | **Cons:** High coupling between kitchen/delivery workflows, payment gateways, and double-entry accounting.
  - _Option C:_ Split `orders` and `billing` only, keeping loyalty inside `billing` — **Pros:** Atomic split-tender commits | **Cons:** Crowds `billing` with consumer wallet holds, maturation windows, force-majeure freezes, and future UGC/contest rules.

- **User Commentary & Trade-Off Evaluation:** User rejected legacy names (`ordering`/`payments`) in favor of single-word industry-standard names (`orders`, `billing`) and later elevated `loyalty` into a standalone bounded context due to B2C/B2B maturation windows and governance freezes. Trade-off accepted: requires explicit saga compensation between `orders`, `loyalty`, and `billing`.
- **Selected Implementation:** Isolate modules under `apps/backend/src/{orders,billing,loyalty}/{domain,application,infrastructure,services}`, wired in `apps/backend/src/container.ts` via `defineBoundedContext` and `DI_TOKENS`.

### Q2. Storefront Cart & Authoritative Checkout Architecture

- **Considered Options (up to 5: Option A – Option E):**
  - _Option A (Selected):_ Hybrid client-side cart (guest `localStorage`/IndexedDB) + optional authenticated Redis cart sync (`cart:<userId>:<branchId>`, 24h TTL) + stateless authoritative `preview` and `checkout` commands — **Pros:** Zero DB write churn during browsing; supports cross-device cart persistence for logged-in users; authoritative server re-pricing at checkout | **Cons:** Requires cart merge reconciliation on user login.
  - _Option B:_ Database-backed persistent cart tables (`Cart`, `CartItem`) — **Pros:** Relational queries on abandoned carts | **Cons:** Heavy write amplification and stale price drift on every item toggle.
  - _Option C:_ Purely client-side cart with no server sync — **Pros:** Zero Redis cart storage | **Cons:** Cart lost when switching between web and Capacitor iOS/Android mobile apps.

- **User Commentary & Trade-Off Evaluation:** User confirmed hybrid cart + authoritative checkout so mobile/web clients remain responsive while `POST /api/orders/checkout` re-validates live branch status, `BranchMenuOverride` prices, UK VAT rates, and promo rules.
- **Selected Implementation:** `PUT /api/orders/cart/:branchId` persists lightweight item/modifier IDs in Redis; `POST /api/orders/preview` and `POST /api/orders/checkout` re-hydrate authoritative prices and UK VAT rates from PostgreSQL/snapshot cache inside a single transaction.

### Q3. Order Lifecycle & Named System State Machines

- **Considered Options (up to 5: Option A – Option E):**
  - _Option A (Selected):_ Canonical `OrderStatus` enum (`PENDING_PAYMENT`, `PLACED`, `ACCEPTED`, `PREPARING`, `PACKING`, `READY_FOR_PICKUP`, `OUT_FOR_DELIVERY`, `COMPLETED`, `CANCELLED`, `REJECTED`) governed by multiple named system state machines (`HOME_KITCHEN_SIMPLE`, `STANDARD_RESTAURANT`, `FULL_KDS_DELIVERY`) assigned per branch at onboarding, plus cross-cutting cancel/reject guards — **Pros:** Fits both simple home kitchens and multi-station KDS restaurants without dynamic user-authored state graphs | **Cons:** UI/analytics must handle skipped intermediate states on simpler machines.
  - _Option B:_ Single rigid linear state machine for all merchants — **Pros:** Uniform transitions | **Cons:** Forces home kitchens through unnecessary KDS packing steps.
  - _Option C:_ Tenant-customizable state graph builder — **Pros:** Maximum flexibility | **Cons:** High risk of dead-end states and broken SLA tracking.

- **User Commentary & Trade-Off Evaluation:** User required supporting home kitchens alongside full restaurants without custom graph editors. Optimistic locking (`rowVersion`) is enforced on `Order` transitions to prevent cancel-vs-KDS races.
- **Selected Implementation:** `RestaurantBranch.stateMachineCode` defaults by `KitchenType` (`HOME_KITCHEN` -> `HOME_KITCHEN_SIMPLE`, `RESTAURANT_BRANCH`/`CLOUD_KITCHEN` -> `STANDARD_RESTAURANT` or `FULL_KDS_DELIVERY`) and freezes onto `Order.stateMachineCode` at creation; State pattern classes validate every transition.

### Q4. Order-Line Modifier Snapshots

- **Considered Options (up to 5: Option A – Option E):**
  - _Option A (Selected):_ Domain-typed immutable `OrderItemModifierSnapshot` value objects serialized into a single `JSONB` column (`modifiersSnapshot`) on `OrderLineItem` (retiring `OrderLineModifier` child-table joins on hot reads) — **Pros:** Atomic immutable snapshot at checkout; zero N+1 joins when rendering orders, receipts, or KDS slips | **Cons:** Modifier-level cross-order SQL aggregations require JSONB extraction.
  - _Option B:_ Normalized `OrderLineModifier` child table — **Pros:** Relational SQL indexing per modifier | **Cons:** Extra inserts and joins on every order read.

- **User Commentary & Trade-Off Evaluation:** Accepted `JSONB` `modifiersSnapshot` on `OrderLineItem` alongside frozen `itemName`, `frozenPrice`, `vatRateSnapshot`, `vatAmountSnapshot`, and `allergenFlagsSnapshot`.
- **Selected Implementation:** Add `modifiersSnapshot JSONB NOT NULL DEFAULT '[]'`, `vatRateSnapshot NUMERIC(5,2)`, and `vatAmountSnapshot NUMERIC(10,2)` to `OrderLineItem`.

### Q5. Delivery Dispatch & UK 3PL Courier Integration

- **Considered Options (up to 5: Option A – Option E):**
  - _Option A (Selected):_ Pluggable `DeliveryProviderPort` supporting branch-configured `MERCHANT_SELF_DELIVERY` (manual driver status transitions) and `EXTERNAL_3PL` adapters (UK couriers: Stuart, Uber Direct, Deliveroo Signature, Gophr) with normalized inbound webhooks (`POST /api/webhooks/delivery/:provider`) — **Pros:** Supports self-delivery home kitchens and 3PL-connected restaurants cleanly | **Cons:** Provider-specific quirks (Challenge 25 age verification, mid-pickup cancellations) require per-courier adapter mapping.
  - _Option B:_ Merchant self-delivery only — **Pros:** Zero 3PL integration | **Cons:** Blocks on-demand courier dispatch for restaurants without drivers.
  - _Option C:_ Full proprietary rider fleet & live GPS dispatch engine — **Pros:** End-to-end fleet control | **Cons:** Massive scope expansion outside core platform focus.

- **User Commentary & Trade-Off Evaluation:** Selected Option A; raw provider webhook payloads are persisted in `providerPayloadSnapshot` for dispute/audit traceability.
- **Selected Implementation:** `DeliveryProviderPort` in `orders/domain/` with `MerchantSelfDeliveryAdapter` and `SimulatedUkCourierAdapter` (dev/smoke) + `POST /api/webhooks/delivery/:provider`.

### Q6. Event Transport, Mobile Support & Offline POS Sync

- **Considered Options (up to 5: Option A – Option E):**
  - _Option A:_ Full PostgreSQL Transactional Outbox + background relay worker from Day 1 — **Pros:** Crash-safe at-least-once delivery | **Cons:** Extra relay worker setup during early prototype debugging.
  - _Option B (Selected):_ Typed `EventBus` port (`InMemoryEventBus` + Redis Pub/Sub for Hono `streamSSE` in prototype) + idempotent saga consumers (`_Saga_State` / `processed_events`) + mobile-ready extensions (`NotificationPort` for iOS/Android APNs/FCM + `Last-Event-ID` SSE reconnect catch-up) + inline `POST /api/pos/orders/sync` inside `orders` — **Pros:** Instant stack-trace debugging in prototype; zero domain rewrite when swapping in Transactional Outbox before production | **Cons:** Potential dual-write event drop if Node crashes between DB `COMMIT` and in-memory emit during prototype phase.
  - _Option C:_ Kafka / RabbitMQ + Debezium CDC — **Pros:** High distributed throughput | **Cons:** Heavy DevOps overhead for modular monolith prototype.

- **User Commentary & Trade-Off Evaluation:** User explicitly selected Option B for rapid prototype testing/debugging, requested Capacitor/native iOS+Android push & reconnect readiness, offline POS batch sync (`occurredAt` vs. `syncedAt`, terminal receipt prefix `POS01-0042`), and logging the Transactional Outbox relay in `DEFERRED_CRONS.md`.
- **Selected Implementation:** Keep `PgEventStore` + `InMemoryEventBus` + `PgSagaRepository` (`_Saga_State`), add `NotificationPort` (`ConsoleCaptureNotifier` in dev), SSE `Last-Event-ID` catch-up, and `POST /api/pos/orders/sync` (max 50 orders per batch).

### Q7. API Validation, Idempotency & Error Contract

- **Considered Options (up to 5: Option A – Option E):**
  - _Option A (Selected):_ Strict Zod v4 OpenAPI schemas + Redis-backed `Idempotency-Key` response-caching middleware (storing **SHA-256 request payload hash** + cached response, `30s` lock TTL, `24h` cache TTL, Postgres unique fallback) + standardized RFC 7807 Problem Details JSON errors + port-swappable dev mocks — **Pros:** Prevents double-orders and double-charges on flaky mobile/POS networks; detects payload reuse collisions (`422`) | **Cons:** Requires reusable middleware and SHA-256 body canonicalization.
  - _Option B:_ Zod validation + DB unique constraint only (`409` on retry without response replay) — **Pros:** Less middleware code | **Cons:** Forces mobile/POS clients to issue recovery `GET` calls after network timeouts.

- **User Commentary & Trade-Off Evaluation:** Selected Option A with dev/testing port mocks (`DeterministicMockGateway`, `MockCardTerminalAdapter`, `SimulatedUkCourierAdapter`, `ConsoleCaptureNotifier`, `ClockPort`).
- **Selected Implementation:** `IdempotencyMiddleware` in `shared/services/` enforced on `POST /api/orders/checkout`, `POST /api/pos/orders/sync`, `POST /api/billing/refunds`, and `POST /api/billing/merchants/:id/settle`.

### Q8. Multi-Tenant Isolation & Branch Payment Capability Policies

- **Considered Options (up to 5: Option A – Option E):**
  - _Option A (Selected):_ Application-level `RequestContext` / `AuthorizationPolicy` enforced via a mandatory **`ScopedRepository<T>`** wrapper around `@foodapp/db` query builders + composite indexes `(branchId, status, createdAt)` + registration-time per-branch payment capability policies — **Pros:** Works cleanly with `pgPool` connection pooling and multi-branch `OWNER` roles while preventing forgotten `WHERE branchId` clauses | **Cons:** Requires strict discipline to ban raw unscoped `sqlSelect`/`sqlUpdate` calls in domain repositories.
  - _Option B:_ PostgreSQL Row-Level Security (`SET LOCAL`) — **Pros:** DB-enforced tenant filter | **Cons:** Complex multi-role policies across global customers, branch staff, and platform admins.
  - _Option C:_ Separate DB schema per merchant — **Pros:** Physical isolation | **Cons:** Breaks cross-merchant consumer search and migrations.

- **User Commentary & Trade-Off Evaluation:** User required tenant scoping to be enforced inside repository scope wrappers (`ScopedRepository`) and added registration-time branch payment capability selection (`CASH`, `COD`, `CARD_TERMINAL`, `ONLINE_GATEWAY`, `LOYALTY_POINTS` per channel).
- **Selected Implementation:** `ScopedRepository` base helper in `core/infrastructure/scoped-repository.ts` + `BranchPaymentCapability` JSONB/policy configuration on `PaymentConfig` / `RestaurantBranch`.

### Q9. Checkout Loyalty Mechanics & Promo Exclusions

- **Considered Options (up to 5: Option A – Option E):**
  - _Option A (Selected):_ Promo-eligibility-gated reserve-at-checkout (`HELD`) -> commit-on-settlement (`REDEEMED` / `EARNED`) -> auto-release on cancel/fail (`RELEASED`) — **Pros:** Prevents concurrent double-spending of points; preserves original point expiry dates on cancelled orders; enforces time/day-limited promo exclusions (`allowLoyaltyEarn`, `allowLoyaltyRedeem`) | **Cons:** Requires stale-hold cleanup reaper in production.
  - _Option B:_ Immediate deduction at checkout + compensatory `+points` re-credit on cancel — **Pros:** No `HELD` state | **Cons:** Clutters customer statements and risks resetting point expiration dates on cancelled orders.

- **User Commentary & Trade-Off Evaluation:** Selected Option A; time/day-limited promo codes evaluate at `preview`/`checkout` and freeze `allowLoyaltyEarn` / `allowLoyaltyRedeem` flags onto `Order`.
- **Selected Implementation:** `Promotion` extended with `validDaysOfWeek`, `validTimeWindow`, `allowLoyaltyEarn`, and `allowLoyaltyRedeem`; checkout places `HELD` ledger entries only when eligible.

### Q10. Standalone `loyalty` Module, Maturation Window & Governance Controls

- **Considered Options (up to 5: Option A – Option E):**
  - _Option A (Selected):_ Dedicated `loyalty` bounded context owning unified append-only `LoyaltyLedger` across all 3 tiers (`PLATFORM_TO_CUSTOMER`, `MERCHANT_TO_CUSTOMER`, `PLATFORM_TO_MERCHANT`) with a 14–30 day maturation window (`PENDING_MATURATION` -> `maturesAt` -> `AVAILABLE`), extended `AUDIT_HOLD`, force-majeure `FROZEN` (`freezeExpiry`), `PAUSED_REDEEM`, and append-only `REVOKED` clawbacks, exposing explicit settlement ports to `orders` (B2C) and `billing` (B2B) — **Pros:** Prevents refund/chargeback arbitrage before points mature; single governance engine for B2C & B2B; future-ready `sourceType` hooks for UGC/referrals/contests | **Cons:** Cross-module coordination with `orders` and `billing`.
  - _Option B:_ Split B2C into `loyalty` and B2B rebates directly inside `billing` — **Pros:** Local B2B invoice settlement | **Cons:** Duplicates maturation windows, audit holds, and freeze controls across two modules.

- **User Commentary & Trade-Off Evaluation:** User emphasized that points must never become redeemable until passing an audit/maturation window (`maturesAt` auto-approval after 14–30 days unless held by auditors for fraud/bug/pandemic/insolvency), and that `Order -> Billing -> Loyalty` strictly gates earning.
- **Selected Implementation:** Standalone `loyalty` module with `LoyaltyProgramPolicy` (`status`, `maturationDays`, `freezeExpiry`) and append-only `LoyaltyLedger` (`holderType`, `holderId`, `issuerMerchantId`, `sourceType`, `status`, `maturesAt`, `expiresAt`).

### Q11. Billing Double-Entry Accounting & B2B Merchant Settlement Scope

- **Considered Options (up to 5: Option A – Option E):**
  - _Option A (Selected):_ Core double-entry accounting ledger (`FinancialLedger` / `JournalEntry` + `JournalLine` enforcing `SUM(debit) === SUM(credit)` via `decimal.js` `ROUND_HALF_UP`) under UK Disclosed Agent model + on-demand B2B netting (`POST /api/billing/merchants/:id/settle`) offsetting `MerchantPayable` (online orders) against `MerchantCashReceivable` (cash/COD commissions) and matured `PLATFORM_TO_MERCHANT` loyalty credits — **Pros:** Audit-grade UK VAT & commission accounting from Day 1; zero cron overhead in prototype; deterministic penny rounding | **Cons:** Bank payout execution (`Faster Payments` / `BACS`) is confirmed manually (`MARK_PAID`) until production cron batching is enabled.
  - _Option B:_ Full automated daily/weekly cron payout batches + rolling reserves + bank payout gateway adapter — **Pros:** Automated disbursements | **Cons:** Adds cron/scheduler and reserve holdback complexity before prototype validation.
  - _Option C:_ Flat summary columns without double-entry journal rows — **Pros:** Minimal schema | **Cons:** Fails on split-tender loyalty subsidies, partial refunds, and mixed Online vs. Cash/COD netting.

- **User Commentary & Trade-Off Evaluation:** Selected Option A for prototype mode with **`decimal.js` (`^10.6.0`)** mandated for all currency/VAT arithmetic and all deferred production crons documented in `DEFERRED_CRONS.md`.
- **Selected Implementation:** `FinancialLedgerAggregate` rewritten with `decimal.js` (`ROUND_HALF_UP` + largest-line penny remainder allocation), UK 20% commission VAT postings, and `POST /api/billing/merchants/:id/settle`.

---

### Critical Audit & Accepted Risk Mitigations (Embedded Review)

| Area                                        | Identified Risk / Criticism                                                                                                                                      | Prototype Mitigation / Guardrail                                                                                                                                                                    | Production Trigger (`DEFERRED_CRONS.md`)                                                              |
| :------------------------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------- |
| **Event Transport (`InMemoryEventBus`)**    | Process crash between Postgres `COMMIT` and in-memory emit can drop `PaymentCaptured` / `OrderSettled` events.                                                   | All saga and event consumers are strictly idempotent via `_Saga_State` / `processed_events` (`eventId` uniqueness).                                                                                 | Enable `OutboxRelayService` (`outbox_events` table + 1–5s relay worker) before live customer traffic. |
| **Monetary & UK VAT Penny Rounding**        | Native JS `number` floats cause `£0.01` imbalances failing `SUM(debit) === SUM(credit)` assertions; UK hot vs. cold takeaway VAT splits require exact line math. | Mandate **`decimal.js` (`^10.6.0`)** (`precision: 20, rounding: ROUND_HALF_UP`) everywhere + deterministic penny remainder allocation to largest line item + `vatRateSnapshot` per `OrderLineItem`. | Retain `decimal.js` + add automated daily ledger trial-balance audit check.                           |
| **Cross-Tenant Data Leaks**                 | Application-level scoping fails if any repository query omits `merchantId` / `branchId`.                                                                         | Mandate **`ScopedRepository(requestContext)`** wrapper around `@foodapp/db` builders; forbid raw unscoped queries in domain services.                                                               | Add static Biome/lint rule banning unscoped repository access + optional Postgres RLS.                |
| **Idempotency Replay Collisions**           | Reusing an `Idempotency-Key` with an altered request body returns a stale order; crashed lock holders can stall retries.                                         | Store **SHA-256 request body hash** alongside cached response (`422 IDEMPOTENCY_KEY_REUSED` on mismatch); use `30s` lock TTL and `24h` response TTL.                                                | Keep Redis + Postgres unique fallback in production.                                                  |
| **Cancel vs. KDS Transition Race**          | Customer `CANCEL_REQUESTED` colliding with kitchen `READY_FOR_PICKUP` causes inconsistent refund/state outcomes.                                                 | Enforce optimistic offline locking (`rowVersion` -> `409 CONCURRENCY_CONFLICT`) on all `Order` state transitions.                                                                                   | Keep optimistic locking in production.                                                                |
| **3PL Courier Variance**                    | Stuart / Uber Direct / Gophr webhook lifecycles and Challenge 25 age-check rules vary across providers.                                                          | Normalize internal transitions behind `DeliveryProviderPort` while storing raw `providerPayloadSnapshot` JSONB for dispute audit.                                                                   | Implement dedicated adapters per UK 3PL provider on onboarding.                                       |
| **Loyalty Negative Balances & Stale Holds** | Post-spend `REVOKED` clawbacks push balances negative; abandoned checkouts leave `HELD` points locked without cron cleanup.                                      | Permit negative balances in `LoyaltyLedger` (blocking redemptions until recovered) and expose manual hold-release admin endpoint in prototype.                                                      | Enable Stale Hold Reaper (`*/5 * * * *`) & Maturation Sweep (`0 1 * * *`) crons at launch.            |
| **Cash/COD Commission Default**             | Cash/COD-heavy takeaways can accumulate unpaid `MerchantCashReceivable` commissions and churn before settling B2B invoices.                                      | Enforce configurable `maxReceivableCreditLimitGbp` per merchant; auto-disable `CASH`/`COD` channel capability if breached.                                                                          | Automate B2B Direct Debit / card-on-file collection for negative settlement balances.                 |

---

## 3. Proposed Implementation Blueprint & Agent Handover (Advisory)

> _Note for Implementing Agent: The structure, packages, and file layout below reflect the designing architect's proposed blueprint and may differ based on your own codebase inspection and judgment. Any dependency changes still require explicit user approval._

- **Bounded Contexts Impacted:** New: `orders`, `billing`, `loyalty` | Modified: `identity`, `catalog`, `core` (`shared`) | Split/Retired: `ordering` -> `orders`, `ledger` -> `billing` + `loyalty`
- **Proposed Packages:** `decimal.js@^10.6.0` (installed and confirmed in `apps/backend/package.json`)
- **Existing Knowledge-Base Files (Read-Only Context to Attach):**
  - `apps/backend/src/container.ts` — `DI_TOKENS`, `defineBoundedContext`, and Inferdi DI registration patterns.
  - `apps/backend/src/core/domain/aggregate-root.ts` & `apps/backend/src/core/infrastructure/pg-event-store.ts` — Event sourcing, mementos, and `PgEventStore` persistence contracts.
  - `apps/backend/src/core/application/authorization.ts` — `RequestContext` and `AuthorizationPolicy` (`SameRestaurantSpec`, `SameBranchSpec`, `SameUserSpec`).
  - `packages/db/src/sql-builder.ts` & `packages/db/src/types.ts` — Zero-ORM typed SQL builders (`sqlSelect`, `sqlInsert`, `sqlUpdate`, `sqlSoftDelete`) and permission/role registries.
  - `apps/backend/tests/helpers/api-client.ts` & `apps/backend/vitest.config.ts` — `ApiTestClient`, `loginPosStaff`, and Vitest runner configuration.
- **Existing Files to Modify or Remove (Proposed):**
  - `packages/db/migrations/011_orders_billing_loyalty.sql` — Add `stateMachineCode` & `idempotencyKey` on `Order`; add `modifiersSnapshot` (`JSONB`), `vatRateSnapshot`, `vatAmountSnapshot` on `OrderLineItem`; add `paymentCapabilities` (`JSONB`) & `maxReceivableCreditLimitGbp` on `RestaurantBranch` / `PaymentConfig`; add `validDaysOfWeek`, `validTimeWindow`, `allowLoyaltyEarn`, `allowLoyaltyRedeem` on `Promotion`; add `JournalEntry`, `JournalLine`, `MerchantSettlement`, `LoyaltyProgramPolicy`, and evolve `LoyaltyLedger` (`holderType`, `holderId`, `issuerMerchantId`, `sourceType`, `status`, `maturesAt`, `expiresAt`).
  - `packages/db/seeds/seed.sql` — Seed UK branch payment capabilities, loyalty program policies, and sample promotions matching migration `011`.
  - `apps/backend/src/app.ts` & `apps/backend/src/container.ts` — Register `orders`, `billing`, and `loyalty` bounded contexts, DI tokens, and OpenAPI routes (`/api/orders`, `/api/pos/orders`, `/api/billing`, `/api/loyalty`, `/api/webhooks/delivery/:provider`).
  - `apps/backend/vitest.config.ts` & `apps/backend/package.json` — Configure `unit`, `integration`, and `smoke` Vitest projects (`test:unit`, `test:int`, `test:smoke`).
  - `apps/backend/src/ordering/**` & `apps/backend/src/ledger/**` — Migrate/replace into `apps/backend/src/orders/**`, `apps/backend/src/billing/**`, and `apps/backend/src/loyalty/**` (user removes superseded files manually per protocol).
- **Proposed New Files:**
  - `apps/backend/docs/DEFERRED_CRONS.md` — Production cron checklist (`OutboxRelay`, `MaturationSweep`, `ExpirationSweep`, `StaleHoldReaper`, `B2BSettlementBatch`, `MilestoneContestEvaluator`).
  - `apps/backend/src/core/domain/money.ts` — `decimal.js` (`ROUND_HALF_UP`) GBP money, UK VAT line calculation, and penny-remainder allocation helpers.
  - `apps/backend/src/core/infrastructure/scoped-repository.ts` — `ScopedRepository` enforcing `RequestContext` tenant/branch isolation on all queries.
  - `apps/backend/src/core/services/idempotency-middleware.ts` — Redis + Postgres `Idempotency-Key` middleware with SHA-256 request body hash validation and RFC 7807 error formatting.
  - `apps/backend/src/orders/{domain,application,infrastructure,services}/*` — Hybrid cart service, `preview`/`checkout` commands, named state machines (`HOME_KITCHEN_SIMPLE`, `STANDARD_RESTAURANT`, `FULL_KDS_DELIVERY`), `DeliveryProviderPort` + `SimulatedUkCourierAdapter`, SSE stream with `Last-Event-ID`, `NotificationPort` + `ConsoleCaptureNotifier`, and `POST /api/pos/orders/sync`.
  - `apps/backend/src/billing/{domain,application,infrastructure,services}/*` — `PaymentGatewayPort` + `DeterministicMockGateway` + `MockCardTerminalAdapter`, `FinancialLedgerAggregate` (`decimal.js` double-entry journals), refund handler, and `POST /api/billing/merchants/:id/settle` B2B netting & UK commission VAT invoice generator.
  - `apps/backend/src/loyalty/{domain,application,infrastructure,services}/*` — `LoyaltyLedgerAggregate`, `HELD`/`REDEEMED`/`RELEASED` checkout hooks, `PENDING_MATURATION` (`maturesAt`) + `AUDIT_HOLD`/`FROZEN`/`PAUSED_REDEEM`/`REVOKED` governance handlers, and B2B merchant credit redemption port.
  - `apps/backend/tests/fakes/*` — Deterministic test doubles (`FakeClock`, `InMemoryIdempotencyStore`, `DeterministicMockGateway`, `MockCardTerminalAdapter`, `SimulatedUkCourierAdapter`, `ConsoleCaptureNotifier`).
  - `apps/backend/tests/unit/*.spec.ts` — Fast in-memory unit suite (`shared.money-vat.spec.ts`, `shared.scoped-repository.spec.ts`, `shared.idempotency-middleware.spec.ts`, `orders.state-machines.spec.ts`, `orders.pricing-snapshots.spec.ts`, `orders.branch-capabilities.spec.ts`, `loyalty.maturation-governance.spec.ts`, `billing.double-entry.spec.ts`).
  - `apps/backend/tests/integration/*.int.spec.ts` — Real Postgres + Redis integration suite (`checkout.idempotency-saga.int.spec.ts`, `pos.offline-sync.int.spec.ts`, `delivery.3pl-webhooks.int.spec.ts`, `mobile.sse-reconnect.int.spec.ts`, `billing.b2b-settlement.int.spec.ts`).
  - `apps/backend/tests/smoke/06-orders-billing-loyalty.smoke.test.ts` — End-to-end HTTP smoke suite via `ApiTestClient` covering `200`/`201` happy paths and `400`/`401`/`403`/`404`/`409`/`422` error responses.
- **Handover Rationale & Compile-First Layer Plan (Why This Approach):**
  - **Architectural Rationale:** Separating `orders`, `billing`, and `loyalty` behind hexagonal ports (`PaymentGatewayPort`, `DeliveryProviderPort`, `NotificationPort`, `LoyaltySettlementPort`) allows deterministic mock testing in prototype mode and zero-rewrite swaps to Stripe, Stuart/Uber Direct, APNs/FCM, and Transactional Outbox in production.
  - **Database & Seeds:** Create `packages/db/migrations/011_orders_billing_loyalty.sql`, update `packages/db/seeds/seed.sql`, run `pnpm db:migrate` (which triggers `codegen.ts` -> `schema.generated.ts`), and verify via `pn db:reset`.
  - **Domain & Application:** Implement `core/domain/money.ts` (`decimal.js`), followed by `loyalty` domain/commands, `billing` double-entry domain/commands, and `orders` state machines, cart/checkout, POS sync, and saga handlers.
  - **Infrastructure, DI & HTTP:** Implement `ScopedRepository`, `IdempotencyMiddleware`, mock adapters (`DeterministicMockGateway`, `MockCardTerminalAdapter`, `SimulatedUkCourierAdapter`, `ConsoleCaptureNotifier`), wire `DI_TOKENS` in `container.ts`, and expose thin OpenAPI 3.1 routes (`*-schemas.ts` + `*-routes.ts` + `*-controller.ts`).
  - **Vitest Test Suite (Unit, Integration & Smoke):** Implement `tests/fakes/*`, `tests/unit/*.spec.ts` (in-memory `< 3s`), `tests/integration/*.int.spec.ts` (real Postgres/Redis), and `tests/smoke/06-orders-billing-loyalty.smoke.test.ts` (`ApiTestClient`), then run `pn fixed`, `pnpm --filter @foodapp/backend exec tsc --noEmit`, `pnpm --filter @foodapp/backend test:unit`, `pnpm --filter @foodapp/backend test:int`, and `pnpm --filter @foodapp/backend test:smoke`.
