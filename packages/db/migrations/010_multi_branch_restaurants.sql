-- 1. CREATE NEW ENUMS FOR MULTI-BRANCH, HOME/CLOUD KITCHENS & PRICING WORKFLOWS
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'KitchenType') THEN
    CREATE TYPE "KitchenType" AS ENUM (
      'RESTAURANT_BRANCH',
      'HOME_KITCHEN',
      'CLOUD_KITCHEN'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OperationalStatus') THEN
    CREATE TYPE "OperationalStatus" AS ENUM (
      'OPEN',
      'BUSY_PAUSED',
      'CLOSED',
      'HOLIDAY'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MenuPricingPolicyMode') THEN
    CREATE TYPE "MenuPricingPolicyMode" AS ENUM (
      'CENTRAL_LOCKED',
      'BRANCH_DIRECT',
      'BRANCH_APPROVAL_REQUIRED',
      'THRESHOLD_HYBRID'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MenuSelectionMode') THEN
    CREATE TYPE "MenuSelectionMode" AS ENUM (
      'ALL_BRAND_ITEMS',
      'SELECTED_ITEMS_ONLY'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'HomePickupPrivacyMode') THEN
    CREATE TYPE "HomePickupPrivacyMode" AS ENUM (
      'ORDER_ACCEPTANCE',
      'WHITELIST'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PriceApprovalStatus') THEN
    CREATE TYPE "PriceApprovalStatus" AS ENUM (
      'NONE',
      'PENDING',
      'APPROVED',
      'REJECTED'
    );
  END IF;
END $$;


-- 2. EVOLVE "Restaurant" INTO BRAND / CREATOR ENTITY (REMOVE subdomain COMPLETELY)
ALTER TABLE "Restaurant"
DROP CONSTRAINT IF EXISTS uq_restaurant_subdomain;

DROP INDEX IF EXISTS idx_restaurant_subdomain_active;

ALTER TABLE "Restaurant"
DROP COLUMN IF EXISTS "subdomain";

ALTER TABLE "Restaurant"
ADD COLUMN IF NOT EXISTS "handle" TEXT,
ADD COLUMN IF NOT EXISTS "logoUrl" TEXT,
ADD COLUMN IF NOT EXISTS "description" TEXT;

UPDATE "Restaurant"
SET
  "handle" = lower(
    regexp_replace(trim("name"), '[^a-zA-Z0-9]+', '-', 'g')
  ) || '-' || right("id"::TEXT, 4)
WHERE
  "handle" IS NULL;

ALTER TABLE "Restaurant"
ALTER COLUMN "handle"
SET NOT NULL;

ALTER TABLE "Restaurant"
DROP CONSTRAINT IF EXISTS uq_restaurant_handle;

ALTER TABLE "Restaurant"
ADD CONSTRAINT uq_restaurant_handle UNIQUE ("handle");

CREATE INDEX IF NOT EXISTS idx_restaurant_handle_active ON "Restaurant" ("handle")
WHERE
  "deletedAt" IS NULL;


-- 3. EVOLVE "RestaurantLayout" TO SUPPORT GALLERY IMAGES WITHOUT DUPLICATION
ALTER TABLE "RestaurantLayout"
ADD COLUMN IF NOT EXISTS "galleryImages" JSONB NOT NULL DEFAULT '[]';

-- 4. CREATE "RestaurantBranch" (PHYSICAL LOCATION: RESTAURANT, HOME KITCHEN, OR CLOUD KITCHEN)
CREATE TABLE IF NOT EXISTS "RestaurantBranch" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
  "restaurantId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "branchKey" TEXT NOT NULL,
  "city" TEXT NOT NULL,
  "cityKey" TEXT NOT NULL,
  "kitchenType" "KitchenType" NOT NULL DEFAULT 'RESTAURANT_BRANCH',
  "postcodeSector" TEXT NOT NULL DEFAULT 'SW1A',
  "streetAddress" TEXT NOT NULL,
  "areaLocality" TEXT,
  "latitude" NUMERIC(9, 6),
  "longitude" NUMERIC(9, 6),
  "contactPersonName" TEXT NOT NULL,
  "contactPersonPhone" TEXT NOT NULL,
  "contactPersonEmail" TEXT,
  "supportsDineIn" BOOLEAN NOT NULL DEFAULT TRUE,
  "supportsTakeaway" BOOLEAN NOT NULL DEFAULT TRUE,
  "supportsPlatformDelivery" BOOLEAN NOT NULL DEFAULT TRUE,
  "operationalStatus" "OperationalStatus" NOT NULL DEFAULT 'OPEN',
  "statusLockedUntil" TIMESTAMP,
  "statusReason" TEXT,
  "scheduleConfig" JSONB NOT NULL DEFAULT '{"weekly":{},"overrides":[]}',
  "homePickupPrivacyMode" "HomePickupPrivacyMode" NOT NULL DEFAULT 'ORDER_ACCEPTANCE',
  "dropPointConfig" JSONB,
  "approvedTakeawayUserIds" JSONB NOT NULL DEFAULT '[]',
  "menuSelectionMode" "MenuSelectionMode" NOT NULL DEFAULT 'ALL_BRAND_ITEMS',
  "averagePrepTimeMinutes" INT NOT NULL DEFAULT 15,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "rowVersion" INT NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" UUID,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedBy" UUID,
  "deletedAt" TIMESTAMP,
  "deletedBy" UUID
);

ALTER TABLE "RestaurantBranch"
DROP CONSTRAINT IF EXISTS fk_branch_restaurant;

ALTER TABLE "RestaurantBranch"
ADD CONSTRAINT fk_branch_restaurant FOREIGN KEY ("restaurantId") REFERENCES "Restaurant" ("id") ON DELETE CASCADE NOT VALID;

ALTER TABLE "RestaurantBranch" VALIDATE CONSTRAINT fk_branch_restaurant;

CREATE UNIQUE INDEX IF NOT EXISTS uq_branch_restaurant_city_branch_active ON "RestaurantBranch" ("restaurantId", "cityKey", "branchKey")
WHERE
  "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS idx_branch_restaurant_city_active ON "RestaurantBranch" ("restaurantId", "cityKey")
WHERE
  "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS idx_branch_postcode_active ON "RestaurantBranch" ("postcodeSector")
WHERE
  "deletedAt" IS NULL;


-- 5. DEDICATED "PricingPolicy" TABLE (BRAND DEFAULT + OPTIONAL BRANCH OVERRIDE)
CREATE TABLE IF NOT EXISTS "PricingPolicy" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
  "restaurantId" UUID NOT NULL,
  "branchId" UUID,
  "menuPricingMode" "MenuPricingPolicyMode" NOT NULL DEFAULT 'CENTRAL_LOCKED',
  "maxDirectPriceDeltaPercent" NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
  "allowBranchLocalItems" BOOLEAN NOT NULL DEFAULT FALSE,
  "maxDirectOrderDiscountPercent" NUMERIC(5, 2) NOT NULL DEFAULT 10.00,
  "allowFullCompWaiveOff" BOOLEAN NOT NULL DEFAULT FALSE,
  "requireReasonForCompOrDiscount" BOOLEAN NOT NULL DEFAULT TRUE,
  "maxDirectRefundAmount" NUMERIC(10, 2) NOT NULL DEFAULT 25.00,
  "rowVersion" INT NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" UUID,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedBy" UUID,
  "deletedAt" TIMESTAMP,
  "deletedBy" UUID
);

ALTER TABLE "PricingPolicy"
DROP CONSTRAINT IF EXISTS fk_pricing_restaurant;

ALTER TABLE "PricingPolicy"
ADD CONSTRAINT fk_pricing_restaurant FOREIGN KEY ("restaurantId") REFERENCES "Restaurant" ("id") ON DELETE CASCADE NOT VALID;

ALTER TABLE "PricingPolicy" VALIDATE CONSTRAINT fk_pricing_restaurant;

ALTER TABLE "PricingPolicy"
DROP CONSTRAINT IF EXISTS fk_pricing_branch;

ALTER TABLE "PricingPolicy"
ADD CONSTRAINT fk_pricing_branch FOREIGN KEY ("branchId") REFERENCES "RestaurantBranch" ("id") ON DELETE CASCADE NOT VALID;

ALTER TABLE "PricingPolicy" VALIDATE CONSTRAINT fk_pricing_branch;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pricing_brand_default_active ON "PricingPolicy" ("restaurantId")
WHERE
  "branchId" IS NULL
  AND "deletedAt" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pricing_branch_override_active ON "PricingPolicy" ("branchId")
WHERE
  "branchId" IS NOT NULL
  AND "deletedAt" IS NULL;

-- 6. MENU ITEM INGREDIENT HASHTAGS, OPTIONAL BRANCH-LOCAL ITEMS & BRANCH MENU OVERRIDES
ALTER TABLE "MenuItem"
ADD COLUMN IF NOT EXISTS "branchId" UUID,
ADD COLUMN IF NOT EXISTS "ingredientTags" TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE "MenuItem"
DROP CONSTRAINT IF EXISTS fk_menuitem_branch;

ALTER TABLE "MenuItem"
ADD CONSTRAINT fk_menuitem_branch FOREIGN KEY ("branchId") REFERENCES "RestaurantBranch" ("id") ON DELETE CASCADE NOT VALID;

ALTER TABLE "MenuItem" VALIDATE CONSTRAINT fk_menuitem_branch;

CREATE INDEX IF NOT EXISTS idx_menuitem_ingredient_tags ON "MenuItem" USING GIN ("ingredientTags");

CREATE TABLE IF NOT EXISTS "BranchMenuOverride" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
  "branchId" UUID NOT NULL,
  "menuItemId" UUID NOT NULL,
  "isIncluded" BOOLEAN NOT NULL DEFAULT TRUE,
  "isAvailable" BOOLEAN NOT NULL DEFAULT TRUE,
  "priceOverride" NUMERIC(10, 2),
  "pendingPriceOverride" NUMERIC(10, 2),
  "approvalStatus" "PriceApprovalStatus" NOT NULL DEFAULT 'NONE',
  "requestedByStaffId" UUID,
  "reviewedByStaffId" UUID,
  "reviewNote" TEXT,
  "rowVersion" INT NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" UUID,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedBy" UUID,
  "deletedAt" TIMESTAMP,
  "deletedBy" UUID
);

ALTER TABLE "BranchMenuOverride"
DROP CONSTRAINT IF EXISTS fk_bmo_branch;

ALTER TABLE "BranchMenuOverride"
ADD CONSTRAINT fk_bmo_branch FOREIGN KEY ("branchId") REFERENCES "RestaurantBranch" ("id") ON DELETE CASCADE NOT VALID;

ALTER TABLE "BranchMenuOverride" VALIDATE CONSTRAINT fk_bmo_branch;

ALTER TABLE "BranchMenuOverride"
DROP CONSTRAINT IF EXISTS fk_bmo_menuitem;

ALTER TABLE "BranchMenuOverride"
ADD CONSTRAINT fk_bmo_menuitem FOREIGN KEY ("menuItemId") REFERENCES "MenuItem" ("id") ON DELETE CASCADE NOT VALID;

ALTER TABLE "BranchMenuOverride" VALIDATE CONSTRAINT fk_bmo_menuitem;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bmo_branch_item_active ON "BranchMenuOverride" ("branchId", "menuItemId")
WHERE
  "deletedAt" IS NULL;


-- 7. MULTI-BRANCH STAFF ASSIGNMENTS & PER-BRANCH DIRECT PERMISSIONS
CREATE TABLE IF NOT EXISTS "StaffBranchAssignment" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
  "staffId" UUID NOT NULL,
  "branchId" UUID NOT NULL,
  "staffRoleId" UUID NOT NULL,
  "directPermissions" TEXT[] NOT NULL DEFAULT '{}',
  "isPrimary" BOOLEAN NOT NULL DEFAULT FALSE,
  "rowVersion" INT NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" UUID,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedBy" UUID,
  "deletedAt" TIMESTAMP,
  "deletedBy" UUID
);

