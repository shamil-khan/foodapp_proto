# FoodApp — End-to-End API & Domain Verification Runbook (`CUrlTest.md`)

A sequential, copy-pasteable `curl` test suite to verify every bounded context, CQRS handler, event-sourced aggregate, saga, and double-entry accounting rule against your local server (`http://localhost:3000`).

---

## 0. Prerequisites & Environment Setup

1. Ensure PostgreSQL 18 (`foodapp-pg`), Redis 8 (`foodapp-redis`), and the Hono backend (`pn dev`) are running.
2. Fetch a seeded restaurant, staff member, menu item, and modifier from PostgreSQL and export them as shell variables:

```bash
podman exec -it foodapp-pg psql -U postgres -d food_app -c '
SELECT r."id" AS restaurant_id,
       s."email" AS staff_email,
       m."id" AS menu_item_id,
       m."rowVersion" AS item_version,
       im."id" AS modifier_id
FROM "Restaurant" r
JOIN "RestaurantStaff" s ON s."restaurantId" = r."id"
JOIN "Category" c ON c."restaurantId" = r."id"
JOIN "MenuItem" m ON m."categoryId" = c."id"
LEFT JOIN "ItemModifier" im ON im."menuItemId" = m."id"
LIMIT 1;'
```

Export the returned IDs into your current terminal session:

```bash
export BASE_URL="http://localhost:3000"
export RESTAURANT_ID="a0000000-0000-0000-0000-000000000001"
export STAFF_EMAIL="staff1.0001@pos-tenant.co.uk"
export MENU_ITEM_ID="<paste-menu_item_id>"
export MODIFIER_ID="<paste-modifier_id>"
```

---

## 1. Health & Observability Check

### `GET /api/health`

**What happens:** Assigns a correlation `X-Request-Id`, binds LogTape's `AsyncLocalStorage` context, opens a request-scoped `@inferdi/hono` container (`c.var.di`), and logs chronological `<--` and `-->` lines to `apps/backend/logs/dev_YYYY-MM-DD.log`.

```bash
curl -i -s "\$BASE_URL/api/health" && echo ""
```

---

## 2. Identity Context (POS Staff Authentication & Actor Resolution)

### Step 2.1: POS Staff Shift Login (`POST /api/pos/auth/login`)

**What happens:** Dispatches `LoginPosStaff` through `InMemoryCommandBus`, verifies the staff member's password hash, issues a 12-hour HS256 JWT (`pos_staff_token`), and sets an `HttpOnly` cookie while also returning the bearer token.

```bash
export POS_TOKEN=\$(curl -s -X POST "\$BASE_URL/api/pos/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"\$STAFF_EMAIL\",\"password\":\"password123\"}" \
  | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).token)")

echo "POS_TOKEN=\$POS_TOKEN"
```

### Step 2.2: Verify Active Actor (`GET /api/me`)

**What happens:** `initDiScope` verifies the bearer JWT, hydrates `RequestContext` with `actorSource: 'POS_STAFF'` and `restaurantId`, and executes `GetCurrentActor` via `InMemoryQueryBus`.

```bash
curl -s "\$BASE_URL/api/me" \
  -H "Authorization: Bearer \$POS_TOKEN" && echo ""
```

### Step 2.3: Negative Auth Guard Check (`401 Unauthorized`)

**What happens:** `requirePosStaff()` rejects unauthenticated access to protected POS order routes before hitting any controller.

```bash
curl -i -s "\$BASE_URL/api/pos/orders" && echo ""
```

---

## 3. Catalog Context (Storefront Directory, 3-Tier Cache & Optimistic Locking)

### Step 3.1: Storefront Restaurant Directory (`GET /api/restaurants`)

**What happens:** Executes `GetRestaurants` via `QueryBus`, querying active restaurants (`isActiveOverride = true`) with optional UK `postcodeSector` prefix filtering and batch-hydrating `RestaurantLayout` theme metadata.

```bash
# List all active restaurants
curl -s "\$BASE_URL/api/restaurants" | head -c 500 && echo ""

# Filter by UK postcode sector
curl -s "\$BASE_URL/api/restaurants?postcodeSector=SW1" && echo ""
```

### Step 3.2: Read Compiled Menu Snapshot (`GET /api/restaurants/:restaurantId/menu`)

