# ARCHITECTURE_CORE.md — Platform Foundations, Boundaries & Guardrails

## 1. Jurisdiction, Tech Stack & Core Conventions

- **Jurisdiction & Currency:** United Kingdom (`GBP` / `£`, UK VAT rules, Faster Payments / BACS merchant payouts, UK GDPR compliance, UK 3PL courier integrations).
- **Runtime & Framework:** Node.js + TypeScript + Hono HTTP layer + Zod validation + PostgreSQL + Redis.
- **Monetary Precision Standard:** Strictly use **`decimal.js`** (`Decimal` with `precision: 20, rounding: Decimal.ROUND_HALF_UP`) across all pricing, UK VAT calculations, loyalty conversions, and double-entry journal postings—never native JS `number` floats. Allocate penny (`£0.01`) rounding remainders deterministically to the largest line item.
- **Architecture:** Modular Monolith with strict **Hexagonal / Ports-and-Adapters** boundaries (`identity`, `orders`, `billing`, `loyalty`, plus `shared`). Cross-module communication occurs strictly via typed Ports and `DomainEventBus`.

## 2. Bounded Contexts

1. **`identity`:** Users, UK hospitality merchants (restaurants, takeaways, council-registered home kitchens), multi-branch hierarchy, RBAC roles (`OWNER`, `BRANCH_MANAGER`, `CASHIER`, `KDS_OPERATOR`, `CUSTOMER`, `PLATFORM_ADMIN`), `TenantContext` resolution, and mobile push token registry (`IOS`, `ANDROID`, `WEB`).
2. **`orders`:** Hybrid client/Redis storefront cart, stateless authoritative `preview` & `checkout`, immutable order-line snapshots (UK VAT rates + 14 UK allergen codes), named order state machines, cross-cutting cancel/reject guards, pluggable UK 3PL delivery dispatch, SSE streams, and offline POS batch sync.
3. **`billing`:** Branch payment capability policies, payment gateway adapters (`ONLINE_GATEWAY` e.g. Stripe/Adyen, `CARD_TERMINAL` PDQ, `CASH`, `COD`), double-entry accounting ledger (`journal_entries` + `journal_lines`), UK HMRC-compliant commission VAT invoices, refunds, and B2B merchant netting/payouts.
4. **`loyalty`:** Append-only unified points ledger (`PLATFORM_TO_CUSTOMER`, `MERCHANT_TO_CUSTOMER`, `PLATFORM_TO_MERCHANT`), checkout holds (`HELD`), maturation window (`PENDING_MATURATION` -> `AVAILABLE`), and legal/force-majeure governance (`AUDIT_HOLD`, `FROZEN`, `PAUSED_REDEEM`, `REVOKED`).

## 3. Shared Cross-Cutting Infrastructure (`src/shared/`)

- **Enforced Tenant Scoping (`ScopedRepository`):** All tenant-owned tables (`orders`, `order_items`, `journal_entries`, `loyalty_ledger`) are accessed exclusively through a `ScopedRepository(tenantContext)` wrapper injecting `WHERE merchant_id = :merchantId` (and `AND branch_id IN (:branchIds)` for branch-scoped roles), backed by `(branch_id, status, created_at)` indexes.
- **API Validation & Idempotency:** Zod schemas on all routes; Redis-backed `Idempotency-Key` response-caching middleware (storing **SHA-256 request body hash** + cached response, `30s` lock TTL, `24h` cache TTL, Postgres unique fallback) on mutating order/payment/sync endpoints; RFC 7807 Problem Details JSON errors.
- **Event Transport & Mobile Push:** `DomainEventBus` port backed by `InMemoryEventBus` + Redis Pub/Sub (for Hono `streamSSE`) in prototype mode, with idempotent saga listeners (`processed_events` table). Mobile iOS/Android clients use foreground SSE with `Last-Event-ID` reconnect catch-up + `NotificationPort` (`FcmApnsAdapter` / `ConsoleCaptureNotifier`).
- **Offline POS Sync (`POST /api/orders/pos/sync`):** Lives inside `orders`; accepts client UUIDv7s, terminal-prefixed receipt numbers (`POS01-0042`), offline price/VAT snapshots, dual timestamps (`occurredAt` vs. `syncedAt`), and max 50 orders per batch.

## 4. Documented Architectural Criticisms & Known Risks

