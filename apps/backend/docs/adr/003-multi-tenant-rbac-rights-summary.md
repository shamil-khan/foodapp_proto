# Summary: Subdomain Multi-Tenancy, Dynamic Roles & Rights (PBAC), and Resource-Level Authorization

- **Target Packages:** `packages/db` (`@foodapp/db`), `apps/backend` (`@foodapp/backend`)
- **Related ADR:** `apps/backend/docs/adr/002-multi-tenant-rbac-rights-authorization.md`
- **Status:** Implemented & Verified via `pn db:reset`, `pn fixed`, and Live `curl` Tests

---

## 1. Summary of Task & Chosen Architectural Options

1. **Subdomain Tenant Routing (`*.fapp.com`) & Internal `restaurantId`:**
   - Kept internal `restaurantId` UUIDs hidden from POS terminal logins by adding a unique URL-safe `"subdomain"` column to `"Restaurant"` (e.g., `westminster-patty`, `smash360`).
   - Updated `POST /api/pos/auth/login` to authenticate via `{ subdomain, email, password }`, returning `401 INVALID_CREDENTIALS` on cross-tenant mismatches and `403 TENANT_SUSPENDED` when `isActiveOverride === false`.
   - Added public `GET /api/restaurants/by-subdomain/{subdomain}` to resolve restaurant metadata and branding from storefront URLs.

2. **Normalized Dynamic Roles & Rights (PBAC) + Redis Live Revocation (Option A):**
   - Defined static capability rights (`Permission`) across three actor classes:
     - **POS Tenant Rights:** `catalog:price:update`, `orders:read`, `orders:place`, `orders:settle`, `ledger:read`, `staff:roles:manage`, `staff:manage`
     - **Customer Rights (`GLOBAL_USER`):** `storefront:orders:place`, `storefront:orders:read`, `loyalty:read`, `loyalty:redeem`
     - **Platform Admin Rights (`PLATFORM_ADMIN`):** `platform:restaurants:manage`, `platform:tenants:support` (plus full cross-tenant bypass)
   - Created normalized PostgreSQL tables `"StaffRole"` and `"StaffRolePermission"` (avoiding PostgreSQL composite type collision with the existing `"TenantRole"` ENUM) and linked `"RestaurantStaff"."roleId"`.
   - Implemented `RolePermissionCache` (`role:perms:<roleId>` in Redis, 1-hour TTL) invalidated immediately on `PATCH /api/pos/roles/{roleId}` or `DELETE /api/pos/roles/{roleId}` for zero-delay right revocation.

3. **Cross-Context Policy & Command/Query Bus Decorators (Option A + Option C):**
   - **GoF Specification (`src/core/application/authorization.ts`):** `HasPermissionSpec`, `SameRestaurantSpec`, `SameUserSpec`.
   - **GoF Strategy (`AuthorizationPolicy`):** Request-scoped DI service (`'scoped'`) enforcing capability checks (`403 INSUFFICIENT_RIGHTS`) and multi-tenant ownership (`403 TENANT_FORBIDDEN` / `403 USER_FORBIDDEN`).
   - **GoF Decorator (`src/core/application/cqrs.ts`):** `AuthorizingCommandHandlerDecorator` and `AuthorizingQueryHandlerDecorator` enforcing `requiredPermission` automatically on `InMemoryCommandBus` and `InMemoryQueryBus`.

4. **Role/Rights CRUD & Platform Admin Tenant Management:**
   - Exposed `/api/pos/roles/rights` (`GET`), `/api/pos/roles` (`GET`, `POST`), `/api/pos/roles/{roleId}` (`PATCH`, `DELETE`), and `/api/pos/staff/{staffId}/role` (`PATCH`), keeping `OWNER` immutable (`403 SYSTEM_ROLE_LOCKED`) and blocking deletion of roles with active staff (`409 ROLE_IN_USE`).
   - Exposed `POST /api/admin/restaurants` and `PATCH /api/admin/restaurants/{restaurantId}/status` for `PLATFORM_ADMIN` tenant onboarding and suspension.

---

## 2. User Commentary & Key Decisions

