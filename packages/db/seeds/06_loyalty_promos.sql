-- 8. SEED UK LOYALTY POLICIES & LAUNCH PROMOTIONS
INSERT INTO
  "LoyaltyProgramPolicy" (
    "issuerScope",
    "restaurantId",
    "status",
    "maturationDays",
    "expiryDays",
    "freezeExpiry",
    "pointsPerGbp",
    "gbpPerPoint",
    "createdBy",
    "updatedBy"
  )
VALUES
  (
    'PLATFORM',
    NULL,
    'ACTIVE',
    14,
    365,
    FALSE,
    10.00,
    0.0100,
    pg_temp.seed_actor (),
    pg_temp.seed_actor ()
  ),
  (
    'MERCHANT',
    'a0000000-0000-4000-8000-000000000002',
    'ACTIVE',
    14,
    180,
    FALSE,
    15.00,
    0.0100,
    pg_temp.seed_actor (),
    pg_temp.seed_actor ()
  ),
  (
    'MERCHANT',
    'a0000000-0000-4000-8000-000000000005',
    'ACTIVE',
    14,
    365,
    FALSE,
    10.00,
    0.0100,
    pg_temp.seed_actor (),
    pg_temp.seed_actor ()
  )
ON CONFLICT DO NOTHING;


INSERT INTO
  "Promotion" (
    "id",
    "restaurantId",
    "promoCode",
    "discountType",
    "discountValue",
    "fundingSource",
    "minSubtotal",
    "maxDiscount",
    "startDate",
    "endDate",
    "userUsageLimit",
    "validDaysOfWeek",
    "validTimeStart",
    "validTimeEnd",
    "allowLoyaltyEarn",
    "allowLoyaltyRedeem",
    "createdBy",
    "updatedBy"
  )
VALUES
  (
    'f0000000-0000-4000-8000-000000000001',
    NULL,
    'UKLAUNCH20',
    'PERCENTAGE',
    20.00,
    'PLATFORM',
    15.00,
    10.00,
    CURRENT_TIMESTAMP - INTERVAL '1 day',
    CURRENT_TIMESTAMP + INTERVAL '90 days',
    5,
    ARRAY[0, 1, 2, 3, 4, 5, 6],
    NULL,
    NULL,
    FALSE,
    FALSE,
    pg_temp.seed_actor (),
    pg_temp.seed_actor ()
  )
ON CONFLICT ("promoCode") DO NOTHING;
