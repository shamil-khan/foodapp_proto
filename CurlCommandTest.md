# FoodApp — End-to-End API & Domain Verification Runbook (`CUrlTest.md`)

A sequential, copy-pasteable `curl` test suite covering **every Command, Query, Aggregate, and Saga** grouped by **Domain** against `http://localhost:3000`.

---

## Command Coverage Matrix

| Command                 | Triggered By Endpoint / Event                   | Domain                  |
| :---------------------- | :---------------------------------------------- | :---------------------- |
| `LoginPosStaff`         | `POST /api/pos/auth/login`                      | Identity Domain         |
| `UpdateMenuItemPrice`   | `PATCH /api/restaurants/items/:itemId/price`    | Catalog Domain          |
| `PlacePosOrder`         | `POST /api/pos/orders`                          | Ordering Domain         |
| `SettlePosOrder`        | `POST /api/pos/orders/:id/settle`               | Ordering Domain         |
| `RecordOrderSettlement` | `PosOrderSettled` event ➔ `OrderSettlementSaga` | Ledger & Loyalty Domain |
| `RedeemLoyaltyPoints`   | `POST /api/ledger/loyalty/redeem`               | Ledger & Loyalty Domain |

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

### 1. Command: `LoginPosStaff` (`POST /api/pos/auth/login`)

**What happens:** Dispatches `LoginPosStaff` via `InMemoryCommandBus`, verifies the staff password hash, signs a 12-hour HS256 JWT (`pos_staff_token`), and sets an `HttpOnly` cookie while returning the bearer token.

```bash
export POS_TOKEN=\$(curl -s -X POST "\$BASE_URL/api/pos/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"\$STAFF_EMAIL\",\"password\":\"password123\"}" \
  | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).token)")

echo "POS_TOKEN=\$POS_TOKEN"
```

### 2. Query: `GetCurrentActor` (`GET /api/me`)

**What happens:** `initDiScope` verifies the JWT, populates `RequestContext` with `actorSource: 'POS_STAFF'` and `restaurantId`, and executes `GetCurrentActor` through `InMemoryQueryBus`.

```bash
curl -s "\$BASE_URL/api/me" \
  -H "Authorization: Bearer \$POS_TOKEN" && echo ""
```

### 3. Negative Guard Check (`401 Unauthorized`)

**What happens:** `requirePosStaff()` blocks unauthenticated requests before entering any controller.

```bash
curl -i -s "\$BASE_URL/api/pos/orders" && echo ""
```

---

## Catalog Domain (`src/contexts/catalog`)

### 1. Query: `GetRestaurants` (`GET /api/restaurants`)

**What happens:** Executes `GetRestaurants` via `QueryBus`, filtering active restaurants (`isActiveOverride = true`) by optional UK `postcodeSector` prefix and batch-hydrating `RestaurantLayout` branding metadata.

```bash
# List all active restaurants
curl -s "\$BASE_URL/api/restaurants" | head -c 500 && echo ""

# Filter by UK postcode sector
curl -s "\$BASE_URL/api/restaurants?postcodeSector=SW1" && echo ""
```

### 2. Query: `GetRestaurantMenuSnapshot` (`GET /api/restaurants/:restaurantId/menu`)

**What happens:** Executes `GetRestaurantMenuSnapshot` using a 3-tier read-through cache (**Redis `menu:snapshot:<id>` ➔ PostgreSQL `MenuSnapshot` JSONB ➔ `MenuSnapshotBuilder` SQL rebuild**).

```bash
curl -s "\(BASE_URL/api/restaurants/\)RESTAURANT_ID/menu" | head -c 500 && echo ""
```

### 3. Command: `UpdateMenuItemPrice` (`PATCH /api/restaurants/items/:itemId/price`)

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

## Ordering Domain & Saga (`src/contexts/ordering`)

### 1. Command: `PlacePosOrder` (`POST /api/pos/orders`)

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

### 2. Query: `GetRestaurantOrders` (`GET /api/pos/orders`)

**What happens:** Executes `GetRestaurantOrders` via `QueryBus` scoped to the logged-in staff's `restaurantId`, attaching the latest milestone from `"OrderMilestoneLog"`.

```bash
curl -s "\$BASE_URL/api/pos/orders" \
  -H "Authorization: Bearer \$POS_TOKEN" && echo ""
```

### 3. Command: `SettlePosOrder` + `OrderSettlementSaga` (`POST /api/pos/orders/:id/settle`)

**What happens:**

1. Rehydrates `OrderAggregate` from `"DomainEventStore"`, transitions state (`PLACED -> SETTLED`), and raises `PosOrderSettled`.
2. **`OrderSettlementSaga`** intercepts `PosOrderSettled`, creates a `RUNNING` saga record in `"_Saga_State"`, dispatches **`RecordOrderSettlement`**, and advances `"_Saga_State"` to `COMPLETED`.
3. `FinancialLedgerAggregate` enforces `totalDebits === totalCredits` and persists balanced double-entry rows into `"FinancialLedger"`.

```bash
curl -s -X POST "\(BASE_URL/api/pos/orders/\)ORDER_ID/settle" \
  -H "Authorization: Bearer \$POS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"paymentMethod": "CARD_TERMINAL", "tipAmount": 2.50}' && echo ""
```

### 4. Verify `OrderSettlementSaga` State & Event Stream (SQL Audit)

**What happens:** Confirms `"_Saga_State"` recorded `RECORD_FINANCIAL_LEDGER -> COMPLETED` with the generated `ledgerId` and zero errors.