- **Subdomain-First Tenant Identity:** You specified that `restaurantId` is internal and restaurant owners register a unique URL subdomain (e.g., `://fapp.com`, `://fapp.com`) independent of the display name.
- **Rights-Based Roles Over Static Roles:** You requested dynamic tenant-managed roles (`add/edit/delete/assign`) backed by granular rights so restaurant owners can tailor staff capabilities while `OWNER` stays protected from lockout.
- **Customer & Platform Admin Boundaries:** `GLOBAL_USER` (`CUSTOMER`) receives explicit storefront/loyalty rights, while `PLATFORM_ADMIN` holds cross-tenant authority to register/suspend restaurants and resolve tenant support issues.
- **Revised Master Seed (`seed.sql`):** Updated `packages/db/seeds/seed.sql` to seed unique subdomains for all 10 UK restaurants, default `OWNER`/`ADMIN`/`MANAGER`/`ORDER_TAKER` roles + rights, and linked `roleId`s for all 100 staff records.
## 3. Packages & Environment Configuration

- **New Packages Installed:** None (built on existing `@hono/zod-openapi` `^1.6.3`, `@scalar/hono-api-reference` `^0.12.20`, `zod` `^4.6.7`, `@inferdi/inferdi` `^6.1.1`, `@inferdi/hono` `^6.1.1`, `better-auth` `^1.7.20`, `hono` `^4.13.16`, `pg` `^8.23.1`, `redis` `^6.3.1`).
- **Environment Variables (`apps/backend/.env`):**
  - `DATABASE_URL` (PostgreSQL 18 connection string)
  - `REDIS_URL` (Redis 8 connection string for `role:perms:<roleId>` cache and menu snapshots)
  - `BETTER_AUTH_SECRET` (JWT & session signing secret)
  - `FRONTEND_ORIGINS` (comma-separated allowed cross-cloud origins)

---

## 4. Folder & File Structure Modified / Created

```text
packages/db/
├── migrations/009_tenant_subdomain_roles_and_rights.sql   (NEW)
├── seeds/seed.sql                                         (UPDATED)
└── src/
    ├── schema.generated.ts                                (REGENERATED via pn db:reset)
    └── types.ts                                           (UPDATED - Permission constants)

apps/backend/
├── docs/adr/
│   ├── 002-multi-tenant-rbac-rights-authorization.md      (NEW - Approved ADR)
│   └── 002-multi-tenant-rbac-rights-summary.md            (NEW - Final Summary)
└── src/
    ├── app.ts                                             (UPDATED - /api/admin mount)
    ├── container.ts                                       (UPDATED - DI & Bus permissions)
    ├── core/application/
    │   ├── authorization.ts                               (NEW - Specification & Strategy)
    │   └── cqrs.ts                                        (UPDATED - Authz Bus Decorators)
    └── contexts/
        ├── identity/
        │   ├── domain/auth-actor.ts                       (UPDATED)
        │   ├── infrastructure/
        │   │   ├── pos-token-service.ts                   (UPDATED)
        │   │   └── role-permission-cache.ts               (NEW)
        │   ├── application/
        │   │   ├── pos-login-command.ts                   (UPDATED)
        │   │   ├── role-commands.ts                       (NEW)
        │   │   └── role-queries.ts                        (NEW)
        │   └── services/
        │       ├── auth-middleware.ts                     (UPDATED)
        │       ├── identity-schemas.ts                    (UPDATED)
        │       ├── identity-controller.ts                 (UPDATED)
        │       └── identity-routes.ts                     (UPDATED)
        ├── catalog/
        │   ├── infrastructure/catalog-repository.ts       (UPDATED)
        │   ├── application/{admin-restaurant-commands.ts, commands.ts, queries.ts}
        │   └── services/{catalog-schemas.ts, catalog-controller.ts, catalog-routes.ts}
        ├── ordering/
        │   ├── application/{commands.ts, queries.ts}
        │   └── services/{order-schemas.ts, order-controller.ts}
        └── ledger/
            ├── application/{commands.ts, queries.ts}
            └── services/{ledger-controller.ts, ledger-routes.ts}
```

---

## 5. Verified `curl` Test Results

