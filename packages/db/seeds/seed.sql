CREATE FUNCTION pg_temp.seed_actor() RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT '00000000-0000-4000-85ee-000000000001'::UUID;
$$;


-- 1. SEED PLATFORM ADMINS, CUSTOMERS & DRIVERS
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
    '00000000-0000-4000-8000-000000000001',
    'admin1@ukfoodpos.co.uk',
    'Platform Admin 1',
    TRUE,
    'PLATFORM_ADMIN',
    pg_temp.seed_actor(),
    pg_temp.seed_actor()
  ),
  (
    '11111111-1111-4111-8111-111111111111',
    'customer1@ukmail.co.uk',
    'Oliver Twist',
    TRUE,
    'CUSTOMER',
    pg_temp.seed_actor(),
    pg_temp.seed_actor()
  ),
  (
    '11111111-1111-4111-8111-111111111112',
    'customer2@ukmail.co.uk',
    'Zara Khan',
    TRUE,
    'CUSTOMER',
    pg_temp.seed_actor(),
    pg_temp.seed_actor()
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    'rider1@ukfleet.co.uk',
    'Harry Rider',
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
    TRUE,
    ARRAY['E1', 'KHI-PECHS', 'KHI-CLIFTON', 'LHR-GULBERG'],
    pg_temp.seed_actor(),
    pg_temp.seed_actor()
  )
ON CONFLICT ("userId") DO NOTHING;


-- 2. SEED 5 ARCHETYPE BRANDS / CREATORS
INSERT INTO
  "Restaurant" (
    "id",
    "name",
    "handle",
    "logoUrl",
    "description",
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
    'Ayesha''s Kitchen',
    'ayeshas-kitchen',
    'https://foodapp.example',
    'Authentic homemade biryani and nihari prepared fresh daily in small batches.',
    NULL,
    NULL,
    5,
    'KHI-PECHS',
    25,
    'WEEKLY',
    10.00,
    pg_temp.seed_actor(),
    pg_temp.seed_actor()
  ),
  (
    'a0000000-0000-4000-8000-000000000002',
    'BiteIn',
    'bitein',
    'https://foodapp.example',
    'Neighborhood artisan smash burgers, loaded fries, and thick shakes.',
    'GB100024690',
    '08010864',
    5,
    'SW1A',
    14,
    'DAILY',
    12.50,
    pg_temp.seed_actor(),
    pg_temp.seed_actor()
  ),
  (
    'a0000000-0000-4000-8000-000000000003',
    'BurgerLab Cloud',
    'burgerlab-cloud',
    'https://foodapp.example',
    'Delivery-first cloud kitchen crafting double-seared burgers and hot wings.',
    'PK-NTN-778899',
    NULL,
    5,
    'KHI-DHA',
    12,
    'DAILY',
    14.00,
    pg_temp.seed_actor(),
    pg_temp.seed_actor()
  ),
  (
    'a0000000-0000-4000-8000-000000000004',
    'PizzaIn',
    'pizzain',
    'https://foodapp.example',
    'Karachi''s favorite wood-fired and pan pizza chain across Clifton and Gulshan.',
    'PK-NTN-445566',
    'SECP-00912',
    5,
    'KHI-CLIFTON',
    18,
    'WEEKLY',
    12.50,
    pg_temp.seed_actor(),
    pg_temp.seed_actor()
  ),
  (
    'a0000000-0000-4000-8000-000000000005',
    'Pizza Hut',
    'pizza-hut',
    'https://foodapp.example',
    'Pan pizzas, stuffed crusts, and pasta combos across Karachi and Lahore.',
    'PK-NTN-112233',
    'SECP-00101',
    5,
    'KHI-CLIFTON',
    20,
    'DAILY',
    11.00,
    pg_temp.seed_actor(),
    pg_temp.seed_actor()
  )
ON CONFLICT ("id") DO NOTHING;


-- 3. SEED BRAND STOREFRONT LAYOUTS, PAYMENT CONFIGS & DEFAULT PRICING POLICIES
INSERT INTO
  "RestaurantLayout" (
    "restaurantId",
    "templateId",
    "primaryColor",
    "bannerUrl",
    "galleryImages",
    "createdBy",
    "updatedBy"
  )