```bash
podman exec -it foodapp-pg psql -U postgres -d food_app -c "
SELECT \"id\", \"sagaType\", \"correlationId\", \"currentStep\", \"status\", \"statePayload\", \"lastError\"
FROM \"_Saga_State\"
WHERE \"correlationId\" = '\$ORDER_ID';

SELECT \"version\", \"eventType\", \"occurredAt\"
FROM \"DomainEventStore\"
WHERE \"aggregateId\" = '\$ORDER_ID'
ORDER BY \"version\" ASC;"
```

### 5. Duplicate Settlement Guard (`400 Bad Request`)

**What happens:** Re-settling a `SETTLED` order hits `SettledState.canSettle()` and returns `ALREADY_SETTLED` (`400`).

```bash
curl -i -s -X POST "\(BASE_URL/api/pos/orders/\)ORDER_ID/settle" \
  -H "Authorization: Bearer \$POS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"paymentMethod": "CASH", "tipAmount": 0}' && echo ""
```

---

## Ledger & Loyalty Domain (`src/contexts/ledger`)

### 1. Query: `GetRestaurantLedger` (`GET /api/ledger/restaurant`)

**What happens:** Executes `GetRestaurantLedger` (restricted to `OWNER` and `ADMIN` tenant roles) to inspect net merchant payouts recorded by `FinancialLedgerAggregate`.

```bash
curl -s "\$BASE_URL/api/ledger/restaurant" \
  -H "Authorization: Bearer \$POS_TOKEN" && echo ""
```

### 2. Audit Double-Entry Accounting Balance (`FinancialLedger` SQL Check)

**What happens:** Verifies that `GATEWAY_CLEARING` debit equals the sum of `RESTAURANT_<id>`, `PLATFORM_REVENUE`, and `HMRC_VAT_<id>` credits.

```bash
podman exec -it foodapp-pg psql -U postgres -d food_app -c "
SELECT "entityName", "debitAmount", "creditAmount", "description"
FROM "FinancialLedger"
WHERE "orderId" = '$ORDER_ID';"
```

### 3. End-to-End Customer Loyalty Flow (`LoyaltyPointsEligible` ➔ `RedeemLoyaltyPoints`)

**What happens:**

1. Registers a customer via Better Auth (`POST /api/auth/sign-up/email`) and stores their session cookie in `/tmp/customer_cookies.txt`.
2. Places and settles a POS order linked to `customerId`, which raises `LoyaltyPointsEligible` and triggers `LoyaltyPointsEventHandler` to credit `EARNED` points (`floor(subtotal * 10)`).
3. Queries `GetUserLoyaltyBalance` (`GET /api/ledger/loyalty/me`) and dispatches **`RedeemLoyaltyPoints`** (`POST /api/ledger/loyalty/redeem`).

```bash
# Step A: Sign up a customer via Better Auth and store session cookie
export CUSTOMER_EMAIL="customer.\$(date +%s)@example.co.uk"
export CUSTOMER_ID=\$(curl -s -c /tmp/customer_cookies.txt -X POST "\$BASE_URL/api/auth/sign-up/email" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"\$CUSTOMER_EMAIL\",\"password\":\"CustomerPass123!\",\"name\":\"Alice Smith\"}" \
  | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).user.id)")

echo "CUSTOMER_ID=\$CUSTOMER_ID"

# Step B: Place & settle an order for this customer to earn loyalty points
export LOYALTY_ORDER_ID=\$(curl -s -X POST "\$BASE_URL/api/pos/orders" \
  -H "Authorization: Bearer \$POS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"orderSource\": \"DINE_IN\",
    \"customerId\": \"\$CUSTOMER_ID\",
    \"items\": [{\"menuItemId\": \"\$MENU_ITEM_ID\", \"quantity\": 2}]
  }" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).orderId)")

curl -s -X POST "\(BASE_URL/api/pos/orders/\)LOYALTY_ORDER_ID/settle" \
  -H "Authorization: Bearer \$POS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"paymentMethod": "CARD_TERMINAL", "tipAmount": 0}' && echo ""

# Step C: Query earned loyalty points (Query: GetUserLoyaltyBalance)
curl -s -b /tmp/customer_cookies.txt "\$BASE_URL/api/ledger/loyalty/me" && echo ""

# Step D: Redeem 50 points (Command: RedeemLoyaltyPoints)
curl -s -b /tmp/customer_cookies.txt -X POST "\$BASE_URL/api/ledger/loyalty/redeem" \
  -H "Content-Type: application/json" \
  -d "{\"restaurantId\":\"\(RESTAURANT_ID\",\"orderId\":\"\)LOYALTY_ORDER_ID\",\"pointsToRedeem\":50}" && echo ""

# Step E: Verify updated balance & insufficient-points guard (400 Bad Request)
curl -s -b /tmp/customer_cookies.txt "\$BASE_URL/api/ledger/loyalty/me" && echo ""
curl -i -s -b /tmp/customer_cookies.txt -X POST "\$BASE_URL/api/ledger/loyalty/redeem" \
  -H "Content-Type: application/json" \
  -d '{"pointsToRedeem": 999999}' && echo ""
```

---

## Cleanup: POS Shift Logout

### `POST /api/pos/auth/logout`

**What happens:** Clears the `pos_staff_token` `HttpOnly` cookie on the client.

```bash
curl -i -s -X POST "\$BASE_URL/api/pos/auth/logout" \
  -H "Authorization: Bearer \$POS_TOKEN" && echo ""
```
