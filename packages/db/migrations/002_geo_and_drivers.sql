CREATE TABLE IF NOT EXISTS "UserAddress" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
  "userId" UUID NOT NULL,
  "label" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "postcodeSector" TEXT NOT NULL DEFAULT 'EC1A',
  "latitude" NUMERIC(9, 6) NOT NULL,
  "longitude" NUMERIC(9, 6) NOT NULL
);


ALTER TABLE "UserAddress"
ADD COLUMN IF NOT EXISTS "postcodeSector" TEXT NOT NULL DEFAULT 'EC1A';


CREATE TABLE IF NOT EXISTS "DriverProfile" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
  "userId" UUID UNIQUE NOT NULL,
  "licenseNo" TEXT NOT NULL,
  "vehicleType" TEXT NOT NULL,
  "isAvailable" BOOLEAN NOT NULL DEFAULT FALSE,
  "activePostcodeSectors" TEXT[] DEFAULT '{}',
  "currentLat" NUMERIC(9, 6),
  "currentLng" NUMERIC(9, 6)
);


ALTER TABLE "UserAddress"
DROP CONSTRAINT IF EXISTS fk_address_user;


ALTER TABLE "UserAddress"
ADD CONSTRAINT fk_address_user FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE NOT VALID;


ALTER TABLE "UserAddress" VALIDATE CONSTRAINT fk_address_user;


ALTER TABLE "DriverProfile"
DROP CONSTRAINT IF EXISTS fk_driver_user;


ALTER TABLE "DriverProfile"
ADD CONSTRAINT fk_driver_user FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE NOT VALID;


ALTER TABLE "DriverProfile" VALIDATE CONSTRAINT fk_driver_user;
