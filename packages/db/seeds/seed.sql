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
  '00000000-0000-0000-5ee0-000000000001'::UUID,
  '00000000-0000-0000-5ee0-000000000001'::UUID
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
    '11111111-1111-1111-1111-111111111111',
    'customer1@ukmail.co.uk',
    'Oliver Twist',
    TRUE,
    'CUSTOMER',
    '00000000-0000-0000-5ee0-000000000001',
    '00000000-0000-0000-5ee0-000000000001'
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
  '00000000-0000-0000-5ee0-000000000001'::UUID,
  '00000000-0000-0000-5ee0-000000000001'::UUID
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
    '22222222-2222-2222-2222-222222222222',
    'rider1@ukfleet.co.uk',
    'Harry Potter Rider',
    TRUE,
    'DRIVER',
    '00000000-0000-0000-5ee0-000000000001',
    '00000000-0000-0000-5ee0-000000000001'
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
    '33333333-3333-3333-3333-333333333333',
    '22222222-2222-2222-2222-222222222222',
    'UK-DVLA-001',
    'Electric Moped',
    FALSE,
    ARRAY['E1', 'SW1A'],
    '00000000-0000-0000-5ee0-000000000001',
    '00000000-0000-0000-5ee0-000000000001'
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
  '00000000-0000-0000-5ee0-000000000001'::UUID,
  '00000000-0000-0000-5ee0-000000000001'::UUID
FROM
  generate_series(2, 10) AS i
ON CONFLICT ("email") DO NOTHING;


