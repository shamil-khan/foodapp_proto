CREATE FUNCTION pg_temp.seed_actor() RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT '00000000-0000-4000-85ee-000000000001'::UUID;
$$;


-- 1. SEED 5 GLOBAL ADMINS
INSERT INTO
  "User" (
    "email",
    "name",
    "emailVerified",
    "role",
    "createdBy",
    "updatedBy"
  )
SELECT
  'admin' || i || '@ukfoodpos.co.uk',
  'UK Platform Admin ' || i,
  TRUE,
  'PLATFORM_ADMIN',
  pg_temp.seed_actor()::UUID,
  pg_temp.seed_actor()::UUID
FROM
  generate_series(1, 5) AS i
ON CONFLICT ("email") DO NOTHING;


-- 2. SEED 10 GLOBAL CUSTOMERS
INSERT INTO
  "User" (
    "id",
    "email",
    "name",
    "emailVerified",
    "role",
    "createdBy",
    "updatedBy"
  )
VALUES
  (
    '11111111-1111-4111-8111-111111111111',
    'customer1@ukmail.co.uk',
    'Oliver Twist',
    TRUE,
    'CUSTOMER',
    pg_temp.seed_actor(),
    pg_temp.seed_actor()
  )
ON CONFLICT ("email") DO NOTHING;


INSERT INTO
  "User" (
    "email",
    "name",
    "emailVerified",
    "role",
    "createdBy",
    "updatedBy"
  )
SELECT
  'customer' || i || '@ukmail.co.uk',
  'UK Customer ' || i,
  TRUE,
  'CUSTOMER',
  pg_temp.seed_actor()::UUID,
  pg_temp.seed_actor()::UUID
FROM
  generate_series(2, 10) AS i
ON CONFLICT ("email") DO NOTHING;


-- 3. SEED 10 GLOBAL DRIVERS (Inactive for Showcase)
INSERT INTO
  "User" (
    "id",
    "email",
    "name",
    "emailVerified",
    "role",
    "createdBy",
    "updatedBy"
  )
VALUES
  (
    '22222222-2222-4222-8222-222222222222',
    'rider1@ukfleet.co.uk',
    'Harry Potter Rider',
    TRUE,
    'DRIVER',
    pg_temp.seed_actor(),
    pg_temp.seed_actor()
  )
ON CONFLICT ("email") DO NOTHING;


INSERT INTO
  "DriverProfile" (
    "id",
    "userId",
    "licenseNo",
    "vehicleType",
    "isAvailable",
    "activePostcodeSectors",
    "createdBy",
    "updatedBy"
  )
VALUES
  (
    '33333333-3333-4333-8333-333333333333',
    '22222222-2222-4222-8222-222222222222',
    'UK-DVLA-001',
    'Electric Moped',
    FALSE,
    ARRAY['E1', 'SW1A'],
    pg_temp.seed_actor(),
    pg_temp.seed_actor()
  )
ON CONFLICT ("userId") DO NOTHING;


INSERT INTO
  "User" (
    "email",
    "name",
    "emailVerified",
    "role",
    "createdBy",
    "updatedBy"
  )
SELECT
  'rider' || i || '@ukfleet.co.uk',
  'Showcase Rider ' || i,
  TRUE,
  'DRIVER',
  pg_temp.seed_actor()::UUID,
  pg_temp.seed_actor()::UUID
FROM
  generate_series(2, 10) AS i
ON CONFLICT ("email") DO NOTHING;


-- 4. SEED 10 UK RESTAURANTS WITH UNIQUE SUBDOMAINS (*.fapp.com)
INSERT INTO
  "Restaurant" (
    "id",
    "name",
    "subdomain",
    "vatNumber",
    "companyHouseNumber",
    "foodHygieneRating",
    "postcodeSector",
    "averagePrepTimeMinutes",
    "payoutFrequency",
    "platformFeeRate",
    "createdBy",
    "updatedBy"
  )