**What happens:** Executes `GetRestaurantMenuSnapshot` using a 3-tier read-through cache (**Redis `menu:snapshot:<id>` ➔ PostgreSQL `MenuSnapshot` JSONB ➔ `MenuSnapshotBuilder` SQL rebuild**).

```bash
curl -s "\(BASE_URL/api/restaurants/\)RESTAURANT_ID/menu" | head -c 500 && echo ""
```

### Step 3.3: Update Menu Item Price (`PATCH /api/restaurants/items/:itemId/price`)

**What happens:** Dispatches `UpdateMenuItemPrice` with optimistic concurrency (`expectedRowVersion`). Updates `MenuItem`, increments `rowVersion`, publishes `RestaurantMenuUpdated`, and triggers `MenuCacheInvalidationHandler` to rebuild both the JSONB snapshot and Redis cache.

```bash
curl -s -X PATCH "\(BASE_URL/api/restaurants/items/\)MENU_ITEM_ID/price" \
  -H "Authorization: Bearer \$POS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"newBasePrice": 14.50, "expectedRowVersion": 1}' && echo ""
```

### Step 3.4: Optimistic Concurrency Conflict Check (`409 Conflict`)

**What happens:** Re-sending the stale `expectedRowVersion: 1` fails the `WHERE "rowVersion" = 1` check and returns a typed `CONCURRENCY_CONFLICT` (`409`) domain error.

```bash
curl -i -s -X PATCH "\(BASE_URL/api/restaurants/items/\)MENU_ITEM_ID/price" \
  -H "Authorization: Bearer \$POS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"newBasePrice": 15.00, "expectedRowVersion": 1}' && echo ""
```

---

## 4. Ordering Context (Event-Sourced Aggregate, KDS Visitor & Projections)

### Step 4.1: Place POS Order (`POST /api/pos/orders`)

**What happens:**

1. `PlacePosOrderHandler` loads live menu prices, VAT rates, and modifiers.
2. `OrderAggregate.place()` raises `PosOrderPlaced` and `KitchenTicketRequested`.
3. `OrderRepository.save()` atomically appends events to `"DomainEventStore"` and projects read rows into `"Order"`, `"OrderLineItem"`, `"OrderLineModifier"`, and `"OrderMilestoneLog"`.
4. `KdsTicketVisitor` partitions order items by station (`KITCHEN_SCREEN`, `BAR_PRINTER`, `PASTRY_STATION`) in the HTTP response.

```bash
export ORDER_ID=\$(curl -s -X POST "\$BASE_URL/api/pos/orders" \
  -H "Authorization: Bearer \$POS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"orderSource\": \"DINE_IN\",
    \"items\": [
      {
        \"menuItemId\": \"\$MENU_ITEM_ID\",
        \"quantity\": 2,
        \"modifierIds\": [\"\$MODIFIER_ID\"]
      }
    ]
  }" | node -e "const r = JSON.parse(require('fs').readFileSync(0,'utf8')); console.error(JSON.stringify(r, null, 2)); console.log(r.orderId)")

echo "ORDER_ID=\$ORDER_ID"
```

### Step 4.2: List Active Restaurant Orders (`GET /api/pos/orders`)

**What happens:** Executes `GetRestaurantOrders` via `QueryBus` using `request.restaurantId` extracted from the POS staff JWT, joining each order's latest milestone from `"OrderMilestoneLog"`.

```bash
curl -s "\$BASE_URL/api/pos/orders" \
  -H "Authorization: Bearer \$POS_TOKEN" && echo ""
```

---

## 5. Saga & Ledger Contexts (Bill Settlement & Double-Entry Accounting)

### Step 5.1: Settle POS Order Bill (`POST /api/pos/orders/:id/settle`)

**What happens:**

1. `OrderRepository.findById()` rehydrates `OrderAggregate` from `"DomainEventStore"`.
2. `OrderAggregate.settleBill()` validates the GoF State transition (`PLACED -> SETTLED`) and raises `PosOrderSettled`.
3. `OrderSettlementSaga` catches `PosOrderSettled`, records progress in `"_Saga_State"`, and invokes `RecordOrderSettlementHandler`.
4. `FinancialLedgerAggregate` enforces `totalDebits === totalCredits` and writes balanced double-entry rows into `"FinancialLedger"`.

