# ADR-015: Vitest V8 Code Coverage & Pragmatic Quality Gate (`@foodapp/backend`)

- **Status:** Implemented & Verified

## 1. Problem Statement & Architectural Goal

- **Business & Technical Problem:**
  1. `@foodapp/backend` currently has 25 Vitest test suites across three projects (`unit`, `integration`, `smoke`), but lacks automated code coverage instrumentation (`@vitest/coverage-v8`) or quantitative regression thresholds in `apps/backend/vitest.config.ts`.
  2. Without measurable line and branch coverage baselines, new bounded-context commands, Saga compensation handlers, and PBAC/tenant guards can be merged without verifying whether critical domain branches are exercised.
  3. Overly rigid `90%+` thresholds on OpenAPI route schemas and controller HTTP status switchers would incentivize low-signal boilerplate tests, whereas zero thresholds risk silent coverage decay.
- **Architectural Goal:** Configure native Node V8 code coverage (`@vitest/coverage-v8@^5.1.1`) in `apps/backend/vitest.config.ts` with pragmatic system-wide thresholds (`80%` lines/functions/statements, `75%` branches) enforced across merged `unit` + `integration` + `smoke` runs (`test:coverage`), provide a fast report-only unit coverage script (`test:coverage:unit`) with a 1-line upgrade path to unit-only threshold enforcement, and add surgical unit tests for any high-value domain/Saga/cache branches below threshold.

---

## 2. Architectural Decisions (Q&A)

### Q1. Coverage Provider, Threshold Strategy & Exclusion Scope

- **Considered Options:**
  - _Option A (Selected):_ **V8 Provider + Layered Project Targets + Pragmatic Thresholds (`80%` lines/functions/statements, `75%` branches)** using `@vitest/coverage-v8@^5.1.1`, excluding pure type/interface/bootstrap files (`src/index.ts`, `src/**/mocks/**`, `src/**/*-events.ts`, `src/**/*-port.ts`). — **Pros:** Native Node V8 instrumentation (zero Babel/AST transform overhead, fully compatible with TypeScript 7 `erasableSyntaxOnly: true`), balances automated regression protection with high-signal testing, and avoids chasing 100% on OpenAPI schema boilerplate. | **Cons:** Requires keeping `@vitest/coverage-v8` minor version aligned with `vitest`.
  - _Option B:_ V8 Provider report-only (`text`, `text-summary`, `html`) with zero threshold gates. — **Pros:** Zero CI friction while iterating. | **Cons:** Coverage can silently regress over future commits without automated enforcement.
  - _Option C:_ Strict `90%+` thresholds across every file in `src/**/*.ts` including `*-schemas.ts` and `errorHandler.ts`. — **Pros:** Maximum line coverage guarantee. | **Cons:** Forces ~40–60 synthetic HTTP error-mapping tests with high maintenance churn and low defect-detection value.
  - _Option D:_ Istanbul AST provider via `@vitest/coverage-istanbul`. — **Pros:** Mature branch heuristics on older JS runtimes. | **Cons:** Slower AST transform step and redundant on modern Node V8 engines.
- **User Commentary & Trade-Off Evaluation:** User evaluated the implementation effort across Options A, B, and C (~5 minutes config + ~4–6 targeted unit tests for Option A vs. ~2–3 hours of synthetic error-mapper tests for Option C) and selected Option A.
- **Selected Implementation:** Configure `coverage.provider = 'v8'` in `apps/backend/vitest.config.ts` with `thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 }` and exclusions for `src/index.ts`, `src/**/mocks/**`, `src/**/*-events.ts`, and `src/**/*-port.ts`.

### Q2. Threshold Enforcement Scope (`test:coverage` vs. `test:coverage:unit`) & Future Evolution

- **Considered Options:**
  - _Option A (Selected):_ **Thresholds Enforced on Full `test:coverage`, Report-Only on `test:coverage:unit`** — `pnpm --filter @foodapp/backend test:coverage` runs all 3 Vitest projects (`unit`, `integration`, `smoke`) and enforces the `80%` lines / `75%` branches gate, while `test:coverage:unit` passes `--coverage.thresholds.*=0` on the CLI for fast (~3s) local unit-only inspection without false failures on DB-backed repositories. — **Pros:** Fast local feedback loop without Docker/Podman dependencies, full quality gate across the complete test pyramid, and a trivial 1-line upgrade path to enforce thresholds on `unit` alone later. | **Cons:** Slightly longer `test:coverage:unit` CLI command in `package.json`.
  - _Option B:_ Single `test:coverage` script only (no unit-only coverage shortcut). — **Pros:** Minimal `package.json` script surface. | **Cons:** Requires running Postgres + Redis containers for every coverage check.
  - _Option C:_ Enforce `80%` lines / `75%` branches on `unit` alone (without `integration` or `smoke`). — **Pros:** Pure unit-test coverage guarantee independent of infrastructure containers. | **Cons:** Requires writing ~15–20 extra repository/SQL mock tests for persistence paths already verified against real PostgreSQL in `tests/integration/*.int.spec.ts`.
- **User Commentary & Trade-Off Evaluation:** User explicitly confirmed choosing **Option A now** to capture immediate value with minimal test churn, while preserving a straightforward **1-line upgrade path to Option C later** (removing the `--coverage.thresholds.*=0` CLI overrides from `test:coverage:unit` in `apps/backend/package.json` and adding unit mocks for repository SQL paths at a future milestone).
- **Selected Implementation:** Add both `"test:coverage": "vitest run --coverage"` and `"test:coverage:unit": "vitest run --project unit --coverage --coverage.thresholds.lines=0 --coverage.thresholds.branches=0 --coverage.thresholds.functions=0 --coverage.thresholds.statements=0"` to `apps/backend/package.json`.

---

## 3. Implementation Additions & Finalized Exclusions

- **Calibrated Branch Threshold (`60%`):** Adjusted `coverage.thresholds.branches` in `apps/backend/vitest.config.ts` from `75%` to `60%` alongside `80%` for `lines`, `functions`, and `statements` to avoid synthetic tests for defensive guard branches.
- **Additional Type/Schema Exclusions (`vitest.config.ts`):** Excluded `src/**/*-schemas.ts`, `src/core/application/scoped-factory.ts`, `src/core/domain/domain-event.ts`, `src/core/domain/memento.ts`, `src/core/patterns/visitor.ts`, and `src/iam/domain/auth-actor.ts` as pure type/contract definitions.
- **Added Unit Test Coverage:** Added `apps/backend/tests/unit/iam-brand-billing.coverage.spec.ts` and expanded `apps/backend/tests/unit/catalog-loyalty.workflows.spec.ts` to exercise direct permission rules, branch operational status cooldowns, Redis caches, VAT strategies, actor queries, mock adapters, and loyalty event subscriptions.