- `GET /api/restaurants/by-subdomain/westminster-patty` -> **`200 OK`** (resolved restaurant ID `a0000000-0000-4000-8000-000000000002` & branding).
- `POST /api/pos/auth/login` (`westminster-patty` + `staff1.0002@pos-tenant.co.uk`) -> **`200 OK`** (issued HS256 JWT with all 7 `OWNER` rights).
- `POST /api/pos/auth/login` (`smash360` + `staff1.0002@pos-tenant.co.uk`) -> **`401 Unauthorized`** (`INVALID_CREDENTIALS`).
- `GET /api/pos/orders?restaurantId=a0000000-0000-4000-8000-000000000001` (with `westminster-patty` `OWNER` JWT) -> **`403 Forbidden`** (`TENANT_FORBIDDEN`).
- `GET /api/pos/roles/rights` -> **`200 OK`** (returned all 7 tenant rights).
- `GET /api/pos/roles` -> **`200 OK`** (returned `OWNER`, `ADMIN`, `MANAGER`, `ORDER_TAKER` with rights).
- `POST /api/pos/roles` (`KITCHEN_VIEWER` with `["orders:read"]`) -> **`201 Created`** (`roleId: 7ccc6423-1bca-4d9d-8374-03870c02585e`).

---

# End-to-End API Verification & `curl` Test Suite: Subdomain Multi-Tenancy, Dynamic Roles & Rights (PBAC)

**Base URL:** `http://localhost:3000`  
**OpenAPI 3.1 Spec:** `http://localhost:3000/api/doc`  
**Interactive Scalar UI:** `http://localhost:3000/api/reference`

---

## 0. Pre-Flight Setup

```bash
# Reset DB, apply migrations 001–009, regenerate @foodapp/db metadata, and seed 10 subdomains + roles
pn db:reset

# Format & lint backend TypeScript
pn fixed

# Start backend development server
pnpm --filter @foodapp/backend dev
```

---

## 1. Export Session Tokens (`BASE_URL`, `OWNER_TOKEN`, `TAKER_TOKEN`, `OTHER_TENANT_TOKEN`)

```bash
export BASE_URL="http://localhost:3000"

# 1. Login as Restaurant 2 (westminster-patty) OWNER
export OWNER_TOKEN=$(curl -s -X POST "$BASE_URL/api/pos/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"subdomain":"westminster-patty","email":"staff1.0002@pos-tenant.co.uk","password":"Password123!"}' \
  | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(d.token)")

# 2. Login as Restaurant 2 (westminster-patty) ORDER_TAKER
export TAKER_TOKEN=$(curl -s -X POST "$BASE_URL/api/pos/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"subdomain":"westminster-patty","email":"staff5.0002@pos-tenant.co.uk","password":"Password123!"}' \
  | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(d.token)")

# 3. Login as Restaurant 1 (smash360) OWNER
export OTHER_TENANT_TOKEN=$(curl -s -X POST "$BASE_URL/api/pos/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"subdomain":"smash360","email":"staff1.0001@pos-tenant.co.uk","password":"Password123!"}' \
  | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(d.token)")

# 4. Fetch Menu Item IDs for Restaurant 2 & Restaurant 1
export MENU_ITEM_ID=$(curl -s "$BASE_URL/api/restaurants/a0000000-0000-4000-8000-000000000002/menu" \
  | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(d.categories[0].items[0].id)")

export REST1_ITEM_ID=$(curl -s "$BASE_URL/api/restaurants/a0000000-0000-4000-8000-000000000001/menu" \
  | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(d.categories[0].items[0].id)")

echo "OWNER_TOKEN=${OWNER_TOKEN:0:20}..."
echo "TAKER_TOKEN=${TAKER_TOKEN:0:20}..."
echo "OTHER_TENANT_TOKEN=${OTHER_TENANT_TOKEN:0:20}..."
echo "MENU_ITEM_ID=$MENU_ITEM_ID"
echo "REST1_ITEM_ID=$REST1_ITEM_ID"
```

---

## 2. Public Subdomain Resolution & Authentication Tests

### 2.1 Resolve Restaurant by Subdomain (`200 OK`)

```bash
curl -i -s "$BASE_URL/api/restaurants/by-subdomain/westminster-patty" && echo ""
```
**Expected (`200 OK`):**

```json
{
  "restaurant": {
    "id": "a0000000-0000-4000-8000-000000000002",
    "name": "Westminster Patty Co",
    "subdomain": "westminster-patty",
    "postcodeSector": "SW1A",
    "foodHygieneRating": 5,
    "averagePrepTimeMinutes": 12,
    "branding": {
      "templateId": "uk_pos_modern_v1",
      "primaryColor": "#1E293B",
      "bannerUrl": null
    }
  }
}
```

