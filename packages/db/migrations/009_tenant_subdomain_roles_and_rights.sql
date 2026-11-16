-- 1. ADD UNIQUE SUBDOMAIN TO RESTAURANT (e.g., ://fapp.com, ://fapp.com)
ALTER TABLE "Restaurant"
ADD COLUMN IF NOT EXISTS "subdomain" TEXT;

UPDATE "Restaurant"
SET
  "subdomain" = lower(
    regexp_replace(trim("name"), '[^a-zA-Z0-9]+', '-', 'g')
  ) || '-' || right("id"::TEXT, 4)
WHERE
  "subdomain" IS NULL;

ALTER TABLE "Restaurant"
ALTER COLUMN "subdomain"
SET
  NOT NULL;

ALTER TABLE "Restaurant"
DROP CONSTRAINT IF EXISTS uq_restaurant_subdomain;

ALTER TABLE "Restaurant"
ADD CONSTRAINT uq_restaurant_subdomain UNIQUE ("subdomain");

CREATE INDEX IF NOT EXISTS idx_restaurant_subdomain_active ON "Restaurant" ("subdomain")
WHERE
  "deletedAt" IS NULL;

-- 2. CREATE NORMALIZED STAFF ROLES & RIGHTS (PBAC) TABLES
CREATE TABLE IF NOT EXISTS "StaffRole" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
  "restaurantId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "isSystemRole" BOOLEAN NOT NULL DEFAULT FALSE,
  "rowVersion" INT NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" UUID,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedBy" UUID,
  "deletedAt" TIMESTAMP,
  "deletedBy" UUID
);

ALTER TABLE "StaffRole"
DROP CONSTRAINT IF EXISTS fk_staffrole_restaurant;

ALTER TABLE "StaffRole"
ADD CONSTRAINT fk_staffrole_restaurant FOREIGN KEY ("restaurantId") REFERENCES "Restaurant" ("id") ON DELETE CASCADE NOT VALID;

ALTER TABLE "StaffRole" VALIDATE CONSTRAINT fk_staffrole_restaurant;

CREATE UNIQUE INDEX IF NOT EXISTS uq_staffrole_restaurant_name_active ON "StaffRole" ("restaurantId", "name")
WHERE
  "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS idx_staffrole_active ON "StaffRole" ("deletedAt")
WHERE
  "deletedAt" IS NULL;
CREATE TABLE IF NOT EXISTS "StaffRolePermission" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
  "staffRoleId" UUID NOT NULL,
  "permission" TEXT NOT NULL,
  "rowVersion" INT NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" UUID,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedBy" UUID,
  "deletedAt" TIMESTAMP,
  "deletedBy" UUID
);

ALTER TABLE "StaffRolePermission"
DROP CONSTRAINT IF EXISTS fk_staffroleperm_role;

ALTER TABLE "StaffRolePermission"
ADD CONSTRAINT fk_staffroleperm_role FOREIGN KEY ("staffRoleId") REFERENCES "StaffRole" ("id") ON DELETE CASCADE NOT VALID;

ALTER TABLE "StaffRolePermission" VALIDATE CONSTRAINT fk_staffroleperm_role;

CREATE UNIQUE INDEX IF NOT EXISTS uq_staffroleperm_role_perm_active ON "StaffRolePermission" ("staffRoleId", "permission")
WHERE
  "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS idx_staffroleperm_active ON "StaffRolePermission" ("deletedAt")
WHERE
  "deletedAt" IS NULL;

-- 3. LINK RESTAURANT STAFF TO DYNAMIC STAFF ROLE ID
ALTER TABLE "RestaurantStaff"
ADD COLUMN IF NOT EXISTS "roleId" UUID;

ALTER TABLE "RestaurantStaff"
DROP CONSTRAINT IF EXISTS fk_staff_staffrole;

ALTER TABLE "RestaurantStaff"
ADD CONSTRAINT fk_staff_staffrole FOREIGN KEY ("roleId") REFERENCES "StaffRole" ("id") ON DELETE RESTRICT NOT VALID;

ALTER TABLE "RestaurantStaff" VALIDATE CONSTRAINT fk_staff_staffrole;

CREATE INDEX IF NOT EXISTS idx_restaurantstaff_roleid ON "RestaurantStaff" ("roleId")
WHERE
  "deletedAt" IS NULL;