| Area                         | Identified Risk                                                                                     | Prototype Mitigation / Guardrail                                                        | Production Trigger                                            |
| :--------------------------- | :-------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------- | :------------------------------------------------------------ |
| **In-Memory EventBus**       | Process crash between Postgres `COMMIT` and emit drops events (`PaymentCaptured` / `OrderSettled`). | All listeners are idempotent (`processed_events`) behind `DomainEventBus`.              | Add `outbox_events` table + relay worker before live traffic. |
| **VAT & Penny Rounding**     | Float math causes `£0.01` imbalances failing `SUM(debit) === SUM(credit)`.                          | Mandate **`decimal.js`** (`ROUND_HALF_UP`) + remainder allocation to largest line item. | Keep `decimal.js`; add daily ledger trial-balance check.      |
| **Tenant Scope Leaks**       | Forgotten `WHERE branch_id` causes cross-tenant data leaks.                                         | Mandatory **`ScopedRepository(tenantContext)`** wrapper; forbid raw table access.       | Add lint rule + optional Postgres RLS.                        |
| **Idempotency Collisions**   | Reusing `Idempotency-Key` with altered payload returns wrong order.                                 | Compare `SHA-256` request body hash; reject mismatches with `422`.                      | Keep Redis + Postgres unique fallback.                        |
| **Cancel vs. KDS Race**      | Customer cancel colliding with kitchen `READY_FOR_PICKUP`.                                          | Optimistic locking (`version` column) on all `Order` state transitions.                 | Keep optimistic locking in production.                        |
| **3PL Courier Variance**     | Stuart/Uber Direct/Gophr webhook & Challenge 25 edge cases.                                         | Normalized `DeliveryProviderPort` + store raw `providerPayloadSnapshot`.                | Build dedicated adapter per UK 3PL provider.                  |
| **Negative Loyalty / Holds** | Post-spend `REVOKED` entries push balances negative; abandoned holds linger.                        | Allow negative balance (blocking redemption); manual hold-release endpoint.             | Enable Stale Hold Reaper & Maturation Sweep crons.            |
| **Cash/COD Credit Risk**     | Cash/COD takeaways rack up unpaid `MerchantCashReceivable` commissions.                             | Enforce `maxReceivableCreditLimitGbp`; auto-disable `CASH`/`COD` if breached.           | Automate Direct Debit / card-on-file settlement.              |
# ARCHITECTURE_DOMAIN.md — Order -> Billing -> Loyalty Flows & Deferred Crons

## 1. Cart, UK VAT Pricing & Immutable Order Snapshots (`orders`)

- **Hybrid Cart:** Guests edit locally; authenticated users optionally sync `{ menuItemId, quantity, modifierIds }` to Redis (`cart:<userId>:<branchId>`, 24h TTL) via `PUT /api/orders/cart/:branchId`.
- **Authoritative Checkout (`POST /api/orders/checkout`):** Re-hydrates live branch `operationalStatus`, branch payment capabilities (`CASH`, `COD`, `CARD_TERMINAL`, `ONLINE_GATEWAY`, `LOYALTY_POINTS` per channel), `BranchMenuOverride` prices, item-level UK VAT rates (`20%` hot food vs. `0%` zero-rated cold items where applicable), time/day-limited promo codes, and loyalty eligibility flags (`allowLoyaltyEarn`, `allowLoyaltyRedeem`) atomically.
- **Immutable Snapshots:** Freezes `itemNameSnapshot`, `unitPriceSnapshot`, `vatRateSnapshot`, `vatAmountSnapshot`, and domain-typed `List<OrderItemModifierSnapshot>` (stored as `JSONB` `modifiers_snapshot` on `order_items`).

## 2. Order State Machines & Delivery Dispatch (`orders`)

- **Named System State Machines:** Canonical `OrderStatus` enum (`PENDING_PAYMENT`, `PLACED`, `ACCEPTED`, `PREPARING`, `PACKING`, `READY_FOR_PICKUP`, `OUT_FOR_DELIVERY`, `COMPLETED`, `CANCELLED`, `REJECTED`). Merchants select a registered machine at onboarding (`HOME_KITCHEN_SIMPLE`, `STANDARD_RESTAURANT`, `FULL_KDS_DELIVERY`); `Order` stores `stateMachineCode`.
- **Cross-Cutting Cancel/Reject Guards:** Enforces stage-aware cancellation/rejection from any non-terminal state using `version` optimistic locking.
- **Delivery Dispatch (`DeliveryProviderPort`):** Supports `MERCHANT_SELF_DELIVERY` (manual driver updates) and `EXTERNAL_3PL` adapters (Outbox dispatch + normalized webhooks `POST /api/webhooks/delivery/:provider`).

