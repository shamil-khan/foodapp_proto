# ADR-008: Multi-Branch Restaurants, Home/Cloud Kitchens, Pricing Policies & Per-Branch PBAC

> **ARCHITECTURAL SCOPE — INCREMENTAL PROTOTYPE EVOLUTION (NO LEGACY SHIMS):**
> Build incrementally on top of the existing `@foodapp/db` and `@foodapp/backend` codebase—do **not** recreate or overwrite existing core tables (`User`, `Session`, `Account`, `Verification`, `DomainEventStore`, `AggregateMemento`, `_Saga_State`).
> Because the system is in prototype mode, do **not** add backward-compatibility shims, dual-writes, or legacy aliases for `subdomain` or old single-tenant routes; evolve the schema cleanly via sequential SQL migration `packages/db/migrations/010_multi_branch_restaurants.sql` and updated `packages/db/seeds/seed.sql`.

- **Status:** Implemented & Verified
- **Target Package:** `apps/backend` (`@foodapp/backend`) & `packages/db` (`@foodapp/db`)
- **Agent Protocol:** [Backend AI Agent Execution Protocol](./000-agent-protocol.md)

---

## 1. Context & Problem Statement

The platform is evolving from single-tenant restaurants (`subdomain`-based flat `"Restaurant"` table) into a multi-tenant marketplace supporting **four distinct seller archetypes**:

