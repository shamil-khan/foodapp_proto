# DEFERRED_CRONS.md — Production Scheduled Jobs Backlog

Zero background cron schedulers run in prototype mode. Before live UK production launch, attach a scheduler (e.g., BullMQ repeatable jobs or pg_cron) to invoke these already-implemented idempotent service methods:

1. **Transactional Outbox Relay (`Every 1–5s`):**
   - **Service:** `OutboxRelayService.flushPendingBatch()`
   - **Purpose:** Replaces post-commit `InMemoryEventBus` emission with crash-safe at-least-once event publishing from `outbox_events` to `orders`, `billing`, `loyalty`, and Redis Pub/Sub SSE streams.
2. **Loyalty Maturation Sweep (`Daily 01:00 UTC`):**
   - **Service:** `LoyaltyService.promoteMaturedEntries()`
   - **Purpose:** Transitions `PENDING_MATURATION` ledger entries to `AVAILABLE` where `maturesAt <= NOW()` and neither the program nor entry is under `AUDIT_HOLD` or `FROZEN`.
3. **Loyalty Expiration Sweep (`Daily 01:30 UTC`):**
   - **Service:** `LoyaltyService.expireStalePoints()`
   - **Purpose:** Appends `EXPIRED` debit entries for `AVAILABLE` points past `expiresAt`, skipping programs where `freezeExpiry = true`.
4. **Stale Checkout & Hold Reaper (`Every 5 mins`):**
   - **Service:** `OrderCheckoutReaper.expireAbandonedCheckouts()`
   - **Purpose:** Releases `HELD` loyalty reservations (`RELEASED`) and cancels abandoned `PENDING_PAYMENT` orders older than 15 minutes.
5. **B2B Merchant Netting & Payout Batch (`Daily / Weekly 02:00 UTC`):**
   - **Service:** `BillingSettlementService.settleAllEligibleMerchants()`
   - **Purpose:** Automates `MerchantPayable` minus `MerchantCashReceivable` minus `PLATFORM_TO_MERCHANT` loyalty fee offsets, skips `FROZEN` merchants, and dispatches Faster Payments / BACS payout instructions.
6. **B2B Milestone & Contest Evaluator (`End-of-Period` — Future Vision):**
   - **Service:** `LoyaltyContestService.evaluatePeriodAwards()`
   - **Purpose:** Evaluates idempotent period keys for order-volume milestones and _Customer/Restaurant of the Day/Week/Month_ awards.
