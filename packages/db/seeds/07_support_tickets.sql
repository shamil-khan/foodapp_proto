-- 9. SEED BRAND-AUTHORIZED JIT SUPPORT TICKETS (CATALOG ADD-ON & OPERATIONAL RESCUE)
INSERT INTO
  "SupportTicket" (
    "id",
    "restaurantId",
    "branchId",
    "requestedByStaffId",
    "approvedByStaffId",
    "approvedAt",
    "assignedPlatformUserId",
    "scopePermission",
    "reason",
    "attachmentUrl",
    "attachmentNote",
    "status",
    "expiresAt",
    "createdBy",
    "updatedBy"
  )
VALUES
  (
    '70000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000001',
    'b0000000-0000-4000-8000-000000000001',
    'c0000000-0000-4000-8000-000000000001',
    'c0000000-0000-4000-8000-000000000001',
    CURRENT_TIMESTAMP,
    '00000000-0000-4000-8000-000000000001',
    'platform:support:catalog-override',
    'Catalog subscription add-on: upload updated weekend biryani menu prices from photo',
    'https://foodapp.co.uk',
    'Please add Lamb Nihari at £11.50 and update Chicken Biryani to £10.00.',
    'APPROVED',
    CURRENT_TIMESTAMP + INTERVAL '24 hours',
    'c0000000-0000-4000-8000-000000000001',
    'c0000000-0000-4000-8000-000000000001'
  ),
  (
    '70000000-0000-4000-8000-000000000002',
    'a0000000-0000-4000-8000-000000000005',
    'b0000000-0000-4000-8000-000000000006',
    'c0000000-0000-4000-8000-000000000007',
    'c0000000-0000-4000-8000-000000000007',
    CURRENT_TIMESTAMP - INTERVAL '48 hours',
    '00000000-0000-4000-8000-000000000002',
    'platform:support:branch-override',
    'Expired test ticket for oven maintenance status override',
    NULL,
    NULL,
    'APPROVED',
    CURRENT_TIMESTAMP - INTERVAL '24 hours',
    'c0000000-0000-4000-8000-000000000007',
    'c0000000-0000-4000-8000-000000000007'
  )
ON CONFLICT ("id") DO NOTHING;
