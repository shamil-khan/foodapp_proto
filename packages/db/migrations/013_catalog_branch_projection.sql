-- FILE: packages/db/migrations/013_catalog_branch_projection.sql
-- 1. LOCAL READ-MODEL PROJECTION FOR CATALOG SNAPSHOT COMPILATION (ZERO CROSS-CONTEXT READS)
CREATE TABLE IF NOT EXISTS "CatalogBranchProjection" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
  "branchId" UUID UNIQUE NOT NULL,
  "restaurantId" UUID NOT NULL,
  "brandName" TEXT NOT NULL,
  "branchName" TEXT NOT NULL,
  "postcodeSector" TEXT NOT NULL DEFAULT 'SW1A',
  "menuSelectionMode" "MenuSelectionMode" NOT NULL DEFAULT 'ALL_BRAND_ITEMS',
  "rowVersion" INT NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" UUID,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedBy" UUID,
  "deletedAt" TIMESTAMP,
  "deletedBy" UUID
);


CREATE INDEX IF NOT EXISTS idx_catalog_branch_proj_restaurant ON "CatalogBranchProjection" ("restaurantId")
WHERE
  "deletedAt" IS NULL;


-- 2. BACKFILL EXISTING SEEDED / ACTIVE BRANCHES INTO CATALOG READ PROJECTION
INSERT INTO
  "CatalogBranchProjection" (
    "branchId",
    "restaurantId",
    "brandName",
    "branchName",
    "postcodeSector",
    "menuSelectionMode",
    "createdBy",
    "updatedBy"
  )
SELECT
  b."id",
  b."restaurantId",
  r."name",
  b."name",
  b."postcodeSector",
  b."menuSelectionMode",
  b."createdBy",
  b."updatedBy"
FROM
  "RestaurantBranch" b
  JOIN "Restaurant" r ON r."id" = b."restaurantId"
WHERE
  b."deletedAt" IS NULL
  AND r."deletedAt" IS NULL
ON CONFLICT ("branchId") DO NOTHING;
