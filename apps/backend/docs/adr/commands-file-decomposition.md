# ADR: Cohesive Sub-Domain Command Decomposition & Barrel Convention (`commands.ts`)

- **Status:** Proposed

## 1. Problem Statement & Architectural Goal

- **Business & Technical Problem:**
  1. Several bounded contexts (`brand`, `catalog`, `iam`, `billing`, `loyalty`) have accumulated large multi-handler command files (`brand-commands.ts` ~740 lines, `pricing-policy-commands.ts` ~560 lines, `role-commands.ts` ~580 lines, `loyalty/application/commands.ts` ~445 lines, `billing/application/commands.ts` ~405 lines) that mix distinct actor workflows, pricing/policy lookups, and state mutations inside single files.
  2. Monolithic command files increase merge conflicts across parallel feature work, inflate Biome cognitive complexity metrics, and obscure bounded-context sub-capabilities (e.g., merchant settlement vs. refund/payout administration, or customer loyalty maturation vs. governance/audit).
  3. During `ADR-016`, decomposing `orders/application/commands.ts` into `storefront-order-commands.ts`, `pos-order-commands.ts`, and `order-pricing-helpers.ts`—while preserving `orders/application/commands.ts` as a re-export barrel—eliminated cognitive complexity warnings without breaking `container.ts` or test imports.
- **Architectural Goal:** Standardize cohesive sub-domain command decomposition across `@foodapp/backend` bounded contexts (`brand`, `catalog`, `iam`, `billing`, `loyalty`) following the `orders/application/` barrel pattern, keeping every command module focused, readable (`< 300` lines per file), and Biome-compliant with zero breaking changes to DI wiring, deferred to a dedicated future refactor milestone.

---

## 2. Architectural Decisions (Q&A)

### Q1. File Splitting Granularity, Architectural Trade-Offs & Barrel Re-Export Convention

- **Considered Options:**
  - _Option A (Selected):_ **Cohesive Sub-Domain / Actor-Capability Modules + `commands.ts` Barrel (`orders` Pattern)** — Group tightly related command handlers into cohesive `<capability>-commands.ts` files and extract shared query/calculation helpers into `<context>-helpers.ts` (targeting `< 300` lines per file), while keeping `commands.ts` as a pure barrel re-export (`export { ... } from ...`) so `src/container.ts` and test imports remain unchanged. — **Pros:** Matches `orders/application/` (`storefront-order-commands.ts`, `pos-order-commands.ts`, `order-pricing-helpers.ts`), avoids file explosion across ~35 handlers, keeps Biome cognitive complexity low, and preserves backward-compatible imports. | **Cons:** Adds barrel re-export files (`commands.ts`) that contain zero runtime statements (requiring V8 coverage exclusions in `vitest.config.ts`) and requires discipline so helper files (`*-helpers.ts`) do not become miscellaneous dumping grounds.
  - _Option B:_ **Strict One-Handler-Per-File Convention** — Place every individual `CommandHandler` in its own dedicated `<action>-command.ts` file across all 7 bounded contexts. — **Pros:** Maximum single-file isolation and zero ambiguity over where a handler lives. | **Cons:** Creates ~35–40 small files with duplicated boilerplate imports, fragments tightly coupled lifecycle handlers (e.g., `CreateStaffRoleHandler`, `UpdateStaffRoleHandler`, `DeleteStaffRoleHandler`), and adds navigation overhead across small command classes.
  - _Option C:_ **Leave Monolithic Command Files Unchanged** — Keep all handlers inside single `commands.ts` / `*-commands.ts` files and only extract private helper methods when Biome triggers a complexity warning. — **Pros:** Zero file moves, zero barrel files, and immediate completion without touching working modules. | **Cons:** Leaves 400–740 line mixed-responsibility files harder to review, test in isolation, and evolve independently as features grow.
- **Architectural Critique & User Commentary:**
  - **Architectural Critique:** While Option B (1-handler-per-file) is common in large enterprise C#/Java codebases, in TypeScript modular monoliths it creates excessive file sprawl and duplicated import headers for closely coupled CRUD/workflow handlers; conversely, Option C (leaving 400–740 line files intact) increases cognitive load and merge friction. Option A strikes the pragmatic DDD balance—grouping by actor/sub-domain capability (matching `orders/application/`) while keeping `commands.ts` as a stable public facade—with the explicit caveat that `vitest.config.ts` must exclude pure barrel `commands.ts` files from statement coverage denominators and implementation must be deferred until the active milestone (`ADR-015` / `ADR-016`) is completed and committed.
  - **User Commentary & Trade-Off Evaluation:** Engineering Lead explicitly directed that this decomposition must **not** be executed prematurely during `ADR-016` (preventing unrequested code generation and scope creep while the in-hand security/coverage task was still being finalized), and confirmed capturing the blueprint now as a `Proposed` ADR (`ADR-017`) so it can be executed cleanly in a dedicated follow-up task.