VALUES
  (
    'a0000000-0000-4000-8000-000000000001',
    'home_creator_warm_v1',
    '#B45309',
    'https://foodapp.example',
    '["https://foodapp.example"]'::JSONB,
    pg_temp.seed_actor(),
    pg_temp.seed_actor()
  ),
  (
    'a0000000-0000-4000-8000-000000000002',
    'uk_pos_modern_v1',
    '#1E293B',
    'https://foodapp.example',
    '[]'::JSONB,
    pg_temp.seed_actor(),
    pg_temp.seed_actor()
  ),
  (
    'a0000000-0000-4000-8000-000000000003',
    'cloud_kitchen_dark_v1',
    '#0F172A',
    'https://foodapp.example',
    '[]'::JSONB,
    pg_temp.seed_actor(),
    pg_temp.seed_actor()
  ),
  (
    'a0000000-0000-4000-8000-000000000004',
    'chain_flagship_v1',
    '#DC2626',
    'https://foodapp.example',
    '[]'::JSONB,
    pg_temp.seed_actor(),
    pg_temp.seed_actor()
  ),
  (
    'a0000000-0000-4000-8000-000000000005',
    'enterprise_chain_v1',
    '#B91C1C',
    'https://foodapp.example',
    '[]'::JSONB,
    pg_temp.seed_actor(),
    pg_temp.seed_actor()
  )
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
  'acct_foodapp_' || right("id"::TEXT, 4),
  pg_temp.seed_actor()::UUID,
  pg_temp.seed_actor()::UUID
FROM
  "Restaurant"
ON CONFLICT ("restaurantId") DO NOTHING;


INSERT INTO
  "PricingPolicy" (
    "restaurantId",
    "branchId",
    "menuPricingMode",
    "maxDirectPriceDeltaPercent",
    "allowBranchLocalItems",
    "maxDirectOrderDiscountPercent",
    "allowFullCompWaiveOff",
    "requireReasonForCompOrDiscount",
    "maxDirectRefundAmount",
    "createdBy",
    "updatedBy"
  )
VALUES
  (
    'a0000000-0000-4000-8000-000000000001',
    NULL,
    'BRANCH_DIRECT',
    25.00,
    TRUE,
    20.00,
    TRUE,
    TRUE,
    30.00,
    pg_temp.seed_actor(),
    pg_temp.seed_actor()
  ),
  (
    'a0000000-0000-4000-8000-000000000002',
    NULL,
    'BRANCH_DIRECT',
    15.00,
    TRUE,
    15.00,
    TRUE,
    TRUE,
    40.00,
    pg_temp.seed_actor(),
    pg_temp.seed_actor()
  ),
  (
    'a0000000-0000-4000-8000-000000000003',
    NULL,
    'CENTRAL_LOCKED',
    0.00,
    FALSE,
    10.00,
    FALSE,
    TRUE,
    25.00,
    pg_temp.seed_actor(),
    pg_temp.seed_actor()
  ),
  (
    'a0000000-0000-4000-8000-000000000004',
    NULL,
    'THRESHOLD_HYBRID',
    10.00,
    TRUE,
    20.00,
    TRUE,
    TRUE,
    50.00,
    pg_temp.seed_actor(),
    pg_temp.seed_actor()
  ),
  (
    'a0000000-0000-4000-8000-000000000005',
    NULL,
    'BRANCH_APPROVAL_REQUIRED',
    0.00,
    FALSE,
    15.00,
    TRUE,
    TRUE,
    50.00,
    pg_temp.seed_actor(),
    pg_temp.seed_actor()
  );

-- 4. SEED 8 PHYSICAL BRANCHES COVERING ALL 5 REAL-WORLD ARCHETYPES
INSERT INTO
  "RestaurantBranch" (
    "id",
    "restaurantId",
    "name",
    "branchKey",
    "city",
    "cityKey",
    "kitchenType",
    "postcodeSector",
    "streetAddress",
    "areaLocality",
    "latitude",
    "longitude",
    "contactPersonName",
    "contactPersonPhone",
    "contactPersonEmail",
    "supportsDineIn",
    "supportsTakeaway",
    "supportsPlatformDelivery",
    "operationalStatus",
    "scheduleConfig",
    "homePickupPrivacyMode",
    "dropPointConfig",
    "approvedTakeawayUserIds",
    "menuSelectionMode",
    "averagePrepTimeMinutes",
    "createdBy",
    "updatedBy"
  )
