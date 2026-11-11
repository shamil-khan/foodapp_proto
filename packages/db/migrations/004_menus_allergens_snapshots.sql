DROP TYPE IF EXISTS "KdsRoutingTarget" CASCADE;


CREATE TYPE "KdsRoutingTarget" AS ENUM(
  'KITCHEN_SCREEN',
  'BAR_PRINTER',
  'PASTRY_STATION'
);


CREATE TABLE IF NOT EXISTS "Category" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
  "restaurantId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "sortWeight" INT NOT NULL DEFAULT 0
);


CREATE TABLE IF NOT EXISTS "MenuItem" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
  "categoryId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "basePrice" NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  "vatRate" NUMERIC(5, 2) NOT NULL DEFAULT 20.00,
  "allergenFlags" TEXT[] DEFAULT '{}',
  "kdsTarget" "KdsRoutingTarget" NOT NULL DEFAULT 'KITCHEN_SCREEN',
  "imageUrl" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE
);


UPDATE "MenuItem"
SET
  "basePrice" = 0.00
WHERE
  "basePrice" IS NULL;


ALTER TABLE "MenuItem"
ADD COLUMN IF NOT EXISTS "vatRate" NUMERIC(5, 2) NOT NULL DEFAULT 20.00;


ALTER TABLE "MenuItem"
ADD COLUMN IF NOT EXISTS "allergenFlags" TEXT[] DEFAULT '{}';


ALTER TABLE "MenuItem"
ADD COLUMN IF NOT EXISTS "kdsTarget" "KdsRoutingTarget" NOT NULL DEFAULT 'KITCHEN_SCREEN';


CREATE TABLE IF NOT EXISTS "ItemModifier" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
  "menuItemId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "extraPrice" NUMERIC(10, 2) NOT NULL DEFAULT 0.00
);


CREATE TABLE IF NOT EXISTS "MenuSnapshot" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
  "restaurantId" UUID UNIQUE NOT NULL,
  "versionHash" TEXT NOT NULL,
  "serializedMenu" JSONB NOT NULL,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE "Category"
DROP CONSTRAINT IF EXISTS fk_cat_restaurant;


ALTER TABLE "Category"
ADD CONSTRAINT fk_cat_restaurant FOREIGN KEY ("restaurantId") REFERENCES "Restaurant" ("id") ON DELETE CASCADE NOT VALID;


ALTER TABLE "Category" VALIDATE CONSTRAINT fk_cat_restaurant;


ALTER TABLE "MenuItem"
DROP CONSTRAINT IF EXISTS fk_item_category;


ALTER TABLE "MenuItem"
ADD CONSTRAINT fk_item_category FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE CASCADE NOT VALID;


ALTER TABLE "MenuItem" VALIDATE CONSTRAINT fk_item_category;


ALTER TABLE "ItemModifier"
DROP CONSTRAINT IF EXISTS fk_mod_item;


ALTER TABLE "ItemModifier"
ADD CONSTRAINT fk_mod_item FOREIGN KEY ("menuItemId") REFERENCES "MenuItem" ("id") ON DELETE CASCADE NOT VALID;


ALTER TABLE "ItemModifier" VALIDATE CONSTRAINT fk_mod_item;


ALTER TABLE "MenuSnapshot"
DROP CONSTRAINT IF EXISTS fk_snap_restaurant;


ALTER TABLE "MenuSnapshot"
ADD CONSTRAINT fk_snap_restaurant FOREIGN KEY ("restaurantId") REFERENCES "Restaurant" ("id") ON DELETE CASCADE NOT VALID;


ALTER TABLE "MenuSnapshot" VALIDATE CONSTRAINT fk_snap_restaurant;