```bash
curl -s -X POST "\(BASE_URL/api/pos/orders/\)ORDER_ID/settle" \
  -H "Authorization: Bearer \$POS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"paymentMethod": "CARD_TERMINAL", "tipAmount": 2.50}' && echo ""
```

### Step 5.2: Duplicate Settlement Guard (`400 Bad Request`)

**What happens:** Attempting to settle an already `SETTLED` order hits `SettledState.canSettle()` and returns `ALREADY_SETTLED` (`400`).

```bash
curl -i -s -X POST "\(BASE_URL/api/pos/orders/\)ORDER_ID/settle" \
  -H "Authorization: Bearer \$POS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"paymentMethod": "CASH", "tipAmount": 0}' && echo ""
```

### Step 5.3: Query Restaurant Ledger (`GET /api/ledger/restaurant`)

**What happens:** Executes `GetRestaurantLedger` (restricted to `OWNER` and `ADMIN` tenant roles) to view net merchant payouts for the restaurant.

```bash
curl -s "\$BASE_URL/api/ledger/restaurant" \
  -H "Authorization: Bearer \$POS_TOKEN" && echo ""
```

### Step 5.4: SQL Audit of Event Store, Saga & Double-Entry Balance

**What happens:** Directly verifies in PostgreSQL that `SUM(debitAmount) === SUM(creditAmount)` for the settled order and that the saga reached `COMPLETED`.

```bash
podman exec -it foodapp-pg psql -U postgres -d food_app -c "
SELECT \"entityName\", \"debitAmount\", \"creditAmount\", \"description\"
FROM \"FinancialLedger\"
WHERE \"orderId\" = '\$ORDER_ID';

SELECT \"sagaType\", \"currentStep\", \"status\"
FROM \"_Saga_State\"
WHERE \"correlationId\" = '\$ORDER_ID';

SELECT \"version\", \"eventType\", \"occurredAt\"
FROM \"DomainEventStore\"
WHERE \"aggregateId\" = '\$ORDER_ID'
ORDER BY \"version\" ASC;"
```

---

## 6. POS Shift Logout

### `POST /api/pos/auth/logout`

**What happens:** Clears the `pos_staff_token` `HttpOnly` cookie on the client.

```bash
curl -i -s -X POST "\$BASE_URL/api/pos/auth/logout" \
  -H "Authorization: Bearer \$POS_TOKEN" && echo ""
```

# FoodApp — End-to-End API & Domain Verification Runbook (`CUrlTest.md`)

A sequential, copy-pasteable `curl` test suite grouped by **Domain** to verify CQRS handlers, event-sourced aggregates, sagas, and double-entry accounting rules against `http://localhost:3000`.

---

## Prerequisites & Seeded Variables

1. Ensure PostgreSQL 18 (`foodapp-pg`), Redis 8 (`foodapp-redis`), and the backend (`pn dev`) are running.
2. Fetch a seeded restaurant, staff member, menu item, and modifier from PostgreSQL:

```bash
podman exec -it foodapp-pg psql -U postgres -d food_app -c '
SELECT r."id" AS restaurant_id,
       s."email" AS staff_email,
       m."id" AS menu_item_id,
       m."rowVersion" AS item_version,
       im."id" AS modifier_id
FROM "Restaurant" r
JOIN "RestaurantStaff" s ON s."restaurantId" = r."id"
JOIN "Category" c ON c."restaurantId" = r."id"
JOIN "MenuItem" m ON m."categoryId" = c."id"
LEFT JOIN "ItemModifier" im ON im."menuItemId" = m."id"
LIMIT 1;'
```

Export the returned IDs into your terminal session:

```bash
export BASE_URL="http://localhost:3000"
export RESTAURANT_ID="a0000000-0000-0000-0000-000000000001"
export STAFF_EMAIL="staff1.0001@pos-tenant.co.uk"
export MENU_ITEM_ID="<paste-menu_item_id>"
export MODIFIER_ID="<paste-modifier_id>"
```

---

## Platform & Health

### `GET /api/health`

**What happens:** Assigns `X-Request-Id`, binds LogTape's `AsyncLocalStorage` context, hydrates a request-scoped `@inferdi/hono` container (`c.var.di`), and writes chronological `<--` and `-->` lines to `apps/backend/logs/dev_YYYY-MM-DD.log`.