VALUES
  -- Archetype 1: Ayesha's Kitchen (HOME_KITCHEN in Karachi PECHS with public dropPointConfig + takeaway enabled)
  (
    'b0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000001',
    'Ayesha''s Home Kitchen (PECHS)',
    'pechs',
    'Karachi',
    'karachi',
    'HOME_KITCHEN',
    'KHI-PECHS',
    'House 42-B, Block 6, PECHS, Karachi',
    'PECHS Block 6',
    24.860700,
    67.064200,
    'Ayesha Siddiqui',
    '+92-300-8211001',
    'ayesha@homekitchen.pk',
    FALSE,
    TRUE,
    TRUE,
    'OPEN',
    '{"weekly":{"mon":["12:00-15:00","19:00-22:00"],"wed":["12:00-15:00","19:00-22:00"],"fri":["13:00-22:00"],"sat":["13:00-22:00"]},"overrides":[]}'::JSONB,
    'ORDER_ACCEPTANCE',
    '{"label":"Tariq Road Chase Up Main Gate Pickup Point","areaLocality":"PECHS Block 2","instructions":"Call 5 mins prior; rider/host hands over sealed bag at Gate 1.","latitude":24.8712,"longitude":67.0615}'::JSONB,
    '[{"userId":"11111111-1111-4111-8111-111111111111","status":"APPROVED"}]'::JSONB,
    'ALL_BRAND_ITEMS',
    25,
    pg_temp.seed_actor(),
    pg_temp.seed_actor()
  ),
  -- Archetype 2: BiteIn (Single-Location Commercial RESTAURANT_BRANCH in London Westminster)
  (
    'b0000000-0000-4000-8000-000000000002',
    'a0000000-0000-4000-8000-000000000002',
    'BiteIn Westminster',
    'westminster',
    'London',
    'london',
    'RESTAURANT_BRANCH',
    'SW1A',
    '18 Victoria Street, Westminster, London SW1A 0NZ',
    'Westminster',
    51.497500,
    -0.135700,
    'Callum Reid',
    '+44-20-7946-0192',
    'westminster@bitein.co.uk',
    TRUE,
    TRUE,
    TRUE,
    'OPEN',
    '{"weekly":{"mon":["11:00-23:00"],"tue":["11:00-23:00"],"wed":["11:00-23:00"],"thu":["11:00-23:30"],"fri":["11:00-00:00"],"sat":["11:00-00:00"],"sun":["12:00-22:00"]},"overrides":[]}'::JSONB,
    'ORDER_ACCEPTANCE',
    NULL,
    '[]'::JSONB,
    'ALL_BRAND_ITEMS',
    14,
    pg_temp.seed_actor(),
    pg_temp.seed_actor()
  ),
  -- Archetype 3: BurgerLab Cloud (CLOUD_KITCHEN in Karachi DHA Phase 6 — no dine-in)
  (
    'b0000000-0000-4000-8000-000000000003',
    'a0000000-0000-4000-8000-000000000003',
    'BurgerLab Cloud DHA',
    'dha-phase-6',
    'Karachi',
    'karachi',
    'CLOUD_KITCHEN',
    'KHI-DHA',
    'Plot 14-C, Bukhari Commercial Lane 4, DHA Phase 6, Karachi',
    'DHA Phase 6',
    24.793700,
    67.064900,
    'Bilal Ahmed',
    '+92-321-8222003',
    'dha@burgerlabcloud.pk',
    FALSE,
    TRUE,
    TRUE,
    'OPEN',
    '{"weekly":{"mon":["12:00-02:00"],"tue":["12:00-02:00"],"wed":["12:00-02:00"],"thu":["12:00-02:00"],"fri":["12:00-03:00"],"sat":["12:00-03:00"],"sun":["12:00-02:00"]},"overrides":[]}'::JSONB,
    'ORDER_ACCEPTANCE',
    NULL,
    '[]'::JSONB,
    'ALL_BRAND_ITEMS',
    12,
    pg_temp.seed_actor(),
    pg_temp.seed_actor()
  ),
  -- Archetype 4: PizzaIn (Single-City Multi-Branch in Karachi: Clifton Flagship + Gulshan Suburb Opt-In)
  (
    'b0000000-0000-4000-8000-000000000004',
    'a0000000-0000-4000-8000-000000000004',
    'PizzaIn Clifton',
    'clifton',
    'Karachi',
    'karachi',
    'RESTAURANT_BRANCH',
    'KHI-CLIFTON',
    '26th Street, Block 4 Clifton, Karachi',
    'Clifton Block 4',
    24.813800,
    67.030000,
    'Kamran Malik',
    '+92-300-8233004',
    'clifton@pizzain.pk',
    TRUE,
    TRUE,
    TRUE,
    'OPEN',
    '{"weekly":{"mon":["12:00-00:00"],"tue":["12:00-00:00"],"wed":["12:00-00:00"],"thu":["12:00-00:00"],"fri":["12:00-01:00"],"sat":["12:00-01:00"],"sun":["12:00-00:00"]},"overrides":[]}'::JSONB,
    'ORDER_ACCEPTANCE',
    NULL,
    '[]'::JSONB,
    'ALL_BRAND_ITEMS',
    18,
    pg_temp.seed_actor(),
    pg_temp.seed_actor()
  ),
  (
    'b0000000-0000-4000-8000-000000000005',
    'a0000000-0000-4000-8000-000000000004',
    'PizzaIn Gulshan-e-Iqbal',
    'gulshan-e-iqbal',
    'Karachi',
    'karachi',
    'RESTAURANT_BRANCH',
    'KHI-GULSHAN',
    'Main University Road, Block 13-D, Gulshan-e-Iqbal, Karachi',
    'Gulshan-e-Iqbal',
    24.918000,
    67.097100,
    'Sana Tariq',
    '+92-300-8233005',
    'gulshan@pizzain.pk',
    TRUE,
    TRUE,
    TRUE,
    'OPEN',
    '{"weekly":{"mon":["12:00-23:30"],"tue":["12:00-23:30"],"wed":["12:00-23:30"],"thu":["12:00-23:30"],"fri":["12:00-00:30"],"sat":["12:00-00:30"],"sun":["12:00-23:30"]},"overrides":[]}'::JSONB,
    'ORDER_ACCEPTANCE',
    NULL,
    '[]'::JSONB,
    'SELECTED_ITEMS_ONLY',
    16,
    pg_temp.seed_actor(),
    pg_temp.seed_actor()
  ),
  -- Archetype 5: Pizza Hut (Multi-City Multi-Branch across Karachi & Lahore)
  (
    'b0000000-0000-4000-8000-000000000006',
    'a0000000-0000-4000-8000-000000000005',
    'Pizza Hut Clifton',
    'clifton',
    'Karachi',
    'karachi',
    'RESTAURANT_BRANCH',
    'KHI-CLIFTON',
    'Boat Basin Food Street, Clifton Block 5, Karachi',
    'Clifton Block 5',
    24.822500,
    67.028100,
    'Usman Farooq',
    '+92-300-8244006',
    'khi.clifton@pizzahut.pk',
    TRUE,
    TRUE,
    TRUE,
    'OPEN',
    '{"weekly":{"mon":["12:00-00:00"],"tue":["12:00-00:00"],"wed":["12:00-00:00"],"thu":["12:00-00:00"],"fri":["12:00-01:00"],"sat":["12:00-01:00"],"sun":["12:00-00:00"]},"overrides":[]}'::JSONB,
    'ORDER_ACCEPTANCE',
    NULL,
    '[]'::JSONB,
    'ALL_BRAND_ITEMS',
    20,
    pg_temp.seed_actor(),
    pg_temp.seed_actor()
  ),
  (
    'b0000000-0000-4000-8000-000000000007',
    'a0000000-0000-4000-8000-000000000005',
    'Pizza Hut Gulberg',
    'gulberg',
    'Lahore',
    'lahore',
    'RESTAURANT_BRANCH',
    'LHR-GULBERG',
    'MM Alam Road, Block C-2, Gulberg III, Lahore',
    'Gulberg III',
    31.510200,
    74.344100,
    'Hamza Sheikh',
    '+92-300-8244007',
    'lhr.gulberg@pizzahut.pk',
    TRUE,
    TRUE,
    TRUE,
    'OPEN',
    '{"weekly":{"mon":["12:00-00:00"],"tue":["12:00-00:00"],"wed":["12:00-00:00"],"thu":["12:00-00:00"],"fri":["12:00-01:00"],"sat":["12:00-01:00"],"sun":["12:00-00:00"]},"overrides":[]}'::JSONB,
    'ORDER_ACCEPTANCE',
    NULL,
    '[]'::JSONB,
    'ALL_BRAND_ITEMS',
    20,
    pg_temp.seed_actor(),
    pg_temp.seed_actor()
  ),
  (
    'b0000000-0000-4000-8000-000000000008',
    'a0000000-0000-4000-8000-000000000005',
    'Pizza Hut DHA Lahore',
    'dha-phase-5',
    'Lahore',
    'lahore',
    'RESTAURANT_BRANCH',
    'LHR-DHA',
    'Sector CCA, Phase 5 DHA, Lahore',
    'DHA Phase 5',
    31.467600,
    74.408300,
    'Nadia Qureshi',
    '+92-300-8244008',
    'lhr.dha@pizzahut.pk',
    TRUE,
    TRUE,
    TRUE,
    'OPEN',
    '{"weekly":{"mon":["12:00-00:00"],"tue":["12:00-00:00"],"wed":["12:00-00:00"],"thu":["12:00-00:00"],"fri":["12:00-01:00"],"sat":["12:00-01:00"],"sun":["12:00-00:00"]},"overrides":[]}'::JSONB,
    'ORDER_ACCEPTANCE',
    NULL,
    '[]'::JSONB,
    'SELECTED_ITEMS_ONLY',
    18,
    pg_temp.seed_actor(),
    pg_temp.seed_actor()
  )