-- 4. SEED 10 UK RESTAURANTS (Deterministic UUIDs for clean relational linking)
INSERT INTO
  "Restaurant" (
    "id",
    "name",
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
    'a0000000-0000-0000-0000-000000000001',
    'Smash 360 London',
    'GB100012345',
    '08005432',
    5,
    'E1',
    11,
    'WEEKLY',
    12.50,
    '00000000-0000-0000-5ee0-000000000001',
    '00000000-0000-0000-5ee0-000000000001'
  ),
  (
    'a0000000-0000-0000-0000-000000000002',
    'Westminster Patty Co',
    'GB100024690',
    '08010864',
    5,
    'SW1A',
    12,
    'DAILY',
    12.50,
    '00000000-0000-0000-5ee0-000000000001',
    '00000000-0000-0000-5ee0-000000000001'
  ),
  (
    'a0000000-0000-0000-0000-000000000003',
    'Manchester Smash',
    'GB100037035',
    '08016296',
    5,
    'M1',
    13,
    'WEEKLY',
    12.50,
    '00000000-0000-0000-5ee0-000000000001',
    '00000000-0000-0000-5ee0-000000000001'
  ),
  (
    'a0000000-0000-0000-0000-000000000004',
    'Brum Burger Lab',
    'GB100049380',
    '08021728',
    5,
    'B1',
    14,
    'DAILY',
    12.50,
    '00000000-0000-0000-5ee0-000000000001',
    '00000000-0000-0000-5ee0-000000000001'
  ),
  (
    'a0000000-0000-0000-0000-000000000005',
    'Leeds Grill 360',
    'GB100061725',
    '08027160',
    5,
    'LS1',
    15,
    'WEEKLY',
    12.50,
    '00000000-0000-0000-5ee0-000000000001',
    '00000000-0000-0000-5ee0-000000000001'
  ),
  (
    'a0000000-0000-0000-0000-000000000006',
    'Glasgow Melt',
    'GB100074070',
    '08032592',
    5,
    'G1',
    16,
    'DAILY',
    12.50,
    '00000000-0000-0000-5ee0-000000000001',
    '00000000-0000-0000-5ee0-000000000001'
  ),
  (
    'a0000000-0000-0000-0000-000000000007',
    'Edinburgh Stack',
    'GB100086415',
    '08038024',
    5,
    'EH1',
    17,
    'WEEKLY',
    12.50,
    '00000000-0000-0000-5ee0-000000000001',
    '00000000-0000-0000-5ee0-000000000001'
  ),
  (
    'a0000000-0000-0000-0000-000000000008',
    'Cardiff Brioche',
    'GB100098760',
    '08043456',
    5,
    'CF10',
    10,
    'DAILY',
    12.50,
    '00000000-0000-0000-5ee0-000000000001',
    '00000000-0000-0000-5ee0-000000000001'
  ),
  (
    'a0000000-0000-0000-0000-000000000009',
    'Bristol Bun House',
    'GB100111105',
    '08048888',
    5,
    'BS1',
    11,
    'WEEKLY',
    12.50,
    '00000000-0000-0000-5ee0-000000000001',
    '00000000-0000-0000-5ee0-000000000001'
  ),
  (
    'a0000000-0000-0000-0000-000000000010',
    'Liverpool Smash',
    'GB100123450',
    '08054320',
    5,
    'L1',
    12,
    'DAILY',
    12.50,
    '00000000-0000-0000-5ee0-000000000001',
    '00000000-0000-0000-5ee0-000000000001'
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
  '00000000-0000-0000-5ee0-000000000001'::UUID,
  '00000000-0000-0000-5ee0-000000000001'::UUID
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
  '00000000-0000-0000-5ee0-000000000001'::UUID,
  '00000000-0000-0000-5ee0-000000000001'::UUID
FROM
  "Restaurant"
ON CONFLICT ("restaurantId") DO NOTHING;


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
  '00000000-0000-0000-5ee0-000000000001'::UUID,
  '00000000-0000-0000-5ee0-000000000001'::UUID
FROM
  "Restaurant" r
  CROSS JOIN generate_series(1, 5) AS t_idx
ON CONFLICT ("activeQrSessionToken") DO NOTHING;


-- 7. SEED 10 ISOLATED STAFF MEMBERS PER RESTAURANT (100 TOTAL)
INSERT INTO
  "RestaurantStaff" (
    "restaurantId",
    "email",
    "passwordHash",
    "name",
    "role",
    "createdBy",
    "updatedBy"
  )
SELECT
  r."id",
  'staff' || s.idx || '.' || right(r."id"::TEXT, 4) || '@pos-tenant.co.uk',
  '$2b$10$MockHashedPasswordStringForTenantStaff',
  'Staff ' || s.idx || ' (' || r."name" || ')',
  s.role_name::"TenantRole",
  '00000000-0000-0000-5ee0-000000000001'::UUID,
  '00000000-0000-0000-5ee0-000000000001'::UUID
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
  '00000000-0000-0000-5ee0-000000000001'::UUID,
  '00000000-0000-0000-5ee0-000000000001'::UUID
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
  '00000000-0000-0000-5ee0-000000000001'::UUID,
  '00000000-0000-0000-5ee0-000000000001'::UUID
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
  '00000000-0000-0000-5ee0-000000000001'::UUID,
  '00000000-0000-0000-5ee0-000000000001'::UUID
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


-- 9. POPULATE JSONB MENU SNAPSHOTS FOR REDIS FALLBACK
INSERT INTO
  "MenuSnapshot" (
    "restaurantId",
    "versionHash",
    "serializedMenu",
    "createdBy",
    "updatedBy"
  )
SELECT
  r."id",
  md5(r."id"::TEXT || now()::TEXT),
  jsonb_build_object(
    'restaurantId',
    r."id",
    'restaurantName',
    r."name",
    'postcodeSector',
    r."postcodeSector",
    'categories',
    (
      SELECT
        jsonb_agg(
          jsonb_build_object(
            'id',
            c."id",
            'name',
            c."name",
            'items',
            (
              SELECT
                jsonb_agg(
                  jsonb_build_object(
                    'id',
                    m."id",
                    'name',
                    m."name",
                    'price',
                    m."basePrice",
                    'allergens',
                    m."allergenFlags"
                  )
                )
              FROM
                "MenuItem" m
              WHERE
                m."categoryId" = c."id"
            )
          )
        )
      FROM
        "Category" c
      WHERE
        c."restaurantId" = r."id"
    )
  ),
  '00000000-0000-0000-5ee0-000000000001'::UUID,
  '00000000-0000-0000-5ee0-000000000001'::UUID
FROM
  "Restaurant" r
ON CONFLICT ("restaurantId") DO NOTHING;


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
        AND right(r."id"::TEXT, 2)::INT > 5 THEN '11111111-1111-1111-1111-111111111111'::UUID
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
        AND right(r."id"::TEXT, 2)::INT > 5 THEN '33333333-3333-3333-3333-333333333333'::UUID
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
      '00000000-0000-0000-5ee0-000000000001'::UUID,
      '00000000-0000-0000-5ee0-000000000001'::UUID
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
      '00000000-0000-0000-5ee0-000000000001'::UUID,
      '00000000-0000-0000-5ee0-000000000001'::UUID
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
  '00000000-0000-0000-5ee0-000000000001'::UUID,
  '00000000-0000-0000-5ee0-000000000001'::UUID
FROM
  seeded_orders so;
