# ADR-007: Flatten Business Unit Directory Hierarchy (`src/contexts/` -> `src/`)

- **Status:** Implemented & Verified
- **Target Package:** `apps/backend` (`@foodapp/backend`)
- **Agent Protocol:** [Backend AI Agent Execution Protocol](./_templates/agent-protocol.md)
- **Tech Stack & System Baseline:** [Backend Tech Stack & System Baseline](./_templates/tech-stack.md)
- **Living Smoke Tests:** [Backend Living Smoke Tests](./_templates/curl-smoke-tests.txt)
- **Related ADRs:** `001-ARCHITECTURE.md`, `004-modular-di-containers-summary.md`

---

## 1. Context & Problem Statement

Deployable microservice-ready business units (`identity`, `catalog`, `ordering`, `ledger`) were nested inside an unnecessary wrapper directory (`apps/backend/src/contexts/`). Eliminating `src/contexts/` places each business unit directly alongside `src/core/` and `src/config/`, simplifying `@/<unit>/*` TypeScript path imports and clarifying microservice extraction boundaries with zero runtime or OpenAPI behavior changes.

---

## 2. Architectural Options & Trade-Off Comparison

| Option                    | Architectural Approach                                                                                          | Pros                                                                                                               | Cons                                                                                                          |
| :------------------------ | :-------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------ |
| **Option A _(Selected)_** | Move folders to `src/{identity,catalog,ordering,ledger}` using the existing broad `@/*` (`./src/*`) path alias. | Flattens hierarchy, removes redundant nesting, keeps `tsconfig.json` clean, makes microservice extraction trivial. | Requires updating `@/contexts/*` imports across routers, DI container, and business units.                    |
| **Option B**              | Add granular `@identity/*`, `@catalog/*`, `@ordering/*`, `@ledger/*` aliases in `tsconfig.json`.                | Slightly shorter import specifiers.                                                                                | Clutters `tsconfig.json` and introduces inconsistent alias conventions alongside `@/core/*` and `@/config/*`. |

---

## 3. Compile-First Implementation Plan (Bottom-Up)

- **Slice 1 — Directory Structure & File Relocation (`src/`):**
  - [x] Move `src/contexts/identity` -> `src/identity`
  - [x] Move `src/contexts/catalog` -> `src/catalog`
  - [x] Move `src/contexts/ordering` -> `src/ordering`
  - [x] Move `src/contexts/ledger` -> `src/ledger`
- **Slice 2 — Import Path Refactoring (`@/contexts/*` -> `@/*`):**
  - [x] Update all internal and cross-unit imports in `src/app.ts`, `src/container.ts`, and all `{domain,application,infrastructure,services}` layers.
- **Slice 3 — Living Doc Sync:**
  - [x] Update `apps/backend/docs/adr/README.md`, `_templates/agent-protocol.md`, `_templates/adr-template.md`, and `_templates/tech-stack.md` to reference `src/<unit>/`.

---

## Final Implementation Summary & Verification

- **Chosen Option:** Option A — Relocated `src/contexts/{identity,catalog,ordering,ledger}` directly under `apps/backend/src/` and updated all TypeScript imports from `@/contexts/*` to `@/*` using the existing `"@/*": ["./src/*"]` path alias in `tsconfig.json`.
- **GoF / SOLID / Enterprise Patterns Preserved:** Strict Bounded Context isolation (`{domain,application,infrastructure,services}` per unit), Dependency Inversion via `@inferdi/inferdi` (`src/container.ts`), Single Responsibility, and OpenAPI 3.1 route contracts (`src/app.ts`).
- **Verification Commands:**
  - `pnpm --filter @foodapp/backend exec tsc --noEmit` (zero type errors)
  - `pn fixed` (Biome formatting & lint check)
  - `curl -s http://localhost:3000/api/health` and `curl -s http://localhost:3000/api/doc` (zero runtime or OpenAPI schema changes)