ON CONFLICT ("id") DO NOTHING;

-- 5. SEED PREDEFINED SYSTEM ROLES & PERMISSIONS PER BRAND
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
  TRUE,
  pg_temp.seed_actor()::UUID,
  pg_temp.seed_actor()::UUID
FROM
  "Restaurant" r
  CROSS JOIN (
    VALUES
      (
        'BRAND_OWNER',
        'Multi-branch brand owner with unrestricted brand & branch governance'
      ),
      (
        'OPERATIONAL_MANAGER',
        'Multi-branch operational manager across assigned branches'
      ),
      (
        'BRANCH_MANAGER',
        'Branch manager handling daily floor operations, pricing proposals, and staff'
      ),
      (
        'CASHIER',
        'Front-of-house cashier for order taking and bill settlement'
      )
  ) AS role_def (role_name, role_desc)
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
      ('BRAND_OWNER', 'brand:branches:create'),
      ('BRAND_OWNER', 'branch:settings:manage'),
      ('BRAND_OWNER', 'branch:status:manage'),
      ('BRAND_OWNER', 'branch:whitelist:manage'),
      ('BRAND_OWNER', 'catalog:items:manage'),
      ('BRAND_OWNER', 'catalog:price:update'),
      ('BRAND_OWNER', 'catalog:price:approve'),
      ('BRAND_OWNER', 'pricing:policy:manage'),
      ('BRAND_OWNER', 'orders:read'),
      ('BRAND_OWNER', 'orders:place'),
      ('BRAND_OWNER', 'orders:settle'),
      ('BRAND_OWNER', 'orders:discount:apply'),
      ('BRAND_OWNER', 'orders:comp:waive'),
      ('BRAND_OWNER', 'orders:refund'),
      ('BRAND_OWNER', 'ledger:read'),
      ('BRAND_OWNER', 'staff:roles:manage'),
      ('BRAND_OWNER', 'staff:manage'),
      ('OPERATIONAL_MANAGER', 'brand:branches:create'),
      ('OPERATIONAL_MANAGER', 'branch:settings:manage'),
      ('OPERATIONAL_MANAGER', 'branch:status:manage'),
      ('OPERATIONAL_MANAGER', 'branch:whitelist:manage'),
      ('OPERATIONAL_MANAGER', 'catalog:items:manage'),
      ('OPERATIONAL_MANAGER', 'catalog:price:update'),
      ('OPERATIONAL_MANAGER', 'catalog:price:approve'),
      ('OPERATIONAL_MANAGER', 'orders:read'),
      ('OPERATIONAL_MANAGER', 'orders:place'),
      ('OPERATIONAL_MANAGER', 'orders:settle'),
      ('OPERATIONAL_MANAGER', 'orders:discount:apply'),
      ('OPERATIONAL_MANAGER', 'orders:comp:waive'),
      ('OPERATIONAL_MANAGER', 'orders:refund'),
      ('OPERATIONAL_MANAGER', 'ledger:read'),
      ('OPERATIONAL_MANAGER', 'staff:roles:manage'),
      ('OPERATIONAL_MANAGER', 'staff:manage'),
      ('BRANCH_MANAGER', 'branch:settings:manage'),
      ('BRANCH_MANAGER', 'branch:status:manage'),
      ('BRANCH_MANAGER', 'branch:whitelist:manage'),
      ('BRANCH_MANAGER', 'catalog:items:manage'),
      ('BRANCH_MANAGER', 'catalog:price:update'),
      ('BRANCH_MANAGER', 'orders:read'),
      ('BRANCH_MANAGER', 'orders:place'),
      ('BRANCH_MANAGER', 'orders:settle'),
      ('BRANCH_MANAGER', 'orders:discount:apply'),
      ('BRANCH_MANAGER', 'orders:comp:waive'),
      ('BRANCH_MANAGER', 'orders:refund'),
      ('BRANCH_MANAGER', 'staff:roles:manage'),
      ('BRANCH_MANAGER', 'staff:manage'),
      ('CASHIER', 'orders:read'),
      ('CASHIER', 'orders:place'),
      ('CASHIER', 'orders:settle')
  ) AS perm_def (role_name, permission) ON sr."name" = perm_def.role_name
