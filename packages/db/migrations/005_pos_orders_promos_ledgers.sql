DROP TYPE IF EXISTS "OrderSource" CASCADE;


CREATE TYPE "OrderSource" AS ENUM(
  'DINE_IN',
  'TAKEAWAY',
  'ONLINE_DELIVERY'
);


DROP TYPE IF EXISTS "InStorePaymentMethod" CASCADE;


CREATE TYPE "InStorePaymentMethod" AS ENUM(
  'CASH',
  'CARD_TERMINAL',
  'ONLINE_GATEWAY'
);


DROP TYPE IF EXISTS "OrderMilestone" CASCADE;


CREATE TYPE "OrderMilestone" AS ENUM(
  'PLACED',
  'RESTAURANT_ACCEPTED',
  'FOOD_PREPARING',
  'SERVED',
  'READY_FOR_COLLECTION',
  'DRIVER_ASSIGNED',
  'EN_ROUTE',
  'DELIVERED',
  'CANCELLED'
);


DROP TYPE IF EXISTS "OfferStatus" CASCADE;


CREATE TYPE "OfferStatus" AS ENUM(
  'PENDING',
  'ACCEPTED',
  'EXPIRED',
  'REJECTED'
);


DROP TYPE IF EXISTS "DiscountType" CASCADE;


CREATE TYPE "DiscountType" AS ENUM('PERCENTAGE', 'FIXED_AMOUNT');


DROP TYPE IF EXISTS "FundingSource" CASCADE;


CREATE TYPE "FundingSource" AS ENUM(
  'PLATFORM',
  'RESTAURANT',
  'SHARED_SPLIT'
);


DROP TYPE IF EXISTS "LoyaltyTxType" CASCADE;


CREATE TYPE "LoyaltyTxType" AS ENUM('EARNED', 'REDEEMED');


CREATE TABLE IF NOT EXISTS "Order" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
  "restaurantId" UUID NOT NULL,
  "customerId" UUID,
  "diningTableId" UUID,
  "driverId" UUID,
  "orderSource" "OrderSource" NOT NULL DEFAULT 'DINE_IN',
  "paymentMethod" "InStorePaymentMethod" NOT NULL DEFAULT 'CARD_TERMINAL',
  "subtotal" NUMERIC(10, 2) NOT NULL,
  "vatTotal" NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  "deliveryFee" NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  "tipAmount" NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  "totalAmount" NUMERIC(10, 2) NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE IF NOT EXISTS "OrderLineItem" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
  "orderId" UUID NOT NULL,
  "itemName" TEXT NOT NULL,
  "frozenPrice" NUMERIC(10, 2) NOT NULL,
  "quantity" INT NOT NULL
);


CREATE TABLE IF NOT EXISTS "OrderLineModifier" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
  "orderLineItemId" UUID NOT NULL,
  "modifierName" TEXT NOT NULL,
  "frozenPrice" NUMERIC(10, 2) NOT NULL
);


CREATE TABLE IF NOT EXISTS "OrderMilestoneLog" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
  "orderId" UUID NOT NULL,
  "milestone" "OrderMilestone" NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE IF NOT EXISTS "OrderOffer" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
  "orderId" UUID NOT NULL,
  "driverId" UUID NOT NULL,
  "status" "OfferStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE IF NOT EXISTS "Promotion" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
  "restaurantId" UUID,
  "promoCode" TEXT UNIQUE NOT NULL,
  "discountType" "DiscountType" NOT NULL,
  "discountValue" NUMERIC(10, 2) NOT NULL,
  "fundingSource" "FundingSource" NOT NULL,
  "minSubtotal" NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  "maxDiscount" NUMERIC(10, 2),
  "startDate" TIMESTAMP NOT NULL,
  "endDate" TIMESTAMP NOT NULL,
  "userUsageLimit" INT NOT NULL DEFAULT 1
);


CREATE TABLE IF NOT EXISTS "PromotionApplication" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
  "promotionId" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "amountSaved" NUMERIC(10, 2) NOT NULL
);


CREATE TABLE IF NOT EXISTS "LoyaltyLedger" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
  "userId" UUID NOT NULL,
  "restaurantId" UUID,
  "orderId" UUID,
  "txType" "LoyaltyTxType" NOT NULL,
  "pointsDelta" INT NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE IF NOT EXISTS "FinancialLedger" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
  "orderId" UUID NOT NULL,
  "entityName" TEXT NOT NULL,
  "creditAmount" NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  "debitAmount" NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  "description" TEXT,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE "Order"
DROP CONSTRAINT IF EXISTS fk_order_restaurant;


ALTER TABLE "Order"
ADD CONSTRAINT fk_order_restaurant FOREIGN KEY ("restaurantId") REFERENCES "Restaurant" ("id") NOT VALID;


ALTER TABLE "Order" VALIDATE CONSTRAINT fk_order_restaurant;


ALTER TABLE "Order"
DROP CONSTRAINT IF EXISTS fk_order_table;


ALTER TABLE "Order"
ADD CONSTRAINT fk_order_table FOREIGN KEY ("diningTableId") REFERENCES "DiningTable" ("id") ON DELETE SET NULL NOT VALID;


ALTER TABLE "Order" VALIDATE CONSTRAINT fk_order_table;


ALTER TABLE "OrderLineItem"
DROP CONSTRAINT IF EXISTS fk_line_order;


ALTER TABLE "OrderLineItem"
ADD CONSTRAINT fk_line_order FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE NOT VALID;


ALTER TABLE "OrderLineItem" VALIDATE CONSTRAINT fk_line_order;


ALTER TABLE "OrderMilestoneLog"
DROP CONSTRAINT IF EXISTS fk_mile_order;


ALTER TABLE "OrderMilestoneLog"
ADD CONSTRAINT fk_mile_order FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE NOT VALID;


ALTER TABLE "OrderMilestoneLog" VALIDATE CONSTRAINT fk_mile_order;


ALTER TABLE "FinancialLedger"
DROP CONSTRAINT IF EXISTS fk_ledger_order;


ALTER TABLE "FinancialLedger"
ADD CONSTRAINT fk_ledger_order FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE NOT VALID;


ALTER TABLE "FinancialLedger" VALIDATE CONSTRAINT fk_ledger_order;


ALTER TABLE "LoyaltyLedger"
DROP CONSTRAINT IF EXISTS fk_loyalty_user;


ALTER TABLE "LoyaltyLedger"
ADD CONSTRAINT fk_loyalty_user FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE NOT VALID;


ALTER TABLE "LoyaltyLedger" VALIDATE CONSTRAINT fk_loyalty_user;