- **Selected Implementation:** Adopt Option A across `brand`, `catalog`, `iam`, `billing`, and `loyalty` as a deferred refactor (`Status: Proposed`), splitting multi-responsibility command files into cohesive `<capability>-commands.ts` + `<context>-helpers.ts` modules behind a clean `commands.ts` barrel re-export.

---

## 3. Proposed Implementation Blueprint & Agent Handover (Advisory)

> _Note for Implementing Agent: The structure, packages, and file layout below reflect the designing architect's proposed blueprint and may differ based on your own codebase inspection and judgment. Any dependency changes still require explicit user approval._

- **Bounded Contexts Impacted:** `brand`, `catalog`, `iam`, `billing`, `loyalty` (plus `apps/backend/vitest.config.ts` barrel coverage exclusion)
- **Proposed Packages:** `None`
- **Existing Knowledge-Base Files (Read-Only Context to Attach):**
  - `apps/backend/docs/adr/000-agent-protocol.md` — Execution workflow, scaffold-first gate, and minimal-comment standards
  - `apps/backend/src/orders/application/commands.ts` — Reference barrel re-export pattern (`pos-order-commands.ts`, `storefront-order-commands.ts`, `order-pricing-helpers.ts`)
  - `apps/backend/src/container.ts` — Bounded-context DI handler imports
- **Existing Files to Modify or Decompose (Proposed):**
  - `apps/backend/src/brand/application/brand-commands.ts` (~740 lines) -> split into:
    - `brand/application/brand-registration-commands.ts` (`RegisterBrandHandler`, `hashStaffPassword`, `slugifyKey`, `RESERVED_BRAND_HANDLES`)
    - `brand/application/branch-operations-commands.ts` (`CreateBrandBranchHandler`, `UpdateBranchOperationalStatusHandler`, `UpdateBranchSettingsHandler`, `ReviewTakeawayWhitelistHandler`)
    - `brand/application/commands.ts` (barrel re-exporting brand registration, branch operations, and `admin-brand-commands.ts`)
  - `apps/backend/src/catalog/application/pricing-policy-commands.ts` (~560 lines) -> split into:
    - `catalog/application/pricing-policy-commands.ts` (`loadEffectivePricingPolicy`, `UpsertPricingPolicyHandler`)
    - `catalog/application/branch-menu-commands.ts` (`UpsertBranchMenuOverrideHandler`, `ReviewPriceOverrideHandler`, `CreateMenuItemHandler`)
    - `catalog/application/commands.ts` (barrel re-exporting `UpdateMenuItemPriceHandler`, pricing policy, and branch menu commands)
  - `apps/backend/src/iam/application/role-commands.ts` (~580 lines) -> split into:
    - `iam/application/role-commands.ts` (`CreateStaffRoleHandler`, `UpdateStaffRoleHandler`, `DeleteStaffRoleHandler`)
    - `iam/application/staff-assignment-commands.ts` (`AssignStaffBranchAccessHandler` and direct rule normalization helpers)
    - `iam/application/commands.ts` (barrel re-exporting role, staff assignment, login, and branch switch commands)
  - `apps/backend/src/billing/application/commands.ts` (~405 lines) -> split into:
    - `billing/application/settlement-commands.ts` (`BillingSettlementService`, `SettleMerchantHandler`)
    - `billing/application/refund-commands.ts` (`RefundOrderHandler`)
    - `billing/application/commands.ts` (barrel re-exporting settlement and refund handlers)
  - `apps/backend/src/loyalty/application/commands.ts` (~445 lines) -> split into:
    - `loyalty/application/loyalty-settlement-commands.ts` (`LoyaltySettlementService`)
    - `loyalty/application/loyalty-governance-commands.ts` (`UpdateLoyaltyGovernanceHandler`, `AuditLoyaltyEntryHandler`)
    - `loyalty/application/commands.ts` (barrel re-exporting settlement and governance handlers)
  - `apps/backend/vitest.config.ts` — Exclude pure barrel `src/*/application/commands.ts` files from V8 statement coverage so zero-statement re-export files do not skew coverage denominators.
- **Handover Rationale & Compile-First Layer Plan (Why This Approach):**
  - **Architectural Rationale:** Keeping `commands.ts` as a pure barrel in every bounded context guarantees zero import churn in `src/container.ts`, controllers, and unit/integration tests while isolating each sub-domain workflow into focused, reviewable files under 300 lines.
  - **Execution Order:** Decompose one bounded context at a time (`billing` -> `loyalty` -> `catalog` -> `iam` -> `brand`), preserving all exported types and classes via `commands.ts`, then run `pnpm --filter @foodapp/backend fixed`, `pnpm --filter @foodapp/backend build-2`, and `pnpm --filter @foodapp/backend test:coverage`.