ON CONFLICT DO NOTHING;


-- 6. SEED BRAND-LEVEL STAFF & MULTI-BRANCH ASSIGNMENTS
INSERT INTO
  "RestaurantStaff" (
    "id",
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
  ('c0000000-0000-4000-8000-00000000000' || right(r."id"::TEXT, 1))::UUID,
  r."id",
  'owner@' || r."handle" || '.example.com',
  '$2b$10$MockHashedPasswordStringForTenantStaff',
  r."name" || ' Owner',
  'OWNER'::"TenantRole",
  sr."id",
  pg_temp.seed_actor(),
  pg_temp.seed_actor()
FROM
  "Restaurant" r
  JOIN "StaffRole" sr ON sr."restaurantId" = r."id"
  AND sr."name" = 'BRAND_OWNER'
ON CONFLICT ("email") DO NOTHING;


INSERT INTO
  "StaffBranchAssignment" (
    "staffId",
    "branchId",
    "staffRoleId",
    "directPermissions",
    "isPrimary",
    "createdBy",
    "updatedBy"
  )
SELECT
  rs."id",
  rb."id",
  rs."roleId",
  '{}'::TEXT[],
  (rb."id" = (
    SELECT min(b2."id"::TEXT)::UUID
    FROM "RestaurantBranch" b2
    WHERE b2."restaurantId" = rb."restaurantId"
  )),
  pg_temp.seed_actor(),
  pg_temp.seed_actor()
FROM
  "RestaurantStaff" rs
  JOIN "RestaurantBranch" rb ON rb."restaurantId" = rs."restaurantId"
ON CONFLICT DO NOTHING;


-- 7. SEED CATEGORIES, MENU ITEMS WITH INGREDIENT HASHTAGS & BRANCH MENU OVERRIDES
INSERT INTO
  "Category" (
    "id",
    "restaurantId",
    "name",
    "sortWeight",
    "createdBy",
    "updatedBy"
  )
VALUES
  (
    'd0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000001',
    'Homemade Classics',
    10,
    pg_temp.seed_actor(),
    pg_temp.seed_actor()
  ),
  (
    'd0000000-0000-4000-8000-000000000002',
    'a0000000-0000-4000-8000-000000000002',
    'Smash Burgers',
    10,
    pg_temp.seed_actor(),
    pg_temp.seed_actor()
  ),
  (
    'd0000000-0000-4000-8000-000000000003',
    'a0000000-0000-4000-8000-000000000003',
    'Cloud Burgers',
    10,
    pg_temp.seed_actor(),
    pg_temp.seed_actor()
  ),
  (
    'd0000000-0000-4000-8000-000000000004',
    'a0000000-0000-4000-8000-000000000004',
    'Signature Pizzas',
    10,
    pg_temp.seed_actor(),
    pg_temp.seed_actor()
  ),
  (
    'd0000000-0000-4000-8000-000000000005',
    'a0000000-0000-4000-8000-000000000005',
    'Pan & Stuffed Crust Pizzas',
    10,
    pg_temp.seed_actor(),
    pg_temp.seed_actor()
  )
ON CONFLICT ("id") DO NOTHING;


INSERT INTO
  "MenuItem" (
    "id",
    "categoryId",
    "branchId",
    "name",
    "description",
    "basePrice",
    "vatRate",
    "allergenFlags",
    "ingredientTags",
    "kdsTarget",
    "createdBy",
    "updatedBy"
  )
VALUES
  (
    'e0000000-0000-4000-8000-000000000001',
    'd0000000-0000-4000-8000-000000000001',
    NULL,
    'Special Sindhi Chicken Biryani (1kg)',
    'Aromatic basmati rice layered with spiced chicken, caramelized onion, and potatoes.',
    9.50,
    0.00,
    ARRAY['Dairy'],
    ARRAY['#chicken', '#onion', '#spicy'],
    'KITCHEN_SCREEN',
    pg_temp.seed_actor(),
    pg_temp.seed_actor()
  ),
  (
    'e0000000-0000-4000-8000-000000000002',
    'd0000000-0000-4000-8000-000000000002',
    NULL,
    'BiteIn Double Smash',
    'Two aged beef patties, cheddar cheese, crispy onion, house burger sauce.',
    10.99,
    20.00,
    ARRAY['Gluten', 'Dairy', 'Mustard'],
    ARRAY['#beef', '#cheese', '#onion'],
    'KITCHEN_SCREEN',
pg_temp.seed_actor(),
pg_temp.seed_actor()
),
(
'e0000000-0000-4000-8000-000000000003',
'd0000000-0000-4000-8000-000000000003',
NULL,
'Cloud Quadruple Stack',
'Four smashed beef patties, double mozzarella, smoky jalapeno relish.',
12.49,
20.00,
ARRAY['Gluten', 'Dairy'],
ARRAY['#beef', '#cheese', '#spicy'],
'KITCHEN_SCREEN',
pg_temp.seed_actor(),
pg_temp.seed_actor()
),
(
'e0000000-0000-4000-8000-000000000004',
'd0000000-0000-4000-8000-000000000004',
NULL,
'Karachi Tikka Feast Pizza (Large)',
'Chargrilled chicken tikka, mozzarella cheese, red onion, green capsicum.',
14.99,
20.00,
ARRAY['Gluten', 'Dairy'],
ARRAY['#chicken', '#cheese', '#onion'],
'KITCHEN_SCREEN',
pg_temp.seed_actor(),
pg_temp.seed_actor()
),
(
'e0000000-0000-4000-8000-000000000005',
'd0000000-0000-4000-8000-000000000004',
NULL,
'Smoky Beef Pepperoni Pan (Large)',
'Halal beef pepperoni, extra mozzarella cheese, oregano tomato sauce.',
15.99,
20.00,
ARRAY['Gluten', 'Dairy'],
ARRAY['#beef', '#cheese'],
'KITCHEN_SCREEN',
pg_temp.seed_actor(),
pg_temp.seed_actor()
),
(
'e0000000-0000-4000-8000-000000000006',
'd0000000-0000-4000-8000-000000000005',
NULL,
'Super Supreme Stuffed Crust',
'Beef, chicken, mozzarella cheese, onions, mushrooms, and olives.',
17.49,
20.00,
ARRAY['Gluten', 'Dairy'],
ARRAY['#beef', '#chicken', '#cheese', '#onion'],
'KITCHEN_SCREEN',
pg_temp.seed_actor(),
pg_temp.seed_actor()
)
ON CONFLICT ("id") DO NOTHING;
-- Suburb opt-in override for PizzaIn Gulshan-e-Iqbal (SELECTED_ITEMS_ONLY: includes Chicken Tikka Pizza with +1.00 branch price)
INSERT INTO
"BranchMenuOverride" (
"branchId",
"menuItemId",
"isIncluded",
"isAvailable",
"priceOverride",
"approvalStatus",
"createdBy",
"updatedBy"
)
VALUES
(
'b0000000-0000-4000-8000-000000000005',
'e0000000-0000-4000-8000-000000000004',
TRUE,
TRUE,
15.99,
'APPROVED',
pg_temp.seed_actor(),
pg_temp.seed_actor()
),
(
'b0000000-0000-4000-8000-000000000008',
'e0000000-0000-4000-8000-000000000006',
TRUE,
TRUE,
NULL,
'NONE',
pg_temp.seed_actor(),
pg_temp.seed_actor()
)
ON CONFLICT DO NOTHING;