VALUES
  (
    'a0000000-0000-4000-8000-000000000001',
    'Smash 360 London',
    'smash360',
    'GB100012345',
    '08005432',
    5,
    'E1',
    11,
    'WEEKLY',
    12.50,
    pg_temp.seed_actor(),
    pg_temp.seed_actor()
  ),
  (
    'a0000000-0000-4000-8000-000000000002',
    'Westminster Patty Co',
    'westminster-patty',
    'GB100024690',
    '08010864',
    5,
    'SW1A',
    12,
    'DAILY',
    12.50,
    pg_temp.seed_actor(),
    pg_temp.seed_actor()
  ),
  (
    'a0000000-0000-4000-8000-000000000003',
    'Manchester Smash',
    'manchester-smash',
    'GB100037035',
    '08016296',
    5,
    'M1',
    13,
    'WEEKLY',
    12.50,
    pg_temp.seed_actor(),
    pg_temp.seed_actor()
  ),
  (
    'a0000000-0000-4000-8000-000000000004',
    'Brum Burger Lab',
    'brum-burger',
    'GB100049380',
    '08021728',
    5,
    'B1',
    14,
    'DAILY',
    12.50,
    pg_temp.seed_actor(),
    pg_temp.seed_actor()
  ),
  (
    'a0000000-0000-4000-8000-000000000005',
    'Leeds Grill 360',
    'leeds-grill',
    'GB100061725',
    '08027160',
    5,
    'LS1',
    15,
    'WEEKLY',
    12.50,
    pg_temp.seed_actor(),
    pg_temp.seed_actor()
  ),
  (
    'a0000000-0000-4000-8000-000000000006',
    'Glasgow Melt',
    'glasgow-melt',
    'GB100074070',
    '08032592',
    5,
    'G1',
    16,
    'DAILY',
    12.50,
    pg_temp.seed_actor(),
    pg_temp.seed_actor()
  ),
  (
    'a0000000-0000-4000-8000-000000000007',
    'Edinburgh Stack',
    'edinburgh-stack',
    'GB100086415',
    '08038024',
    5,
    'EH1',
    17,
    'WEEKLY',
    12.50,
    pg_temp.seed_actor(),
    pg_temp.seed_actor()
  ),
  (
    'a0000000-0000-4000-8000-000000000008',
    'Cardiff Brioche',
    'cardiff-brioche',
    'GB100098760',
    '08043456',
    5,
    'CF10',
    10,
    'DAILY',
    12.50,
    pg_temp.seed_actor(),
    pg_temp.seed_actor()
  ),
  (
    'a0000000-0000-4000-8000-000000000009',
    'Bristol Bun House',
    'bristol-bun',
    'GB100111105',
    '08048888',
    5,
    'BS1',
    11,
    'WEEKLY',
    12.50,
    pg_temp.seed_actor(),
    pg_temp.seed_actor()
  ),
  (
    'a0000000-0000-4000-8000-000000000010',
    'Liverpool Smash',
    'liverpool-smash',
    'GB100123450',
    '08054320',
    5,
    'L1',
    12,
    'DAILY',
    12.50,
    pg_temp.seed_actor(),
    pg_temp.seed_actor()
  )
ON CONFLICT ("id") DO NOTHING;


-- 5. SEED LAYOUTS & PAYMENT CONFIGS FOR ALL 10 RESTAURANTS
INSERT INTO
  "RestaurantLayout" (
    "restaurantId",
    "templateId",
    "primaryColor",
    "createdBy",
    "updatedBy"
  )
SELECT
  "id",
  'uk_pos_modern_v1',
  '#1E293B',
  pg_temp.seed_actor()::UUID,
  pg_temp.seed_actor()::UUID
FROM
  "Restaurant"
ON CONFLICT ("restaurantId") DO NOTHING;


INSERT INTO
  "PaymentConfig" (
    "restaurantId",
    "routingPolicy",
    "merchantToken",
    "createdBy",
    "updatedBy"
  )
SELECT
  "id",
  'INSTANT_SPLIT',
  'acct_uk_stripe_' || right("id"::TEXT, 4),
  pg_temp.seed_actor()::UUID,
  pg_temp.seed_actor()::UUID
FROM
  "Restaurant"
ON CONFLICT ("restaurantId") DO NOTHING;


-- 5B. SEED DEFAULT STAFF ROLES & RIGHTS FOR ALL 10 RESTAURANTS
INSERT INTO
  "StaffRole" (
    "restaurantId",
    "name",
    "description",
    "isSystemRole",
    "createdBy",
    "updatedBy"
  )
SELECT
  r."id",
  role_def.role_name,
  role_def.role_desc,
  role_def.is_sys,
  pg_temp.seed_actor()::UUID,
  pg_temp.seed_actor()::UUID
FROM
  "Restaurant" r
  CROSS JOIN (
    VALUES
      (
        'OWNER',
        'Full restaurant ownership, ledger, staff & role administration',
        TRUE
      ),
      (
        'ADMIN',
        'Restaurant administrator with full operational and role rights',
        FALSE
      ),
      (
        'MANAGER',
        'Floor manager with catalog pricing, ordering, and settlement rights',
        FALSE
      ),
      (
        'ORDER_TAKER',
        'Front-of-house POS cashier with order placement and viewing rights',
        FALSE
      )
  ) AS role_def (role_name, role_desc, is_sys)
