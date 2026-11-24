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
    'Zara''s Kitchen',
    'zaras-kitchen',
    'https://example.com',
    'Homemade biryani and slow-cooked curries prepared fresh daily in East London.',
    NULL,
    NULL,
    5,
    'E1',
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
    'https://example.com',
    'Neighborhood artisan smash burgers, skin-on fries, and shakes in Westminster.',
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
    'https://example.com',
    'Delivery-first cloud kitchen in Shoreditch crafting double-seared burgers and wings.',
    'GB200445511',
    '11450921',
    5,
    'E2',
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
    'https://example.com',
    'Wood-fired and sourdough pan pizza chain across Deansgate and Didsbury.',
    'GB300778899',
    '09321844',
    5,
    'M3',
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
    'https://example.com',
    'Pan pizzas, stuffed crusts, and pasta combos across Bristol and Birmingham.',
    'GB400112233',
    '04112290',
    5,
    'BS8',
    20,
    'DAILY',
    11.00,
    pg_temp.seed_actor(),
    pg_temp.seed_actor()
  )
ON CONFLICT ("id") DO NOTHING;

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
    'https://example.com',
    '["https://example.com"]'::JSONB,
    pg_temp.seed_actor(),
    pg_temp.seed_actor()
  ),
  (
    'a0000000-0000-4000-8000-000000000002',
    'pos_modern_v1',
    '#1E293B',
    'https://example.com',
    '[]'::JSONB,
    pg_temp.seed_actor(),
    pg_temp.seed_actor()
  ),
  (
    'a0000000-0000-4000-8000-000000000003',
    'cloud_kitchen_dark_v1',
    '#0F172A',
    'https://example.com',
    '[]'::JSONB,
    pg_temp.seed_actor(),
    pg_temp.seed_actor()
  ),
  (
    'a0000000-0000-4000-8000-000000000004',
    'chain_flagship_v1',
    '#DC2626',
    'https://example.com',
    '[]'::JSONB,
    pg_temp.seed_actor(),
    pg_temp.seed_actor()
  ),
  (
    'a0000000-0000-4000-8000-000000000005',
    'enterprise_chain_v1',
    '#B91C1C',
    'https://example.com',
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
  )
ON CONFLICT DO NOTHING;