1. **Individual / Home Kitchens (`HOME_KITCHEN` — e.g., _Ayesha's Kitchen_):** Residential creators offering home-cooked items who require strict residential address/contact privacy, optional public collection drop points, toggleable takeaway vs. official platform delivery, flexible schedules, and simple onboarding without enterprise role overhead.
2. **Cloud / Dark Kitchens (`CLOUD_KITCHEN` — e.g., _BurgerLab Cloud_):** Online-only commercial delivery/pickup hubs (1 or multiple locations) with no dine-in tables, public commercial hub addresses, and lightweight 1–10 staff onboarding.
3. **Single-Location Commercial Restaurants (`RESTAURANT_BRANCH` — e.g., _BiteIn_):** Traditional single-site restaurants offering dine-in, takeaway, and delivery with straightforward staff roles.
4. **Single-City & Multi-City Multi-Branch Chains (`RESTAURANT_BRANCH` — e.g., _PizzaIn_ across Karachi branches; _Pizza Hut_ across Karachi & Lahore):** Brands operating multiple physical branches that require clean Brand (`handle`) -> City (`city`, `cityKey`) -> Branch (`branchKey`) URL routing, full physical addresses + GPS coordinates, branch contact persons, daily operational status with Redis caching & 1-hour `BUSY_PAUSED` cooldown lock, central vs. branch menu selection & price approval workflows (`"PricingPolicy"`), ingredient hashtags (`#cheese`, `#onion`, `#beef`, `#chicken`), and multi-branch staff/manager PBAC delegation.

### Out-of-Scope Boundary (Explicitly Deferred)

- **Existing `ordering` and `ledger` bounded contexts are out of scope for business-logic refactoring in ADR-008.** Both contexts require future architectural revisions (dedicated `Loyalty` context, `Platform Fee Policy`, and POS floor discount/comp ledger entries). In ADR-008, only update foreign-key column references (`restaurantId` -> `branchId` where required for compilation) so `tsc --noEmit` passes cleanly without altering `ordering` or `ledger` domain workflows.

---

## 2. Locked Architectural Decisions & User Feedback (Incremental Prototype Mode)

### Q1. Seller & Tenant Hierarchy (`"Restaurant"` + `"RestaurantBranch"` + `"RestaurantLayout"`)

- **Considered Options:**
  - _Option A (Selected):_ Unified `"Restaurant"` (Brand/Creator) -> `"RestaurantBranch"` (Physical Location) with `kitchenType` discriminator (`RESTAURANT_BRANCH` | `HOME_KITCHEN` | `CLOUD_KITCHEN`) and `"RestaurantLayout"` for web storefront theme/banners/galleries.
  - _Option B:_ Separate database tables and parallel catalog/order pipelines for `IndividualKitchen` vs. `RestaurantBranch`.
  - _Option C:_ Commercial-only model forcing home cooks through company registration and dine-in table assumptions.
- **User Feedback:**
  - Platform must allow individuals to offer home-kitchen items alongside single restaurants, cloud restaurants (online), single-city branches, and multi-city branches.
  - `"Restaurant"` + `"RestaurantBranch"` is preferred over `"RestaurantBrand"` + `"Restaurant"` because we are in prototype mode with zero legacy constraints.
  - Restaurants have logos and images, and already have `"RestaurantLayout"` to customize the web page layout—avoid duplicating `bannerUrl` or gallery images across `"Restaurant"` and `"RestaurantLayout"`.
- **Selected Implementation (Option A):**
  - `"Restaurant"` stores brand/creator identity (`name`, `handle`, `logoUrl`, optional `vatNumber` & `companyHouseNumber`, `defaultPlatformFeeRate`).
  - `"RestaurantBranch"` stores each physical location (`kitchenType`, address, GPS, contact person, fulfillment flags, schedule, privacy mode, daily status).
  - `"RestaurantLayout"` remains the single source of truth for storefront web page appearance (`templateId`, `primaryColor`, `bannerUrl`, `galleryImages JSONB`, `customConfig JSONB`).

### Q2. Operating Schedules, Fulfillment Flags, Redis Status Cooldown & Home-Kitchen Privacy

- **Considered Options:**
  - _Option A:_ `scheduleConfig JSONB` + Order-Acceptance privacy reveal (address unlocks after order acceptance).
  - _Option B:_ `scheduleConfig JSONB` + Pre-Order Host Approval Whitelist (`approvedTakeawayUserIds JSONB`).
  - _Option C:_ Hybrid privacy (official delivery never shows home address to customer; walk-in takeaway requires host whitelist).
  - _Option D:_ Daily status toggle only (no stored timetable).
  - _Option E (Selected Combination with A/B/C):_ Zero-join single-table columns + `scheduleConfig JSONB` + `dropPointConfig JSONB` + `approvedTakeawayUserIds JSONB` + toggleable `homePickupPrivacyMode` + Redis `branch:status:<branchId>` cache with 1-hour `BUSY_PAUSED` lock.
- **User Feedback:**
  - Avoid extra child tables where SQL `JOIN`s are expensive; `scheduleConfig JSONB` on `"RestaurantBranch"` is approved (with `DomainEventStore` event emission when historical state reconstruction is needed).
  - Commercial restaurants have stable weekly hours, whereas home kitchens change availability frequently and toggle status on a daily basis.
  - Use Redis caching for quick responses instead of table locks; if status is set to `BUSY_PAUSED`, lock it for **1 hour** so it cannot be changed again until the cooldown expires.
  - Both home kitchens and restaurants support pickup by official platform delivery; restaurants offer customer takeaway by default while home kitchens often do not—make these fulfillment options configurable at registration and changeable anytime.
  - Home kitchens need strict privacy (only share location/contact info upon approval), can configure a **public collection drop point** during registration so customers don't come to their home, and can toggle between Order-Acceptance reveal and Pre-Order Whitelist in settings.
- **Selected Implementation (Q2):**
  - **Fulfillment Flags (configurable at registration & editable anytime):** `supportsDineIn`, `supportsTakeaway`, `supportsPlatformDelivery` (`HOME_KITCHEN` defaults to `delivery=true, takeaway=false, dineIn=false`; `CLOUD_KITCHEN` defaults to `dineIn=false, takeaway=true, delivery=true`; `RESTAURANT_BRANCH` defaults to all `true`).
  - **Zero-Join Schedule, Contact & Redis 1-Hour Cooldown:** `scheduleConfig JSONB` (weekly slots + date overrides), `contactPersonName`, `contactPersonPhone`, `contactPersonEmail`, and `operationalStatus` (`OPEN` | `BUSY_PAUSED` | `CLOSED` | `HOLIDAY`) cached in Redis `branch:status:<branchId>` (1h TTL). Setting `BUSY_PAUSED` sets `statusLockedUntil = NOW() + 1 hour` and rejects further status updates until expiry (`409 STATUS_COOLDOWN_ACTIVE`, overridable only by `PLATFORM_ADMIN`).
  - **Home-Kitchen Privacy & Drop Point Toggle:** For `HOME_KITCHEN`, exact `streetAddress`, exact GPS coordinates, and `contactPersonPhone`/`Email` stay hidden publicly. Official delivery orders **never** expose the home address to customers (only to assigned platform riders). For walk-in takeaway (`supportsTakeaway = true`), if `dropPointConfig JSONB` is set, the public drop point is shown; if `dropPointConfig` is `null`, `homePickupPrivacyMode` toggles between `'ORDER_ACCEPTANCE'` (reveals after order acceptance) and `'WHITELIST'` (customer must be `'APPROVED'` in `approvedTakeawayUserIds JSONB` before viewing address or ordering takeaway).

### Q3. Brand & Branch URL Routing (`subdomain` Completely Removed)

- **Considered Options:**
  - _Option A:_ `/api/stores/{handle}` and `/api/stores/{handle}/{city}/{branch}`.
  - _Option B (Selected):_ `/api/brands/{brand}` and `/api/brands/{brand}/{city}/{branch}` with `Restaurant.handle`, `RestaurantBranch.city`, `cityKey`, and `branchKey`, completely removing `subdomain` from DB and code.
  - _Option C:_ Flat branch handles (`/api/stores/branch/{branchHandle}`).
  - _Option D:_ `/api/stores/{handle}/{branch}` without city in path.
  - _Option E:_ Query-string filtering only (`/api/stores/{handle}?city=...&branch=...`).
- **User Feedback:**
  - Remove `subdomain` completely from database and code.
  - Store both `city` and `cityKey` in DB to avoid runtime string parsing on every lookup, while keeping clean URL paths (`/api/brands/{brand}/{city}/{branch}`) without `Key` suffixes in URLs.
  - Support all 5 real-world examples: _Ayesha's Kitchen_ (home kitchen), _BiteIn_ (single restaurant), _BurgerLab Cloud_ (cloud restaurant), _PizzaIn_ (single-city multi-branch), and _Pizza Hut_ (multi-city multi-branch).
- **Selected Implementation (Option B):**
  - `Restaurant.handle` (`UNIQUE`), `RestaurantBranch.city`, `cityKey` (indexed), `branchKey` (indexed) with `UNIQUE(restaurantId, cityKey, branchKey)`.
  - `GET /api/brands/{brand}` returns `SINGLE_LOCATION` directly for 1-location kitchens/restaurants or `MULTI_BRANCH` grouped by city for multi-branch chains; `GET /api/brands/{brand}/{city}/{branch}` resolves a specific branch directly.

### Q4. Shared Brand Catalog, Suburb Opt-In, Ingredient Hashtags & `"PricingPolicy"` Table

- **Considered Options:**
  - _Option A (Selected):_ Dedicated `"PricingPolicy"` table (menu price workflow + POS floor discount/comp/refund guardrails) + shared brand `Category` & `MenuItem` (`ingredientTags TEXT[]` + optional `branchId`) + `RestaurantBranch.menuSelectionMode` (`ALL_BRAND_ITEMS` vs. `SELECTED_ITEMS_ONLY`) + `BranchMenuOverride` table compiled into Redis `menu:snapshot:<branchId>`.
  - _Option B:_ Same governance using `menuOverrides JSONB` on `"RestaurantBranch"` instead of `BranchMenuOverride` table.
  - _Option C:_ Category-level opt-in (`includedCategoryIds JSONB`) instead of item-level selection.
  - _Option D:_ Opt-out only (`ALL_BRAND_ITEMS` only).
  - _Option E:_ Full menu copy per branch on creation.
- **User Feedback (Q4 + Pricing Workflow & Branch Manager Authority):**
  - Each brand has its own preference: some keep uniform prices across all branches (`CENTRAL_LOCKED`), while others allow branch price overrides (`BRANCH_DIRECT` or `BRANCH_APPROVAL_REQUIRED` / `THRESHOLD_HYBRID`). Owners/managers do not want daily/weekly manual overhead—configuration must be ready-to-go from registration.
  - `"PricingPolicy"` must be a **dedicated table** (not just a column) paired with a GoF Strategy + Workflow because pricing is business-critical.
  - **What Branch Managers Do Daily (Per Policy Template & Workflow):** Branch managers manage branch pricing within policy guardrails, can add branch-local menu items (when permitted by policy & PBAC right), and handle daily floor adjustments—including **extra discounts on large orders or party events**, **refunds** within policy caps, and **100% complimentary waive-offs of an entire order** when a guest is a **celebrity or during promotional events** (with mandatory reason logging).
  - Centralized menus have long lists of items organized in **categories**; city branches usually offer all items (`ALL_BRAND_ITEMS`), while suburb branches explicitly offer only a subset (`SELECTED_ITEMS_ONLY`).
  - Menu items require **ingredient hashtags** (e.g., `#cheese`, `#onion`, `#beef`, `#chicken`) stored via `ingredientTags TEXT[]` on `MenuItem` for filtering.
- **Selected Implementation (Option A):**
  - Dedicated `"PricingPolicy"` table (`restaurantId`, nullable `branchId` override) driving `MenuPricingWorkflowStrategy` (`CENTRAL_LOCKED`, `BRANCH_DIRECT`, `BRANCH_APPROVAL_REQUIRED`, `THRESHOLD_HYBRID`) plus POS floor discount/comp/refund caps (`maxDirectOrderDiscountPercent`, `allowFullCompWaiveOff`, `requireReasonForCompOrDiscount`, `maxDirectRefundAmount`).
  - `BranchMenuOverride` (`branchId`, `menuItemId`, `priceOverride`, `pendingPriceOverride`, `approvalStatus`, `isAvailable`) + `RestaurantBranch.menuSelectionMode` + `MenuItem.branchId` (local items) + `MenuItem.ingredientTags TEXT[]` compiled into Redis `menu:snapshot:<branchId>`.

### Q5. Multi-Branch Staff/Manager Authentication, Per-Branch PBAC & Simple Onboarding

- **Considered Options:**
  - _Option A (Selected):_ Brand-level `"RestaurantStaff"` + `"StaffBranchAssignment"` (`staffId`, `branchId`, `staffRoleId`, `directPermissions TEXT[]`) + single HTTP-only cookie (`pos_staff_token`) across multiple branches + `POST /api/pos/auth/switch-branch` + `TenantBootstrapStrategy` simple onboarding.
  - _Option B:_ All branch role IDs packed into JWT without explicit active branch context.
  - _Option C:_ Single `roleId` across all assigned branches (no per-branch role differentiation).
  - _Option D:_ Separate `"RestaurantStaff"` login accounts per branch.
  - _Option E:_ Global Better Auth `"User"` login for multi-branch managers.
- **User Feedback:**
  - All staff are direct employees of the brand (`RestaurantStaff.restaurantId`).
  - Brand Manager/Owner can assign/revoke roles and rights to Operational Managers and Branch Managers.
  - Operational Manager is a brand-level manager granted rights across multiple branches by Brand Admin/Owner.
  - Branch Manager holds rights to specific branches (mostly one) and can assign/revoke roles and rights to branch staff **only within what the Branch Manager personally holds**.
  - Single cookie (`pos_staff_token`) works across multiple branches (resolved dynamically against the actor's rights on the target branch).
  - System must expose a complete list of all system rights/permissions (`GET /api/pos/roles/rights`), keep **predefined roles immutable (not editable/deletable)**, allow **new custom roles to be added, updated, and soft-deleted**, and support **direct assignment of individual permission rights to an actor** (`directPermissions`).
  - Home kitchens, single restaurants, and cloud kitchens (1–10 staff) do **not** need complex multi-branch hierarchy at registration—bootstrap them with a simple flow and lightweight roles automatically based on registration type.
- **Selected Implementation (Option A):**
  - `StaffBranchAssignment` (`staffId`, `branchId`, `staffRoleId`, `directPermissions TEXT[]`, `isPrimary`) resolves `EffectivePermissions = RolePermissions(staffRoleId) U directPermissions`.
  - `CanDelegatePermissionsSpec` enforces `actorPermissions >= targetPermissions` on all role creations, role updates, role assignments, and direct permission grants.
  - `TenantBootstrapStrategy` seeds lightweight roles (`OWNER`, `STAFF`) for `HOME_KITCHEN`, single-site `RESTAURANT_BRANCH`, and `CLOUD_KITCHEN` (1–10 staff), and seeds the full predefined system role hierarchy (`BRAND_OWNER`, `OPERATIONAL_MANAGER`, `BRANCH_MANAGER`, `SHIFT_SUPERVISOR`, `CASHIER`, `KITCHEN_STAFF` with `isSystemRole = true`) for multi-branch chains.

### Q6. Dual Brand & Branch Onboarding (Self-Service Seller Signup + Platform Admin Provisioning)

- **Considered Options:**
  - _Option A (Selected):_ Dual onboarding supporting self-service seller signup (`POST /api/brands/register`), self-service branch expansion for existing brand owners/operational managers (`POST /api/brands/pos/branches`), and platform admin provisioning (`POST /api/admin/brands`).
  - _Option B:_ Platform-admin-only brand creation + self-service branch expansion.
  - _Option C:_ Self-service registration starting suspended (`isActiveOverride = false`) until admin approval.
- **User Feedback:**
  - Approved **Option A** so individual home cooks, cloud kitchens, and commercial restaurant brands can self-onboard immediately in prototype mode while retaining `PLATFORM_ADMIN` provisioning and suspension controls.
- **Selected Implementation (Option A):**
  - `POST /api/brands/register`: Creates `"Restaurant"` + initial `"RestaurantBranch"` + `"RestaurantLayout"` + `"PricingPolicy"` + `"PaymentConfig"` + bootstrapped `"StaffRole"`s + brand-level `"RestaurantStaff"` (`OWNER`) + `"StaffBranchAssignment"` atomically.
  - `POST /api/brands/pos/branches`: Allows actors with `brand:branches:create` right on their brand to add additional branches and automatically assign themselves branch access.
  - `POST /api/admin/brands` & `PATCH /api/admin/brands/{restaurantId}/status`: Retains `PLATFORM_ADMIN` provisioning and tenant suspension override.

### Q7. Extensibility-First Declarative PBAC Registry & Branch-Scoped Permission Resolution

- **Considered Options:**
  - _Option A (Selected):_ Single-source-of-truth declarative registries (`TENANT_PERMISSION_REGISTRY` and `SYSTEM_ROLE_DEFINITIONS`) in `packages/db/src/types.ts` paired with branch-scoped resolution (`StaffBranchAssignment` -> `RolePermissions(staffRoleId) U directPermissions`) cached in Redis (`staff:branch:perms:<staffId>:<branchId>`).
  - _Option B:_ Coarse-grained 10-permission flat list without domain categorization.
  - _Option C:_ Brand-wide role with `allowedBranchIds TEXT[]` filter.
- **User Feedback:**
  - Approved **Option A**, emphasizing that permissions and predefined system roles will evolve as the platform integrates with the frontend—adding a new system right, permission category, or predefined role must be a straightforward single-place edit.
- **Selected Implementation (Option A):**
  - `TENANT_PERMISSION_REGISTRY` in `packages/db/src/types.ts` defines each right's key, domain group (`BRAND_BRANCH`, `CATALOG_PRICING`, `POS_ORDERS`, `LEDGER_TEAM`), label, and description; `TENANT_PERMISSIONS`, `TENANT_PERMISSION_CATALOG`, TypeScript `TenantPermission` union, and Zod `TenantPermissionSchema` derive automatically.
  - `SYSTEM_ROLE_DEFINITIONS` in `packages/db/src/types.ts` defines all predefined system roles (`OWNER`, `BRAND_OWNER`, `OPERATIONAL_MANAGER`, `BRANCH_MANAGER`, `SHIFT_SUPERVISOR`, `CASHIER`, `KITCHEN_STAFF`, `STAFF`) in one declarative map.

### Q8. Split Public-Slug Storefront Routing & Direct `branchId` Menu Snapshot Lookup

- **Considered Options:**
  - _Option A (Selected):_ Keep slug-based storefront resolution (`GET /api/brands/{brand}` and `GET /api/brands/{brand}/{city}/{branch}`) while retaining `GET /api/brands/branches/{branchId}/menu` (with reserved handle guard `RESERVED_BRAND_HANDLES` blocking `"branches"`, `"pos"`, `"register"`, `"admin"`, `"auth"`, `"me"`).
  - _Option B:_ Replace `/api/brands/branches/{branchId}/menu` with `/api/brands/{brand}/{city}/{branch}/menu`.
- **User Feedback:**
  - Decided to keep `GET /api/brands/branches/{branchId}/menu` because `branchId` simplifies O(1) Redis `menu:snapshot:<branchId>` lookups once the client resolves the branch, while reserving `"branches"` and `"pos"` against brand handle registration.
- **Selected Implementation (Option A):**
  - `GET /api/brands/branches/{branchId}/menu` reads/builds the branch `CompiledMenuSnapshot` directly by `branchId` (with optional `?tag=#ingredient` filter).
  - `RESERVED_BRAND_HANDLES` blocks reserved platform slugs from `Restaurant.handle` registration at both the Zod schema layer and `RegisterBrandHandler`.

---

## Final Implementation Summary & Verification

- **Status:** Implemented & Verified (`25/25` automated Vitest smoke tests passing across `01`–`05`).
- **Locked Decisions Applied (Q1–Q8):**
  - Unified `"Restaurant"` (Brand) + `"RestaurantBranch"` (`RESTAURANT_BRANCH` | `HOME_KITCHEN` | `CLOUD_KITCHEN`) with `handle`, `city`, `cityKey`, and `branchKey` (`subdomain` completely removed).
  - Zero-join `scheduleConfig`, `dropPointConfig`, `approvedTakeawayUserIds` JSONB + Redis `branch:status:<branchId>` with 1-hour `BUSY_PAUSED` cooldown lock (`BranchStatusCache`).
  - Home-kitchen address/contact privacy projection (`projectBranchLocationForViewer`) supporting public drop points, order-acceptance reveal, and pre-order customer whitelists.
  - Dedicated `"PricingPolicy"` (`CENTRAL_LOCKED`, `BRANCH_DIRECT`, `BRANCH_APPROVAL_REQUIRED`, `THRESHOLD_HYBRID`), `"BranchMenuOverride"`, `MenuItem.ingredientTags TEXT[]` (GIN-indexed), and branch-local menu items.
  - Extensibility-first declarative `TENANT_PERMISSION_REGISTRY` (17 rights) & `SYSTEM_ROLE_DEFINITIONS` in `packages/db/src/types.ts`, per-branch `StaffBranchAssignment` (`directPermissions TEXT[]`), single-cookie branch switching (`POST /api/pos/auth/switch-branch`), and `CanDelegatePermissionsSpec`.
  - Reserved brand handle blocklist (`RESERVED_BRAND_HANDLES`) preventing collisions with `/api/brands/branches/{branchId}/menu`.
- **GoF, SOLID & Enterprise Patterns Applied:**
  - **Strategy:** `MenuPricingWorkflowStrategy`, `resolveTenantBootstrapPlan`.
  - **Builder:** `MenuSnapshotBuilder`.
  - **Specification & Decorator:** `HasPermissionSpec`, `SameRestaurantSpec`, `SameBranchSpec`, `CanDelegatePermissionsSpec`, `AuthorizingCommandHandlerDecorator`, `AuthorizingQueryHandlerDecorator`.
  - **Unit of Work & Cache-Aside:** Atomic `BEGIN`/`COMMIT` transactions in `RegisterBrandHandler` & `CreateStaffRoleHandler`; Redis `RolePermissionCache`, `BranchStatusCache`, and `MenuCacheInvalidationHandler`.
- **Verification Results:**
  - `pn db:reset`: Applied `010_multi_branch_restaurants.sql`, regenerated `@foodapp/db` types, and seeded all 5 seller archetypes.
  - `pn fixed && pnpm --filter @foodapp/backend exec tsc --noEmit`: Passed with `0` errors and `0` warnings.
  - `pnpm --filter @foodapp/backend test:smoke`: `5 passed (5)` test files, `25 passed (25)` automated Vitest smoke tests in `1.79s`.