```bash
curl -i -s "\$BASE_URL/api/health" && echo ""
```

---

## Identity Domain (`src/contexts/identity`)

### 1. POS Staff Shift Login (`POST /api/pos/auth/login`)

**What happens:** Dispatches `LoginPosStaff` via `InMemoryCommandBus`, verifies the staff password hash, signs a 12-hour HS256 JWT (`pos_staff_token`), and sets an `HttpOnly` cookie while returning the bearer token.

```bash
export POS_TOKEN=\$(curl -s -X POST "\$BASE_URL/api/pos/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"\$STAFF_EMAIL\",\"password\":\"password123\"}" \
  | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).token)")

echo "POS_TOKEN=\$POS_TOKEN"
```

### 2. Inspect Active Actor (`GET /api/me`)

**What happens:** `initDiScope` verifies the JWT, populates `RequestContext` with `actorSource: 'POS_STAFF'` and `restaurantId`, and executes `GetCurrentActor` through `InMemoryQueryBus`.

```bash
curl -s "\$BASE_URL/api/me" \
  -H "Authorization: Bearer \$POS_TOKEN" && echo ""
```

### 3. Unauthorized Guard Check (`401 Unauthorized`)

**What happens:** `requirePosStaff()` blocks unauthenticated requests before entering any controller.

```bash
curl -i -s "\$BASE_URL/api/pos/orders" && echo ""
```

### 4. POS Shift Logout (`POST /api/pos/auth/logout`)

**What happens:** Clears the `pos_staff_token` cookie on the client. _(Run this at the very end after testing Ordering and Ledger)._

```bash
curl -i -s -X POST "\$BASE_URL/api/pos/auth/logout" \
  -H "Authorization: Bearer \$POS_TOKEN" && echo ""
```

---

## Catalog Domain (`src/contexts/catalog`)

### 1. Storefront Restaurant Directory (`GET /api/restaurants`)

**What happens:** Executes `GetRestaurants` via `QueryBus`, filtering active restaurants (`isActiveOverride = true`) by optional UK `postcodeSector` prefix and batch-hydrating `RestaurantLayout` branding metadata.

```bash
# List all active restaurants
curl -s "\$BASE_URL/api/restaurants" | head -c 500 && echo ""

# Filter by UK postcode sector
curl -s "\$BASE_URL/api/restaurants?postcodeSector=SW1" && echo ""
```

### 2. Read Compiled Menu Snapshot (`GET /api/restaurants/:restaurantId/menu`)

**What happens:** Executes `GetRestaurantMenuSnapshot` using a 3-tier read-through cache (**Redis `menu:snapshot:<id>` ➔ PostgreSQL `MenuSnapshot` JSONB ➔ `MenuSnapshotBuilder` SQL rebuild**).

```bash
curl -s "\(BASE_URL/api/restaurants/\)RESTAURANT_ID/menu" | head -c 500 && echo ""
```

### 3. Update Menu Item Price (`PATCH /api/restaurants/items/:itemId/price`)

**What happens:** Dispatches `UpdateMenuItemPrice` with optimistic locking (`expectedRowVersion`). Updates `"MenuItem"`, bumps `rowVersion`, publishes `RestaurantMenuUpdated`, and triggers `MenuCacheInvalidationHandler` to refresh both JSONB and Redis snapshots.

```bash
curl -s -X PATCH "\(BASE_URL/api/restaurants/items/\)MENU_ITEM_ID/price" \
  -H "Authorization: Bearer \$POS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"newBasePrice": 14.50, "expectedRowVersion": 1}' && echo ""
```

### 4. Optimistic Concurrency Conflict (`409 Conflict`)

**What happens:** Re-sending stale `expectedRowVersion: 1` fails the `WHERE "rowVersion" = 1` check and returns `CONCURRENCY_CONFLICT` (`409`).

```bash
curl -i -s -X PATCH "\(BASE_URL/api/restaurants/items/\)MENU_ITEM_ID/price" \
  -H "Authorization: Bearer \$POS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"newBasePrice": 15.00, "expectedRowVersion": 1}' && echo ""
```

---

## Ordering Domain (`src/contexts/ordering`)

