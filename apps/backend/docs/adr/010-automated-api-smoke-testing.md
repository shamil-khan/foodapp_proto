# ADR-010: Automated API Smoke & Integration Testing Suite

- **Status:** Implemented & Verified
- **Target Package:** `apps/backend` (`@foodapp/backend`)
- **Agent Protocol:** [Backend AI Agent Execution Protocol](./_templates/agent-protocol.md)
- **Tech Stack & System Baseline:** [Backend Tech Stack & System Baseline](./_templates/tech-stack.md)
- **Living Smoke Tests:** [Backend Living Smoke Tests](./_templates/curl-smoke-tests.txt)
- **Related ADRs:** `009-fix-backend-typescript-build-errors.md`

---

## 1. Context & Problem Statement

Manual verification via plain-text `curl` commands (`_templates/curl-smoke-tests.txt`) is tedious, error-prone, and cannot automatically gate cloud deployments or CI pipelines. `@foodapp/backend` required an automated, repo-integrated API smoke and integration test suite covering Health/OpenAPI, Subdomain Storefront Catalog, Optimistic Locking, Identity/PBAC Roles, POS Ordering, Double-Entry Ledger Settlement Sagas, and Loyalty RBAC guards.

---

## 2. Architectural Decisions & Trade-Offs

- **Test Runner (`vitest` ^5.1.1):** Selected over `node:test` and custom runners for native TypeScript ESM support, deterministic sequential execution (`fileParallelism: false`), and rich CI/CD reporting.
- **Execution Transport (`TEST_BASE_URL` via Live HTTP `fetch`):** Targets `process.env.TEST_BASE_URL ?? 'http://localhost:3000'` so the exact same suite validates both local instances and deployed cloud staging/production URLs over real HTTP.
- **Test Client Facade (`tests/helpers/api-client.ts`):** Encapsulates HTTP methods (`GET`, `POST`, `PATCH`, `DELETE`), Bearer JWT headers, cookie jar persistence, and typed JSON response parsing across all smoke test files.

---

## 3. Compile-First Implementation Plan (Completed)

- **Slice 1 — Test Infrastructure & Helpers:**
  - [x] Installed `vitest` (`^5.1.1`) as a `devDependency` in `apps/backend/package.json` and configured `"test:smoke": "vitest run --config vitest.config.ts"`.
  - [x] Created `apps/backend/vitest.config.ts` and `apps/backend/tests/helpers/api-client.ts`.
- **Slice 2 — Domain Smoke Test Suites:**
  - [x] `apps/backend/tests/smoke/01-health-catalog.smoke.test.ts` — Health, OpenAPI 3.1 spec, restaurant filters, subdomain resolution (`200`/`404`), compiled menu snapshots, and idempotent item price updates with optimistic locking (`409`) and RBAC (`403`).
  - [x] `apps/backend/tests/smoke/02-identity-pbac.smoke.test.ts` — POS login validation (`400`/`401`), `/api/me` introspection (`401`/`200`), 7 tenant rights, custom role CRUD (`201`/`409`/`200`), staff role assignment (`200`), in-use role deletion guard (`409`), system `OWNER` role lock (`403`), and `/api/admin/restaurants` auth guard (`401`).
  - [x] `apps/backend/tests/smoke/03-ordering-ledger-loyalty.smoke.test.ts` — POS order placement & KDS station slips (`201`), cross-tenant isolation (`403`), capability RBAC (`403`), order settlement saga & double-entry ledger verification (`200`), duplicate settlement guard (`400`), and loyalty auth/RBAC guards (`401`/`403`).

---

## Final Implementation Summary & Verification

- **Created & Updated Files:**
  - `apps/backend/package.json` (added `vitest ^5.1.1` devDependency, updated Biome scripts to cover `tests`, and added `test:smoke`)
  - `apps/backend/vitest.config.ts` (configured sequential Node execution for `tests/smoke/**/*.smoke.test.ts`)
  - `apps/backend/tests/helpers/api-client.ts` (`ApiTestClient` HTTP/cookie/JWT facade and `loginPosStaff` helper)
  - `apps/backend/tests/smoke/01-health-catalog.smoke.test.ts`
  - `apps/backend/tests/smoke/02-identity-pbac.smoke.test.ts`
  - `apps/backend/tests/smoke/03-ordering-ledger-loyalty.smoke.test.ts`
  - `apps/backend/src/identity/services/identity-routes.ts` (fixed Better Auth wildcard route `/auth/**` -> `/auth/*`)
- **Verification Evidence:**
  - `pnpm --filter @foodapp/backend fixed` — Passed with zero Biome formatting or lint errors.
  - `pnpm --filter @foodapp/backend exec tsc --noEmit` — Passed with zero TypeScript errors.
  - `pnpm --filter @foodapp/backend test:smoke` — All 3 test files (`13/13` unique smoke checks) passed in `< 1s` against live `http://localhost:3000`.
- **Deferred Follow-Up:**
  - Better Auth customer sign-up (`POST /api/auth/sign-up/email` returning `422`) captured as out-of-scope flaw in `ADR-011`.
- **Cloud Deployment Usage:**
  - Execute `TEST_BASE_URL=https://<your-cloud-api-domain> pnpm --filter @foodapp/backend test:smoke` as a post-deploy smoke gate in CI/CD.
