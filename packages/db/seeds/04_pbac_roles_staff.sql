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
  pg_temp.seed_actor ()::UUID,
  pg_temp.seed_actor ()::UUID
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
  pg_temp.seed_actor ()::UUID,
  pg_temp.seed_actor ()::UUID
FROM
  "StaffRole" sr
  JOIN (
    VALUES
      ('BRAND_OWNER', 'brand:branches:create'),
      ('BRAND_OWNER', 'branch:settings:manage'),
      ('BRAND_OWNER', 'branch:status:manage'),
      (
        'BRAND_OWNER',
        'branch:whitelist:manage'
      ),
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
      (
        'OPERATIONAL_MANAGER',
        'brand:branches:create'
      ),
      (
        'OPERATIONAL_MANAGER',
        'branch:settings:manage'
      ),
      (
        'OPERATIONAL_MANAGER',
        'branch:status:manage'
      ),
      (
        'OPERATIONAL_MANAGER',
        'branch:whitelist:manage'
      ),
      (
        'OPERATIONAL_MANAGER',
        'catalog:items:manage'
      ),
      (
        'OPERATIONAL_MANAGER',
        'catalog:price:update'
      ),
      (
        'OPERATIONAL_MANAGER',
        'catalog:price:approve'
      ),
      ('OPERATIONAL_MANAGER', 'orders:read'),
      ('OPERATIONAL_MANAGER', 'orders:place'),
      ('OPERATIONAL_MANAGER', 'orders:settle'),
      (
        'OPERATIONAL_MANAGER',
        'orders:discount:apply'
      ),
      (
        'OPERATIONAL_MANAGER',
        'orders:comp:waive'
      ),
      ('OPERATIONAL_MANAGER', 'orders:refund'),
      ('OPERATIONAL_MANAGER', 'ledger:read'),
      (
        'OPERATIONAL_MANAGER',
        'staff:roles:manage'
      ),
      ('OPERATIONAL_MANAGER', 'staff:manage'),
      (
        'BRANCH_MANAGER',
        'branch:settings:manage'
      ),
      (
        'BRANCH_MANAGER',
        'branch:status:manage'
      ),
      (
        'BRANCH_MANAGER',
        'branch:whitelist:manage'
      ),
      (
        'BRANCH_MANAGER',
        'catalog:items:manage'
      ),
      (
        'BRANCH_MANAGER',
        'catalog:price:update'
      ),
      ('BRANCH_MANAGER', 'orders:read'),
      ('BRANCH_MANAGER', 'orders:place'),
      ('BRANCH_MANAGER', 'orders:settle'),
      (
        'BRANCH_MANAGER',
        'orders:discount:apply'
      ),
      ('BRANCH_MANAGER', 'orders:comp:waive'),
      ('BRANCH_MANAGER', 'orders:refund'),
      ('BRANCH_MANAGER', 'staff:roles:manage'),
      ('BRANCH_MANAGER', 'staff:manage'),
      ('CASHIER', 'orders:read'),
      ('CASHIER', 'orders:place'),
      ('CASHIER', 'orders:settle')
  ) AS perm_def (role_name, permission) ON sr."name" = perm_def.role_name
ON CONFLICT DO NOTHING;

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
  staff_def.staff_id::UUID,
  r."id",
  staff_def.email,
  '$2b$10$MockHashedPasswordStringForTenantStaff',
  staff_def.staff_name,
  staff_def.tenant_role::"TenantRole",
  sr."id",
  pg_temp.seed_actor(),
  pg_temp.seed_actor()
FROM
  (
    VALUES
      ('c0000000-0000-4000-8000-000000000001', 'zaras-kitchen', 'zara@zaras-kitchen.com', 'Zara', 'OWNER', 'BRAND_OWNER'),
      ('c0000000-0000-4000-8000-000000000002', 'bitein', 'john@bitein.com', 'John', 'OWNER', 'BRAND_OWNER'),
      ('c0000000-0000-4000-8000-000000000003', 'burgerlab-cloud', 'leo@burgerlab-cloud.com', 'Leo', 'OWNER', 'BRAND_OWNER'),
      ('c0000000-0000-4000-8000-000000000004', 'pizzain', 'sam@pizzain.com', 'Sam', 'OWNER', 'BRAND_OWNER'),
      ('c0000000-0000-4000-8000-000000000005', 'pizzain', 'mia@pizzain.com', 'Mia', 'MANAGER', 'BRANCH_MANAGER'),
      ('c0000000-0000-4000-8000-000000000006', 'pizzain', 'ella@pizzain.com', 'Ella', 'ORDER_TAKER', 'CASHIER'),
      ('c0000000-0000-4000-8000-000000000007', 'pizza-hut', 'tom@pizza-hut.com', 'Tom', 'OWNER', 'BRAND_OWNER'),
      ('c0000000-0000-4000-8000-000000000008', 'pizza-hut', 'max@pizza-hut.com', 'Max', 'ADMIN', 'OPERATIONAL_MANAGER'),
      ('c0000000-0000-4000-8000-000000000009', 'pizza-hut', 'ben@pizza-hut.com', 'Ben', 'MANAGER', 'BRANCH_MANAGER'),
      ('c0000000-0000-4000-8000-000000000010', 'pizza-hut', 'amy@pizza-hut.com', 'Amy', 'ORDER_TAKER', 'CASHIER')
  ) AS staff_def (staff_id, brand_handle, email, staff_name, tenant_role, pbac_role)
  JOIN "Restaurant" r ON r."handle" = staff_def.brand_handle
  JOIN "StaffRole" sr ON sr."restaurantId" = r."id"
  AND sr."name" = staff_def.pbac_role
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
  assign_def.staff_id::UUID,
  assign_def.branch_id::UUID,
  rs."roleId",
  '{}'::TEXT[],
  assign_def.is_primary,
  pg_temp.seed_actor(),
  pg_temp.seed_actor()
FROM
  (
    VALUES
      ('c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', TRUE),
      ('c0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002', TRUE),
      ('c0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000003', TRUE),
      ('c0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000004', TRUE),
      ('c0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000005', FALSE),
      ('c0000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000004', TRUE),
      ('c0000000-0000-4000-8000-000000000006', 'b0000000-0000-4000-8000-000000000005', TRUE),
      ('c0000000-0000-4000-8000-000000000007', 'b0000000-0000-4000-8000-000000000006', TRUE),
      ('c0000000-0000-4000-8000-000000000007', 'b0000000-0000-4000-8000-000000000007', FALSE),
      ('c0000000-0000-4000-8000-000000000007', 'b0000000-0000-4000-8000-000000000008', FALSE),
      ('c0000000-0000-4000-8000-000000000008', 'b0000000-0000-4000-8000-000000000006', TRUE),
      ('c0000000-0000-4000-8000-000000000008', 'b0000000-0000-4000-8000-000000000007', FALSE),
      ('c0000000-0000-4000-8000-000000000009', 'b0000000-0000-4000-8000-000000000007', TRUE),
      ('c0000000-0000-4000-8000-000000000010', 'b0000000-0000-4000-8000-000000000006', TRUE)
  ) AS assign_def (staff_id, branch_id, is_primary)
  JOIN "RestaurantStaff" rs ON rs."id" = assign_def.staff_id::UUID
ON CONFLICT DO NOTHING;