ALTER TABLE "StaffBranchAssignment"
DROP CONSTRAINT IF EXISTS fk_sba_staff;

ALTER TABLE "StaffBranchAssignment"
ADD CONSTRAINT fk_sba_staff FOREIGN KEY ("staffId") REFERENCES "RestaurantStaff" ("id") ON DELETE CASCADE NOT VALID;

ALTER TABLE "StaffBranchAssignment" VALIDATE CONSTRAINT fk_sba_staff;

ALTER TABLE "StaffBranchAssignment"
DROP CONSTRAINT IF EXISTS fk_sba_branch;

ALTER TABLE "StaffBranchAssignment"
ADD CONSTRAINT fk_sba_branch FOREIGN KEY ("branchId") REFERENCES "RestaurantBranch" ("id") ON DELETE CASCADE NOT VALID;

ALTER TABLE "StaffBranchAssignment" VALIDATE CONSTRAINT fk_sba_branch;

ALTER TABLE "StaffBranchAssignment"
DROP CONSTRAINT IF EXISTS fk_sba_role;

ALTER TABLE "StaffBranchAssignment"
ADD CONSTRAINT fk_sba_role FOREIGN KEY ("staffRoleId") REFERENCES "StaffRole" ("id") ON DELETE RESTRICT NOT VALID;