### 1. Place POS Order (`POST /api/pos/orders`)

**What happens:**

1. `PlacePosOrderHandler` resolves live item prices, VAT rates, and modifiers.
2. `OrderAggregate.place()` raises `PosOrderPlaced` and `KitchenTicketRequested`.
3. `OrderRepository.save()` appends events to `"DomainEventStore"` and projects read rows into `"Order"`, `"OrderLineItem"`, `"OrderLineModifier"`, and `"OrderMilestoneLog"`.
4. `KdsTicketVisitor` partitions items by station (`KITCHEN_SCREEN`, `BAR_PRINTER`, `PASTRY_STATION`).

```bash
export ORDER_ID=\$(curl -s -X POST "\$BASE_URL/api/pos/orders" \
  -H "Authorization: Bearer \$POS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"orderSource\": \"DINE_IN\",
    \"items\": [
      {
        \"menuItemId\": \"\$MENU_ITEM_ID\",
        \"quantity\": 2,
        \"modifierIds\": [\"\$MODIFIER_ID\"]
      }
    ]
  }" | node -e "const r = JSON.parse(require('fs').readFileSync(0,'utf8')); console.error(JSON.stringify(r, null, 2)); console.log(r.orderId)")

echo "ORDER_ID=\$ORDER_ID"
```

### 2. List Restaurant Orders (`GET /api/pos/orders`)

**What happens:** Executes `GetRestaurantOrders` via `QueryBus` scoped to the logged-in staff's `restaurantId`, attaching the latest milestone from `"OrderMilestoneLog"`.

```bash
curl -s "\$BASE_URL/api/pos/orders" \
  -H "Authorization: Bearer \$POS_TOKEN" && echo ""
```

### 3. Settle Order Bill (`POST /api/pos/orders/:id/settle`)

**What happens:** Rehydrates `OrderAggregate` from `"DomainEventStore"`, transitions state (`PLACED -> SETTLED`), raises `PosOrderSettled`, and triggers `OrderSettlementSaga` to record double-entry ledger lines.

```bash
curl -s -X POST "\(BASE_URL/api/pos/orders/\)ORDER_ID/settle" \
  -H "Authorization: Bearer \$POS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"paymentMethod": "CARD_TERMINAL", "tipAmount": 2.50}' && echo ""
```

### 4. Duplicate Settlement Guard (`400 Bad Request`)

**What happens:** Re-settling a `SETTLED` order hits `SettledState.canSettle()` and returns `ALREADY_SETTLED` (`400`).

```bash
curl -i -s -X POST "\(BASE_URL/api/pos/orders/\)ORDER_ID/settle" \
  -H "Authorization: Bearer \$POS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"paymentMethod": "CASH", "tipAmount": 0}' && echo ""
```

---

## Ledger & Loyalty Domain (`src/contexts/ledger`)

### 1. Query Restaurant Financial Ledger (`GET /api/ledger/restaurant`)

**What happens:** Executes `GetRestaurantLedger` (restricted to `OWNER` and `ADMIN` tenant roles) to inspect net merchant payouts recorded by `FinancialLedgerAggregate`.

```bash
curl -s "\$BASE_URL/api/ledger/restaurant" \
  -H "Authorization: Bearer \$POS_TOKEN" && echo ""
```

### 2. SQL Audit of Double-Entry Balance, Saga & Event Store

**What happens:** Directly verifies in PostgreSQL that `SUM(debitAmount) === SUM(creditAmount)` in `"FinancialLedger"`, `"_Saga_State"` reached `COMPLETED`, and `"DomainEventStore"` holds the immutable event stream.

```bash
podman exec -it foodapp-pg psql -U postgres -d food_app -c "
SELECT \"entityName\", \"debitAmount\", \"creditAmount\", \"description\"
FROM \"FinancialLedger\"
WHERE \"orderId\" = '\$ORDER_ID';

SELECT \"sagaType\", \"currentStep\", \"status\"
FROM \"_Saga_State\"
WHERE \"correlationId\" = '\$ORDER_ID';

SELECT \"version\", \"eventType\", \"occurredAt\"
FROM \"DomainEventStore\"
WHERE \"aggregateId\" = '\$ORDER_ID'
ORDER BY \"version\" ASC;"
```