ON CONFLICT DO NOTHING;


INSERT INTO
  "StaffRolePermission" (
    "staffRoleId",
    "permission",
    "createdBy",
    "updatedBy"
  )
SELECT
  sr."id",
  perm_def.permission,
  pg_temp.seed_actor()::UUID,
  pg_temp.seed_actor()::UUID
FROM
  "StaffRole" sr
  JOIN (
    VALUES
      ('OWNER', 'catalog:price:update'),
      ('OWNER', 'orders:read'),
      ('OWNER', 'orders:place'),
      ('OWNER', 'orders:settle'),
      ('OWNER', 'ledger:read'),
      ('OWNER', 'staff:roles:manage'),
      ('OWNER', 'staff:manage'),
      ('ADMIN', 'catalog:price:update'),
      ('ADMIN', 'orders:read'),
      ('ADMIN', 'orders:place'),
      ('ADMIN', 'orders:settle'),
      ('ADMIN', 'ledger:read'),
      ('ADMIN', 'staff:roles:manage'),
      ('ADMIN', 'staff:manage'),
      ('MANAGER', 'catalog:price:update'),
      ('MANAGER', 'orders:read'),
      ('MANAGER', 'orders:place'),
      ('MANAGER', 'orders:settle'),
      ('ORDER_TAKER', 'orders:read'),
      ('ORDER_TAKER', 'orders:place')
  ) AS perm_def (role_name, permission) ON sr."name" = perm_def.role_name
ON CONFLICT DO NOTHING;


-- 6. SEED 5 PHYSICAL DINING TABLES PER RESTAURANT (50 TOTAL)
INSERT INTO
  "DiningTable" (
    "restaurantId",
    "tableNumber",
    "zoneName",
    "seatCapacity",
    "activeQrSessionToken",
    "createdBy",
    "updatedBy"
  )
SELECT
  r."id",
  'T-' || t_idx,
  CASE
    WHEN t_idx > 3 THEN 'Window Booth'
    ELSE 'Main Floor'
  END,
  4,
  'qr_tok_' || right(r."id"::TEXT, 4) || '_' || t_idx,
  pg_temp.seed_actor()::UUID,
  pg_temp.seed_actor()::UUID
FROM
  "Restaurant" r
  CROSS JOIN generate_series(1, 5) AS t_idx
ON CONFLICT ("activeQrSessionToken") DO NOTHING;


-- 7. SEED 10 ISOLATED STAFF MEMBERS PER RESTAURANT LINKED TO ROLE ID (100 TOTAL)
INSERT INTO
  "RestaurantStaff" (
    "restaurantId",
    "email",
    "passwordHash",
    "name",
    "role",
    "roleId",
    "createdBy",
    "updatedBy"
  )
SELECT
  r."id",
  'staff' || s.idx || '.' || right(r."id"::TEXT, 4) || '@pos-tenant.co.uk',
  '$2b$10$MockHashedPasswordStringForTenantStaff',
  'Staff ' || s.idx || ' (' || r."name" || ')',
  s.role_name::"TenantRole",
  sr."id",
  pg_temp.seed_actor()::UUID,
  pg_temp.seed_actor()::UUID
FROM
  "Restaurant" r
  CROSS JOIN (
    VALUES
      (1, 'OWNER'),
      (2, 'ADMIN'),
      (3, 'MANAGER'),
      (4, 'MANAGER'),
      (5, 'ORDER_TAKER'),
      (6, 'ORDER_TAKER'),
      (7, 'ORDER_TAKER'),
      (8, 'ORDER_TAKER'),
      (9, 'ORDER_TAKER'),
      (10, 'ORDER_TAKER')
  ) AS s (idx, role_name)
  JOIN "StaffRole" sr ON sr."restaurantId" = r."id"
  AND sr."name" = s.role_name
ON CONFLICT ("email") DO NOTHING;


-- 8. SEED CATEGORIES, SMASH BURGER MENU ITEMS & MODIFIERS
INSERT INTO
  "Category" (
    "restaurantId",
    "name",
    "sortWeight",
    "createdBy",
    "updatedBy"
  )
SELECT
  r."id",
  c.cat_name,
  c.weight,
  pg_temp.seed_actor()::UUID,
  pg_temp.seed_actor()::UUID
FROM
  "Restaurant" r
  CROSS JOIN (
    VALUES
      ('Smash Burgers', 10),
      ('Loaded Wraps', 20),
      ('Thick Shakes', 30)
  ) AS c (cat_name, weight);