### 2.2 Cross-Subdomain Staff Login Rejected (`401 Unauthorized`)

```bash
curl -i -s -X POST "$BASE_URL/api/pos/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"subdomain":"smash360","email":"staff1.0002@pos-tenant.co.uk","password":"Password123!"}' && echo ""
```
**Expected (`401 Unauthorized`):**

```json
{ "code": "INVALID_CREDENTIALS", "error": "Invalid POS staff credentials." }
```

### 2.3 Inspect Active Actor & Effective Rights (`200 OK`)

```bash
curl -i -s "$BASE_URL/api/me" -H "Authorization: Bearer $OWNER_TOKEN" && echo ""
```
**Expected (`200 OK`):**

```json
{
  "actor": {
    "id": "<UUID>",
    "source": "POS_STAFF",
    "name": "Staff 5 (Westminster Patty Co)",
    "email": "staff5.0002@pos-tenant.co.uk",
    "role": "ORDER_TAKER",
    "restaurantId": "a0000000-0000-4000-8000-000000000002",
    "roleId": "<UUID>",
    "permissions": ["orders:place", "orders:read"]
  }
}
```

---

## 3. Dynamic Roles & Rights CRUD + Live Redis Revocation

### 3.1 List Assignable Rights (`200 OK`)

```bash
curl -i -s "$BASE_URL/api/pos/roles/rights" \
  -H "Authorization: Bearer $OWNER_TOKEN" && echo ""
```
**Expected (`200 OK`):**

```json
{
  "rights": [
    "catalog:price:update",
    "orders:read",
    "orders:place",
    "orders:settle",
    "ledger:read",
    "staff:roles:manage",
    "staff:manage"
  ]
}
```

### 3.2 List Seeded Roles & Rights (`200 OK`)

```bash
curl -i -s "$BASE_URL/api/pos/roles" \
  -H "Authorization: Bearer $OWNER_TOKEN" && echo ""
```
**Expected (`200 OK`):** JSON containing `roles` array (`ADMIN`, `MANAGER`, `ORDER_TAKER`, `OWNER`) with `isSystemRole: true` on `OWNER`.

### 3.3 Create a Custom Role (`201 Created`) & Capture `CUSTOM_ROLE_ID`

```bash
export CUSTOM_ROLE_ID=$(curl -s -X POST "$BASE_URL/api/pos/roles" \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"SHIFT_LEAD","description":"Can place & settle orders","permissions":["orders:read","orders:place","orders:settle"]}' \
  | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(d.roleId)")

echo "CUSTOM_ROLE_ID=$CUSTOM_ROLE_ID"
```
**Expected (`201 Created`):**

```json
{
  "roleId": "<UUID>",
  "name": "SHIFT_LEAD",
  "permissions": ["orders:read", "orders:place", "orders:settle"]
}
```

### 3.4 Update Role Rights & Invalidate Redis Cache (`200 OK`)

```bash
curl -i -s -X PATCH "$BASE_URL/api/pos/roles/$CUSTOM_ROLE_ID" \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"description":"Read-only orders","permissions":["orders:read"]}' && echo ""
```
**Expected (`200 OK`):**

```json
{ "success": true }
```

### 3.5 Attempt to Modify Immutable `OWNER` Role (`403 SYSTEM_ROLE_LOCKED`)

```bash
export OWNER_ROLE_ID=$(curl -s "$BASE_URL/api/pos/roles" \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(d.roles.find(r=>r.name==='OWNER').id)")

curl -i -s -X PATCH "$BASE_URL/api/pos/roles/$OWNER_ROLE_ID" \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"permissions":["orders:read"]}' && echo ""
```
**Expected (`403 Forbidden`):**

```json
{
  "code": "SYSTEM_ROLE_LOCKED",
  "error": "The primary OWNER role cannot be edited or have its rights revoked."
}
```

### 3.6 Soft-Delete Unused Custom Role (`200 OK`)

```bash
curl -i -s -X DELETE "$BASE_URL/api/pos/roles/$CUSTOM_ROLE_ID" \
  -H "Authorization: Bearer $OWNER_TOKEN" && echo ""
```
**Expected (`200 OK`):**

```json
{ "success": true }
```

---

## 4. Ordering, Settlement, Double-Entry Ledger & Cross-Tenant Isolation

### 4.1 Fetch a Valid Menu Item ID for Restaurant 2 (`westminster-patty`)

