// apps/backend/docs/adr/005-decouple-order-settlement-saga.md

# ADR-005: Decouple OrderSettlementSaga from Ledger Infrastructure

- **Status:** uperseded by [ADR-011: Multi-Channel Orders, Double-Entry Billing & Multi-Scope Loyalty Architecture](./011-orders-billing-loyalty-architecture.md)
- **Target Package:** `apps/backend` (`@foodapp/backend`)
- **Agent Protocol:** [Backend AI Agent Execution Protocol](./_templates/agent-protocol.md)
- **Tech Stack & System Baseline:** [Backend Tech Stack & System Baseline](./_templates/tech-stack.md)
- **Living Smoke Tests:** [Backend Living Smoke Tests](./_templates/curl-smoke-tests.txt)
- **Related ADRs:** `001-ARCHITECTURE.md`, `004-modular-di-containers.md`

---

## 1. Context & Problem Statement

`OrderSettlementSaga` (`apps/backend/src/contexts/ordering/application/order-saga.ts`) currently imports `LedgerRepository` and `RecordOrderSettlementHandler` directly from `@/contexts/ledger/...` and instantiates `RecordOrderSettlementHandler` manually inside `onOrderSettled()`.

This violates bounded-context isolation between **`ordering`** and **`ledger`**, bypassing `CommandBus` decorators (logging/authorization) and creating a direct infrastructure dependency that will block extracting `ordering` and `ledger` into standalone microservices.

---

## 2. Architectural Options & Trade-Off Comparison

| Option                       | Architectural Approach                                                                          | Pros                                                                                                                                                                                                                        | Cons                                                                                                      |
| :--------------------------- | :---------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------- |
| **Option A _(Recommended)_** | **Dispatch `RecordOrderSettlement` via `CommandBus` / Anti-Corruption Port (`SettlementPort`)** | Removes direct `LedgerRepository` and handler imports from `ordering`; routes execution through `CommandBus` decorators and makes swapping in an HTTP/RPC or message-broker adapter trivial during microservice extraction. | Requires creating a request-less/system `CommandBus` or port abstraction for singleton event subscribers. |
| **Option B**                 | **Pure Event Choreography (`PosOrderSettled` -> `Ledger` Subscriber + Compensation Event)**     | Zero synchronous coupling between `ordering` and `ledger`; `ledger` subscribes directly to `PosOrderSettled` and emits `OrderSettlementRecorded` / `OrderSettlementFailed`.                                                 | Moves saga state tracking across two contexts or requires distributed saga correlation.                   |
| **Option C**                 | **Transactional Outbox + External Message Broker (e.g., Redis Streams / RabbitMQ / Kafka)**     | Guarantees at-least-once delivery across separate microservice processes and survives process restarts.                                                                                                                     | Introduces outbox worker infrastructure before microservice split is needed.                              |

---

## 3. Compile-First Implementation Plan (Bottom-Up)

- **Slice 1 — Ordering Port Contract (`src/contexts/ordering/application/ports/`):**
  - [ ] Define `OrderSettlementPort` interface in `ordering` without importing `@/contexts/ledger/*`.
- **Slice 2 — Saga Refactor (`src/contexts/ordering/application/order-saga.ts`):**
  - [ ] Inject `OrderSettlementPort` into `OrderSettlementSaga` and remove direct `LedgerRepository` / `RecordOrderSettlementHandler` imports.
- **Slice 3 — Adapter & DI Wiring (`src/contexts/ordering/infrastructure/` & DI module):**
  - [ ] Implement `InProcessLedgerSettlementAdapter` delegating to `RecordOrderSettlement` and bind in DI.

---

## 4. Verification & Post-Task Completion Gate

- [ ] **Pre-Code Handoff Checkpoint:** Generate `apps/backend/docs/adr/005-decouple-order-settlement-saga-handoff.md` after Q&A and obtain explicit user approval before generating code.
- [ ] **Static Verification:** Run `pn fixed` and `pnpm --filter @foodapp/backend exec tsc --noEmit`.
- [ ] **Runtime `curl` Verification:** Place and settle a POS order (`POST /api/pos/orders` -> `POST /api/pos/orders/{id}/settle`) and verify `GET /api/ledger/restaurant` records double-entry credits/debits idempotently.
- [ ] **Post-Task Living Doc Sync (after user confirms tests pass):**
  - [ ] Promote `005-decouple-order-settlement-saga-handoff.md` -> `apps/backend/docs/adr/005-decouple-order-settlement-saga-summary.md`.
  - [ ] Update `_templates/tech-stack.md` and `_templates/curl-smoke-tests.txt`.