INSERT INTO
  "MenuItem" (
    "categoryId",
    "name",
    "description",
    "basePrice",
    "vatRate",
    "allergenFlags",
    "kdsTarget",
    "createdBy",
    "updatedBy"
  )
SELECT
  c."id",
  CASE c."name"
    WHEN 'Smash Burgers' THEN 'The Light One (' || r."postcodeSector" || ')'
    WHEN 'Loaded Wraps' THEN 'Crispy Peri Wrap (' || r."postcodeSector" || ')'
    ELSE 'Lotus Biscoff Shake (' || r."postcodeSector" || ')'
  END,
  CASE c."name"
    WHEN 'Smash Burgers' THEN '1 Aged Beef Patty, American Cheese, Pickles, House Sauce'
    WHEN 'Loaded Wraps' THEN 'Southern Fried Chicken, Peri Mayo, Iceberg, Brioche Tortilla'
    ELSE 'Jersey Milk, Biscoff Spread, Crushed Biscuit, Whipped Cream'
  END,
  CASE c."name"
    WHEN 'Smash Burgers' THEN 8.99
    WHEN 'Loaded Wraps' THEN 9.49
    ELSE 5.99
  END,
  20.00,
  CASE c."name"
    WHEN 'Smash Burgers' THEN ARRAY['Gluten', 'Dairy', 'Mustard']
    WHEN 'Loaded Wraps' THEN ARRAY['Gluten', 'Eggs']
    ELSE ARRAY['Dairy', 'Gluten', 'Soya']
  END,
  CASE c."name"
    WHEN 'Thick Shakes' THEN 'BAR_PRINTER'::"KdsRoutingTarget"
    ELSE 'KITCHEN_SCREEN'::"KdsRoutingTarget"
  END,
  pg_temp.seed_actor()::UUID,
  pg_temp.seed_actor()::UUID
FROM
  "Category" c
  JOIN "Restaurant" r ON r."id" = c."restaurantId";


INSERT INTO
  "ItemModifier" (
    "menuItemId",
    "name",
    "extraPrice",
    "createdBy",
    "updatedBy"
  )
SELECT
  m."id",
  mod.mod_name,
  mod.price,
  pg_temp.seed_actor()::UUID,
  pg_temp.seed_actor()::UUID
FROM
  "MenuItem" m
  JOIN "Category" c ON c."id" = m."categoryId"
  CROSS JOIN (
    VALUES
      ('Add Extra Smash Patty', 2.99),
      ('Extra Monterey Jack Cheese', 0.75),
      ('Turkey Bacon Rashers', 1.25)
  ) AS mod(mod_name, price)
WHERE
  c."name" = 'Smash Burgers';


-- 9. POPULATE JSONB MENU SNAPSHOTS FOR REDIS FALLBACK (CompiledMenuSnapshot Contract)
WITH
  snapshot_payload AS (
    SELECT
      r."id" AS restaurant_id,
      md5(r."id"::TEXT || now()::TEXT) AS version_hash,
      to_char(
        now() AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ) AS generated_at,
      r."name" AS restaurant_name,
      r."postcodeSector" AS postcode_sector
    FROM
      "Restaurant" r
  )
INSERT INTO
  "MenuSnapshot" (
    "restaurantId",
    "versionHash",
    "serializedMenu",
    "createdBy",
    "updatedBy"
  )
SELECT
  sp.restaurant_id,
  sp.version_hash,
  jsonb_build_object(
    'restaurantId',
    sp.restaurant_id,
    'restaurantName',
    sp.restaurant_name,
    'postcodeSector',
    sp.postcode_sector,
    'versionHash',
    sp.version_hash,
    'generatedAt',
    sp.generated_at,
    'categories',
    coalesce(
      (
        SELECT
          jsonb_agg(
            jsonb_build_object(
              'id',
              c."id",
              'name',
              c."name",
              'sortWeight',
              c."sortWeight",
              'items',
              coalesce(
                (
                  SELECT
                    jsonb_agg(
                      jsonb_build_object(
                        'id',
                        m."id",
                        'name',
                        m."name",
                        'description',
                        m."description",
                        'basePrice',
                        m."basePrice"::DOUBLE PRECISION,
                        'vatRate',
                        m."vatRate"::DOUBLE PRECISION,
                        'allergenFlags',
                        to_jsonb(
                          coalesce(m."allergenFlags", '{}'::TEXT[])
                        ),
                        'kdsTarget',
                        m."kdsTarget",
                        'imageUrl',
                        m."imageUrl",
                        'modifiers',
                        coalesce(
                          (
                            SELECT
                              jsonb_agg(
                                jsonb_build_object(
                                  'id',
                                  im."id",
                                  'name',
                                  im."name",
                                  'extraPrice',
                                  im."extraPrice"::DOUBLE PRECISION
                                )
                              )
                            FROM
                              "ItemModifier" im
                            WHERE
                              im."menuItemId" = m."id"
                              AND im."deletedAt" IS NULL
                          ),
                          '[]'::JSONB
                        )
                      )
                    )
                  FROM
                    "MenuItem" m
                  WHERE
                    m."categoryId" = c."id"
                    AND m."isActive" = TRUE
                    AND m."deletedAt" IS NULL
                ),
                '[]'::JSONB
              )
            )
            ORDER BY
              c."sortWeight" ASC
          )
        FROM
          "Category" c
        WHERE
          c."restaurantId" = sp.restaurant_id
          AND c."deletedAt" IS NULL
      ),
      '[]'::JSONB
    )
  ),
  pg_temp.seed_actor()::UUID,
  pg_temp.seed_actor()::UUID