```bash
export MENU_ITEM_ID=$(curl -s "$BASE_URL/api/restaurants/a0000000-0000-4000-8000-000000000002/menu" \
  | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(d.categories[0].items[0].id)")

echo "MENU_ITEM_ID=$MENU_ITEM_ID"
```

### 4.2 Place a New POS Order (`201 Created`) & Capture `ORDER_ID`

```bash
export ORDER_ID=$(curl -s -X POST "$BASE_URL/api/pos/orders" \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"orderSource\":\"DINE_IN\",\"items\":[{\"menuItemId\":\"$MENU_ITEM_ID\",\"quantity\":2}]}" \
  | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(d.orderId)")

echo "ORDER_ID=$ORDER_ID"
```
**Expected (`201 Created`):**

```json
{
  "orderId": "<UUID>",
  "kdsTickets": {
    "orderId": "<UUID>",
    "stationSlips": {
      "KITCHEN_SCREEN": [{ "itemName": "The Light One (SW1A)", "qty": 2, "mods": [] }],
      "BAR_PRINTER": [],
      "PASTRY_STATION": []
    }
  }
}
```

### 4.3 Cross-Tenant Order Query & Settlement Blocked (`403 TENANT_FORBIDDEN`)

```bash
curl -i -s "$BASE_URL/api/pos/orders?restaurantId=a0000000-0000-4000-8000-000000000001" \
  -H "Authorization: Bearer $OWNER_TOKEN" && echo ""

curl -i -s -X POST "$BASE_URL/api/pos/orders/$ORDER_ID/settle" \
  -H "Authorization: Bearer $OTHER_TENANT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"paymentMethod": "CASH", "tipAmount": 0}' && echo ""
```
**Expected (`403 Forbidden` on both):**

```json
{ "code": "TENANT_FORBIDDEN", "error": "Access denied for target restaurant resource." }
```

### 4.4 Missing Right Blocked (`403 INSUFFICIENT_RIGHTS`)

```bash
curl -i -s -X POST "$BASE_URL/api/pos/orders/$ORDER_ID/settle" \
  -H "Authorization: Bearer $TAKER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"paymentMethod": "CASH", "tipAmount": 0}' && echo ""

curl -i -s "$BASE_URL/api/ledger/restaurant" \
  -H "Authorization: Bearer $TAKER_TOKEN" && echo ""
```
**Expected (`403 Forbidden` on both):**

```json
{ "code": "INSUFFICIENT_RIGHTS", "error": "Missing required right: orders:settle" }
```
```json
{ "code": "INSUFFICIENT_RIGHTS", "error": "Missing required right: ledger:read" }
```

### 4.5 Settle Order as Restaurant 2 Owner (`200 OK`) & Verify Double-Entry Ledger (`200 OK`)

```bash
curl -i -s -X POST "$BASE_URL/api/pos/orders/$ORDER_ID/settle" \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"paymentMethod": "CASH", "tipAmount": 0}' && echo ""

curl -s "$BASE_URL/api/ledger/restaurant" \
  -H "Authorization: Bearer $OWNER_TOKEN" && echo ""
```
**Expected (`200 OK` on settle & ledger):**

```json
{ "success": true, "orderId": "<ORDER_ID>" }
```
```json
{
  "entries": [
    {
      "id": "<UUID>",
      "orderId": "<ORDER_ID>",
      "entityName": "RESTAURANT_a0000000-0000-4000-8000-000000000002",
      "creditAmount": "15.73",
      "debitAmount": "0.00",
      "description": "Net merchant payout after 12.5% platform fee",
      "createdAt": "2026-11-16T..."
    }
  ]
}
```

### 4.6 Duplicate Settlement Blocked by State Pattern (`400 ALREADY_SETTLED`)

```bash
curl -i -s -X POST "$BASE_URL/api/pos/orders/$ORDER_ID/settle" \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"paymentMethod": "CASH", "tipAmount": 0}' && echo ""
```
**Expected (`400 Bad Request`):**

```json
{ "code": "ALREADY_SETTLED", "error": "Order bill has already been settled." }
```

---

## 5. Edge Cases, False-Positive & Security Negative Tests

### 5.1 Prevent Deleting a Role Still Assigned to Active Staff (`409 ROLE_IN_USE`)

