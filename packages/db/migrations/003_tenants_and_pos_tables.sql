DROP TYPE IF EXISTS "TenantRole" CASCADE;


CREATE TYPE "TenantRole" AS ENUM(
  'OWNER',
  'ADMIN',
  'MANAGER',
  'ORDER_TAKER'
);


DROP TYPE IF EXISTS "PaymentPolicy" CASCADE;


CREATE TYPE "PaymentPolicy" AS ENUM(
  'INSTANT_SPLIT',
  'CENTRAL_ESCROW',
  'CASH_FOCUS'
);


CREATE TABLE IF NOT EXISTS "Restaurant" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
  "name" TEXT NOT NULL,
  "vatNumber" TEXT,
  "companyHouseNumber" TEXT,
  "foodHygieneRating" INT DEFAULT 5 CHECK (
    "foodHygieneRating" >= 0
    AND "foodHygieneRating" <= 5
  ),
  "postcodeSector" TEXT NOT NULL DEFAULT 'SW1A',
  "averagePrepTimeMinutes" INT NOT NULL DEFAULT 15,
  "payoutFrequency" TEXT NOT NULL DEFAULT 'WEEKLY',
  "isActiveOverride" BOOLEAN NOT NULL DEFAULT TRUE,
  "platformFeeRate" NUMERIC(5, 2) NOT NULL DEFAULT 15.00,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE "Restaurant"
ADD COLUMN IF NOT EXISTS "vatNumber" TEXT;


ALTER TABLE "Restaurant"
ADD COLUMN IF NOT EXISTS "companyHouseNumber" TEXT;


ALTER TABLE "Restaurant"
ADD COLUMN IF NOT EXISTS "foodHygieneRating" INT DEFAULT 5;


ALTER TABLE "Restaurant"
ADD COLUMN IF NOT EXISTS "postcodeSector" TEXT NOT NULL DEFAULT 'SW1A';


ALTER TABLE "Restaurant"
ADD COLUMN IF NOT EXISTS "averagePrepTimeMinutes" INT NOT NULL DEFAULT 15;


ALTER TABLE "Restaurant"
ADD COLUMN IF NOT EXISTS "payoutFrequency" TEXT NOT NULL DEFAULT 'WEEKLY';


ALTER TABLE "Restaurant"
ADD COLUMN IF NOT EXISTS "isActiveOverride" BOOLEAN NOT NULL DEFAULT TRUE;


CREATE TABLE IF NOT EXISTS "RestaurantLayout" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
  "restaurantId" UUID UNIQUE NOT NULL,
  "templateId" TEXT NOT NULL,
  "primaryColor" TEXT NOT NULL DEFAULT '#FF5733',
  "bannerUrl" TEXT,
  "customConfig" JSONB NOT NULL DEFAULT '{}'
);


CREATE TABLE IF NOT EXISTS "PaymentConfig" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
  "restaurantId" UUID UNIQUE NOT NULL,
  "routingPolicy" "PaymentPolicy" NOT NULL DEFAULT 'CENTRAL_ESCROW',
  "merchantToken" TEXT
);


CREATE TABLE IF NOT EXISTS "RestaurantStaff" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
  "restaurantId" UUID NOT NULL,
  "email" TEXT UNIQUE NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "role" "TenantRole" NOT NULL DEFAULT 'ORDER_TAKER',
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE IF NOT EXISTS "DiningTable" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
  "restaurantId" UUID NOT NULL,
  "tableNumber" TEXT NOT NULL,
  "zoneName" TEXT NOT NULL DEFAULT 'Main Hall',
  "seatCapacity" INT NOT NULL DEFAULT 4,
  "activeQrSessionToken" TEXT UNIQUE,
  "isOccupied" BOOLEAN NOT NULL DEFAULT FALSE
);


ALTER TABLE "RestaurantLayout"
DROP CONSTRAINT IF EXISTS fk_layout_restaurant;


ALTER TABLE "RestaurantLayout"
ADD CONSTRAINT fk_layout_restaurant FOREIGN KEY ("restaurantId") REFERENCES "Restaurant" ("id") ON DELETE CASCADE NOT VALID;


ALTER TABLE "RestaurantLayout" VALIDATE CONSTRAINT fk_layout_restaurant;


ALTER TABLE "PaymentConfig"
DROP CONSTRAINT IF EXISTS fk_payment_restaurant;


ALTER TABLE "PaymentConfig"
ADD CONSTRAINT fk_payment_restaurant FOREIGN KEY ("restaurantId") REFERENCES "Restaurant" ("id") ON DELETE CASCADE NOT VALID;


ALTER TABLE "PaymentConfig" VALIDATE CONSTRAINT fk_payment_restaurant;


ALTER TABLE "RestaurantStaff"
DROP CONSTRAINT IF EXISTS fk_staff_restaurant;


ALTER TABLE "RestaurantStaff"
ADD CONSTRAINT fk_staff_restaurant FOREIGN KEY ("restaurantId") REFERENCES "Restaurant" ("id") ON DELETE CASCADE NOT VALID;


ALTER TABLE "RestaurantStaff" VALIDATE CONSTRAINT fk_staff_restaurant;


ALTER TABLE "DiningTable"
DROP CONSTRAINT IF EXISTS fk_table_restaurant;


ALTER TABLE "DiningTable"
ADD CONSTRAINT fk_table_restaurant FOREIGN KEY ("restaurantId") REFERENCES "Restaurant" ("id") ON DELETE CASCADE NOT VALID;


ALTER TABLE "DiningTable" VALIDATE CONSTRAINT fk_table_restaurant;