ALTER TABLE "StaffBranchAssignment" VALIDATE CONSTRAINT fk_sba_role;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sba_staff_branch_active ON "StaffBranchAssignment" ("staffId", "branchId")
WHERE
  "deletedAt" IS NULL;


-- 8. UPDATE BRANCH-SCOPED OPERATIONAL TABLES TO REFERENCE "branchId"
ALTER TABLE "DiningTable"
DROP CONSTRAINT IF EXISTS fk_table_restaurant;

ALTER TABLE "DiningTable"
DROP COLUMN IF EXISTS "restaurantId";

ALTER TABLE "DiningTable"
ADD COLUMN IF NOT EXISTS "branchId" UUID NOT NULL;

ALTER TABLE "DiningTable"
ADD CONSTRAINT fk_table_branch FOREIGN KEY ("branchId") REFERENCES "RestaurantBranch" ("id") ON DELETE CASCADE NOT VALID;

ALTER TABLE "DiningTable" VALIDATE CONSTRAINT fk_table_branch;

ALTER TABLE "MenuSnapshot"
DROP CONSTRAINT IF EXISTS fk_snap_restaurant;

ALTER TABLE "MenuSnapshot"
DROP COLUMN IF EXISTS "restaurantId";

ALTER TABLE "MenuSnapshot"
ADD COLUMN IF NOT EXISTS "branchId" UUID UNIQUE NOT NULL;

ALTER TABLE "MenuSnapshot"
ADD CONSTRAINT fk_snap_branch FOREIGN KEY ("branchId") REFERENCES "RestaurantBranch" ("id") ON DELETE CASCADE NOT VALID;

ALTER TABLE "MenuSnapshot" VALIDATE CONSTRAINT fk_snap_branch;

ALTER TABLE "Order"
DROP CONSTRAINT IF EXISTS fk_order_restaurant;

ALTER TABLE "Order"
DROP COLUMN IF EXISTS "restaurantId";

ALTER TABLE "Order"
ADD COLUMN IF NOT EXISTS "branchId" UUID NOT NULL;

ALTER TABLE "Order"
ADD CONSTRAINT fk_order_branch FOREIGN KEY ("branchId") REFERENCES "RestaurantBranch" ("id") NOT VALID;

ALTER TABLE "Order" VALIDATE CONSTRAINT fk_order_branch;

ALTER TABLE "LoyaltyLedger"
DROP COLUMN IF EXISTS "restaurantId";

ALTER TABLE "LoyaltyLedger"
ADD COLUMN IF NOT EXISTS "branchId" UUID;