FROM
  snapshot_payload sp
ON CONFLICT ("restaurantId") DO UPDATE
SET
  "versionHash" = EXCLUDED."versionHash",
  "serializedMenu" = EXCLUDED."serializedMenu",
  "updatedAt" = CURRENT_TIMESTAMP;


-- 10. SEED 20 HISTORICAL ORDERS (15 IN-STORE POS + 5 SHOWCASE DELIVERY) & LEDGERS
WITH
  seeded_orders AS (
    INSERT INTO
      "Order" (
        "restaurantId",
        "customerId",
        "diningTableId",
        "driverId",
        "orderSource",
        "paymentMethod",
        "subtotal",
        "vatTotal",
        "deliveryFee",
        "tipAmount",
        "totalAmount",
        "createdBy",
        "updatedBy"
      )
    SELECT
      r."id",
      CASE
        WHEN o_idx = 2
        AND right(r."id"::TEXT, 2)::INT > 5 THEN '11111111-1111-4111-8111-111111111111'::UUID
        ELSE NULL
      END,
      (
        SELECT
          dt."id"
        FROM
          "DiningTable" dt
        WHERE
          dt."restaurantId" = r."id"
        LIMIT
          1
      ),
      CASE
        WHEN o_idx = 2
        AND right(r."id"::TEXT, 2)::INT > 5 THEN '33333333-3333-4333-8333-333333333333'::UUID
        ELSE NULL
      END,
      CASE
        WHEN o_idx = 2
        AND right(r."id"::TEXT, 2)::INT > 5 THEN 'ONLINE_DELIVERY'::"OrderSource"
        ELSE 'DINE_IN'::"OrderSource"
      END,
      CASE
        WHEN o_idx = 2
        AND right(r."id"::TEXT, 2)::INT > 5 THEN 'ONLINE_GATEWAY'::"InStorePaymentMethod"
        ELSE 'CARD_TERMINAL'::"InStorePaymentMethod"
      END,
      14.99,
      3.00,
      CASE
        WHEN o_idx = 2
        AND right(r."id"::TEXT, 2)::INT > 5 THEN 2.50
        ELSE 0.00
      END,
      2.00,
      CASE
        WHEN o_idx = 2
        AND right(r."id"::TEXT, 2)::INT > 5 THEN 22.49
        ELSE 19.99
      END,
      pg_temp.seed_actor()::UUID,
      pg_temp.seed_actor()::UUID
    FROM
      "Restaurant" r
      CROSS JOIN generate_series(1, 2) AS o_idx
    RETURNING
      "id",
      "restaurantId",
      "totalAmount"
  ),
  inserted_lines AS (
    INSERT INTO
      "OrderLineItem" (
        "orderId",
        "itemName",
        "frozenPrice",
        "quantity",
        "createdBy",
        "updatedBy"
      )
    SELECT
      so."id",
      'The Light One',
      8.99,
      1,
      pg_temp.seed_actor()::UUID,
      pg_temp.seed_actor()::UUID
    FROM
      seeded_orders so
  )
INSERT INTO
  "FinancialLedger" (
    "orderId",
    "entityName",
    "creditAmount",
    "description",
    "createdBy",
    "updatedBy"
  )
SELECT
  so."id",
  'RESTAURANT_' || so."restaurantId"::TEXT,
  so."totalAmount",
  'POS / Online order gross settlement',
  pg_temp.seed_actor()::UUID,
  pg_temp.seed_actor()::UUID
FROM
  seeded_orders so;