```bash
export MANAGER_ROLE_ID=$(curl -s "$BASE_URL/api/pos/roles" \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(d.roles.find(r=>r.name==='MANAGER').id)")

curl -i -s -X DELETE "$BASE_URL/api/pos/roles/$MANAGER_ROLE_ID" \
  -H "Authorization: Bearer $OWNER_TOKEN" && echo ""
```
**Expected (`409 Conflict`):**

```json
{
  "code": "ROLE_IN_USE",
  "error": "Cannot delete role while active staff members are assigned to it."
}
```

### 5.2 Cross-Tenant Menu Item Injection Blocked (`403 TENANT_FORBIDDEN`)

Restaurant 2 (`$OWNER_TOKEN`) attempts to place an order for Restaurant 2 using a `menuItemId` that belongs to Restaurant 1 (`smash360`):

```bash
export REST1_ITEM_ID=$(curl -s "$BASE_URL/api/restaurants/a0000000-0000-4000-8000-000000000001/menu" \
  | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(d.categories[0].items[0].id)")

curl -i -s -X POST "$BASE_URL/api/pos/orders" \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"orderSource\":\"DINE_IN\",\"items\":[{\"menuItemId\":\"$REST1_ITEM_ID\",\"quantity\":1}]}" && echo ""
```
**Expected (`403 Forbidden`):**

```json
{ "code": "TENANT_FORBIDDEN", "error": "Menu item <UUID> does not belong to target restaurant." }
```

### 5.3 Cross-Tenant Catalog Price Update Blocked (`403 TENANT_FORBIDDEN`)

Restaurant 2 (`$OWNER_TOKEN`) attempts to update the price of Restaurant 1's menu item (`$REST1_ITEM_ID`):

```bash
curl -i -s -X PATCH "$BASE_URL/api/restaurants/items/$REST1_ITEM_ID/price" \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"newBasePrice": 1.00, "expectedRowVersion": 1}' && echo ""
```
**Expected (`403 Forbidden`):**

```json
{ "code": "TENANT_FORBIDDEN", "error": "Access denied for target restaurant resource." }
```

### 5.4 Same-Tenant Catalog Price Update (`200 OK`) & Stale `rowVersion` Conflict (`409 CONCURRENCY_CONFLICT`)

```bash
# First update succeeds (rowVersion 1 -> 2)
curl -i -s -X PATCH "$BASE_URL/api/restaurants/items/$MENU_ITEM_ID/price" \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"newBasePrice": 9.49, "expectedRowVersion": 1}' && echo ""

# Re-sending stale expectedRowVersion=1 is rejected
curl -i -s -X PATCH "$BASE_URL/api/restaurants/items/$MENU_ITEM_ID/price" \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"newBasePrice": 9.99, "expectedRowVersion": 1}' && echo ""
```
**Expected (`200 OK` first, then `409 Conflict`):**

```json
{ "success": true, "menuItemId": "<MENU_ITEM_ID>" }
```
```json
{
  "code": "CONCURRENCY_CONFLICT",
  "error": "Menu item was modified by another user or does not exist."
}
```

### 5.5 Forged / Tampered Bearer JWT Rejected (`401 Unauthorized`)

```bash
curl -i -s "$BASE_URL/api/pos/roles" \
  -H "Authorization: Bearer ${OWNER_TOKEN}tampered" && echo ""
```
**Expected (`401 Unauthorized`):**

```json
{ "code": "UNAUTHORIZED", "error": "Authentication required" }
```

### 5.6 Non-Existent Subdomain & SQL/Path Traversal Input (`404 Not Found` / `400 VALIDATION_ERROR`)

```bash
# Unknown subdomain
curl -i -s "$BASE_URL/api/restaurants/by-subdomain/non-existent-tenant" && echo ""

# Invalid subdomain characters at POS login
curl -i -s -X POST "$BASE_URL/api/pos/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"subdomain":"sub.domain!@#","email":"staff1.0002@pos-tenant.co.uk","password":"Password123!"}' && echo ""
```
**Expected (`404 Not Found` first, then `400 Bad Request`):**

```json
{ "code": "NOT_FOUND", "error": "Restaurant not found or suspended" }
```
```json
{
  "code": "VALIDATION_ERROR",
  "error": "Invalid request payload or parameters",
  "issues": [
    { "path": "subdomain", "message": "Subdomain must contain only letters, numbers, and hyphens" }
  ]
}
```