## 3. Strict `Order -> Billing -> Loyalty` Lifecycle & Double-Entry Accounting (`billing` & `loyalty`)

1. **Checkout Hold (`loyalty`):** If eligible (`allowLoyaltyRedeem = true` and program `ACTIVE`), `orders` calls `loyalty.holdPoints()` placing a `HELD` reservation on `AVAILABLE` customer points (`PLATFORM_TO_CUSTOMER` or `MERCHANT_TO_CUSTOMER`, single wallet per order).
2. **Double-Entry Financial Settlement (`billing` — Disclosed Agent Model):**
   - **`ONLINE_GATEWAY` (Stripe/Adyen):** Debits `GatewayClearing` (+ `PlatformLoyaltySubsidy` if platform points redeemed); credits `MerchantPayable`, `CommissionRevenue`, and `OutputVatPayable` (20% UK VAT on platform commission/service fee).
   - **`CASH` / `COD` / `POS`:** Debits `MerchantCashReceivable` for platform commission + commission VAT; credits `CommissionRevenue` + `OutputVatPayable`.
   - **Invariant:** Every `JournalEntry` enforces `SUM(debit) === SUM(credit)` using `Decimal` before commit.
3. **Loyalty Maturation & Governance Gate (`loyalty`):**
   - Only after `billing` posts balanced journal entries (`OrderSettled`) does `loyalty` convert `HELD -> REDEEMED` and credit `PENDING_MATURATION` points (`maturesAt = now + 14 days`).
   - Cancelled/failed checkouts auto-release `HELD -> RELEASED`. Refunds prior to maturation void unmatured points; post-settlement refunds debit `MerchantCashReceivable`.
   - **Governance States:** Both Platform and Merchant programs support `ACTIVE`, `PAUSED_REDEEM`, `FROZEN` (pandemic/insolvency freeze with `freezeExpiry` flag), `AUDIT_HOLD` (blocks maturation past `maturesAt` pending auditor review), and append-only `REVOKED` clawbacks.
4. **B2B Merchant Netting & Payout (`POST /api/billing/merchants/:id/settle`):**
   - Nets `MerchantPayable` (online orders) against `MerchantCashReceivable` (cash/COD commissions), calls `loyalty.redeemMerchantPoints()` to offset platform fees using matured `PLATFORM_TO_MERCHANT` points, generates a UK HMRC-compliant commission VAT invoice/statement, enforces `FROZEN` payout holds, and records manual Faster Payments / BACS confirmation (`MARK_PAID`) in prototype mode.

## 4. Deferred Production Crons (`DEFERRED_CRONS.md`)

Zero background schedulers run in prototype mode; wire these existing idempotent service methods to a production scheduler (e.g., BullMQ repeatable jobs) before launch:

1. **Transactional Outbox Relay (`Every 1–5s`):** `OutboxRelayService.flushPendingBatch()` (replaces `InMemoryEventBus` post-commit emit).
2. **Loyalty Maturation Sweep (`Daily 01:00 UTC`):** `LoyaltyService.promoteMaturedEntries()` (`PENDING_MATURATION -> AVAILABLE` where `maturesAt <= NOW()` and no `AUDIT_HOLD` / `FROZEN`).
3. **Loyalty Expiration Sweep (`Daily 01:30 UTC`):** `LoyaltyService.expireStalePoints()` (skips entries where `freezeExpiry = true`).
4. **Stale Checkout & Hold Reaper (`Every 5 mins`):** `OrderCheckoutReaper.expireAbandonedCheckouts()` (releases `HELD` points & cancels `PENDING_PAYMENT` orders `> 15 mins`).
5. **B2B Merchant Netting & Payout Batch (`Daily / Weekly 02:00 UTC`):** `BillingSettlementService.settleAllEligibleMerchants()` (skips `FROZEN` merchants; applies rolling reserve if configured).
6. **B2B Milestone & Contest Evaluator (`End-of-Period` — Future Vision):** `LoyaltyContestService.evaluatePeriodAwards()` (idempotent period keys for volume milestones and _Customer/Restaurant of the Day/Week/Month_).
