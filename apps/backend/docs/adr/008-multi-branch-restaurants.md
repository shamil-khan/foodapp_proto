// --- FILE: apps/backend/docs/adr/008-multi-branch-restaurants.md ---

# ADR-008: Support Multi-Branch Restaurants with Branch-Level PBAC & Menu Overrides

- **Status:** Proposed
- **Target Package:** `apps/backend` (`@foodapp/backend`)
- **Agent Protocol:** [Backend AI Agent Execution Protocol](./_templates/agent-protocol.md)
- **Tech Stack & System Baseline:** [Backend Tech Stack & System Baseline](./_templates/tech-stack.md)
- **Living Smoke Tests:** [Backend Living Smoke Tests](./_templates/curl-smoke-tests.txt)
- **Related ADRs:** `003-multi-tenant-rbac-rights-summary.md`, `004-modular-di-containers-summary.md`

---

## 1. Context & Problem Statement

Currently, the platform treats each `"Restaurant"` as a single flat tenant identified by a unique `subdomain` (e.g., `westminster-patty`) and `postcodeSector`. However, restaurant brands often operate **multiple physical branches** (e.g., _Westminster Patty Soho_, _Westminster Patty Camden_, _Westminster Patty Canary Wharf_):

1. **URL & Subdomain Routing:** Customers need to browse and order from specific branches via subdomains or slug paths (e.g., `soho.westminster-patty.fapp.com` or `westminster-patty.co.uk/soho`).
2. **Physical Address & GPS Geo-Location:** The current `Restaurant` table lacks full street address, city, postcode, and GPS coordinates (`latitude`, `longitude`), which are critical for branch proximity search, driver dispatch, and customer geolocation sorting.
3. **Menu & Pricing Overrides:** Brands require a shared brand-level catalog (categories, base menu items, modifiers) while allowing individual branches to override pricing (e.g., central London branch surcharge) or disable specific items/categories.
4. **Multi-Branch Staff & Manager Authorization:** Owners and regional managers need access across multiple branches under the same brand, with permissions (`StaffRole` / `TenantPermission`) resolved **per branch** (`AuthorizationPolicy`).

---

## 2. Architectural Options & Trade-Off Comparison

| Option                       | Architectural Approach                                                                                                         | Pros                                                                                                            | Cons                                                                                                         |
| :--------------------------- | :----------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------- |
| **Option A _(Recommended)_** | Introduce `RestaurantBrand` -> `RestaurantBranch` hierarchy with branch-level overrides table & multi-branch staff assignment. | Clean normalization, preserves existing tenant foreign keys, enables shared menus with precise price overrides. | Requires migrating foreign keys from `restaurantId` to `branchId` in transactional tables (Orders, Catalog). |
| **Option B**                 | Flat `Restaurant` table with parent `brandId` and discriminator columns.                                                       | Minimal schema changes.                                                                                         | Results in bloated tables, complex conditional queries, and brittle pricing override logic.                  |
| **Option C**                 | Completely independent tenant instances per branch with data duplication sync.                                                 | Zero schema sharing.                                                                                            | High operational overhead, impossible to maintain shared brand menus cleanly.                                |

---

## 3. Compile-First Implementation Plan (Bottom-Up)

- **Slice 1 — Domain & DB Schema (`packages/db/` & `src/contexts/catalog/domain/`):**
  - [ ] Add migration for `RestaurantBrand`, update `Restaurant` (or rename/relate to `RestaurantBranch`) with full address (`streetAddress`, `city`, `postcode`) and GPS (`latitude`, `longitude`).
  - [ ] Add `BranchMenuOverride` table for branch-specific price overrides and item visibility toggles.
- **Slice 2 — Application Layer (`src/contexts/catalog/` & `src/identity/`):**
  - [ ] Multi-branch subdomain/slug routing queries.
  - [ ] Branch-aware menu snapshot builder combining brand catalog + branch overrides.
- **Slice 3 — Infrastructure & DI (`src/container.ts`):**
  - [ ] Update `AuthorizationPolicy` to support multi-branch staff rights resolution.
- **Slice 4 — HTTP & OpenAPI 3.1 Boundary (`src/contexts/.../services/`):**
  - [ ] Update storefront and admin endpoints for multi-branch creation and management.

---

## 4. Verification & Post-Task Completion Gate

- [ ] Run `pn db:reset`, `pn fixed`, and `pnpm --filter @foodapp/backend exec tsc --noEmit`.
- [ ] Execute branch-specific storefront and authorization `curl` smoke tests.
