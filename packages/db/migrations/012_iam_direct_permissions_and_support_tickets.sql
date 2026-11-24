-- 1. ENUMS FOR POLICY-BASED DIRECT PERMISSIONS & BRAND-AUTHORIZED JIT SUPPORT TICKETS
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PermissionEffect') THEN
    CREATE TYPE "PermissionEffect" AS ENUM ('ALLOW', 'DENY');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SupportTicketStatus') THEN
    CREATE TYPE "SupportTicketStatus" AS ENUM (
      'PENDING_APPROVAL',
      'APPROVED',
      'REVOKED',
      'EXPIRED'
    );
  END IF;
END $$;


-- 2. NORMALIZED STAFF DIRECT PERMISSIONS (REPLACES FLAT directPermissions TEXT[])
ALTER TABLE "StaffBranchAssignment"
DROP COLUMN IF EXISTS "directPermissions";


CREATE TABLE IF NOT EXISTS "StaffDirectPermission" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
  "staffId" UUID NOT NULL,
  "branchId" UUID NOT NULL,
  "permission" TEXT NOT NULL,
  "effect" "PermissionEffect" NOT NULL DEFAULT 'ALLOW',
  "reason" TEXT,
  "validFrom" TIMESTAMP,
  "expiresAt" TIMESTAMP,
  "rowVersion" INT NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" UUID,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedBy" UUID,
  "deletedAt" TIMESTAMP,
  "deletedBy" UUID
);


ALTER TABLE "StaffDirectPermission"
DROP CONSTRAINT IF EXISTS fk_sdp_staff;


ALTER TABLE "StaffDirectPermission"
ADD CONSTRAINT fk_sdp_staff FOREIGN KEY ("staffId") REFERENCES "RestaurantStaff" ("id") ON DELETE CASCADE NOT VALID;


ALTER TABLE "StaffDirectPermission" VALIDATE CONSTRAINT fk_sdp_staff;


ALTER TABLE "StaffDirectPermission"
DROP CONSTRAINT IF EXISTS fk_sdp_branch;


ALTER TABLE "StaffDirectPermission"
ADD CONSTRAINT fk_sdp_branch FOREIGN KEY ("branchId") REFERENCES "RestaurantBranch" ("id") ON DELETE CASCADE NOT VALID;


ALTER TABLE "StaffDirectPermission" VALIDATE CONSTRAINT fk_sdp_branch;


CREATE UNIQUE INDEX IF NOT EXISTS uq_sdp_staff_branch_perm_active ON "StaffDirectPermission" ("staffId", "branchId", "permission")
WHERE
  "deletedAt" IS NULL;


CREATE INDEX IF NOT EXISTS idx_sdp_staff_branch_active ON "StaffDirectPermission" ("staffId", "branchId")
WHERE
  "deletedAt" IS NULL;


-- 3. BRAND-AUTHORIZED JIT SUPPORT TICKETS & IMMUTABLE AUDIT LOGS
CREATE TABLE IF NOT EXISTS "SupportTicket" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
  "restaurantId" UUID NOT NULL,
  "branchId" UUID,
  "requestedByStaffId" UUID NOT NULL,
  "approvedByStaffId" UUID,
  "approvedAt" TIMESTAMP,
  "assignedPlatformUserId" UUID,
  "scopePermission" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "attachmentUrl" TEXT,
  "attachmentNote" TEXT,
  "status" "SupportTicketStatus" NOT NULL DEFAULT 'APPROVED',
  "expiresAt" TIMESTAMP NOT NULL,
  "revokedByStaffId" UUID,
  "revokedAt" TIMESTAMP,
  "rowVersion" INT NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" UUID,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedBy" UUID,
  "deletedAt" TIMESTAMP,
  "deletedBy" UUID
);


ALTER TABLE "SupportTicket"
DROP CONSTRAINT IF EXISTS fk_st_restaurant;


ALTER TABLE "SupportTicket"
ADD CONSTRAINT fk_st_restaurant FOREIGN KEY ("restaurantId") REFERENCES "Restaurant" ("id") ON DELETE CASCADE NOT VALID;


ALTER TABLE "SupportTicket" VALIDATE CONSTRAINT fk_st_restaurant;


ALTER TABLE "SupportTicket"
DROP CONSTRAINT IF EXISTS fk_st_branch;


ALTER TABLE "SupportTicket"
ADD CONSTRAINT fk_st_branch FOREIGN KEY ("branchId") REFERENCES "RestaurantBranch" ("id") ON DELETE CASCADE NOT VALID;


ALTER TABLE "SupportTicket" VALIDATE CONSTRAINT fk_st_branch;


CREATE INDEX IF NOT EXISTS idx_support_ticket_restaurant_status ON "SupportTicket" ("restaurantId", "status", "expiresAt")
WHERE
  "deletedAt" IS NULL;


CREATE TABLE IF NOT EXISTS "SupportTicketAuditLog" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
  "ticketId" UUID NOT NULL,
  "restaurantId" UUID NOT NULL,
  "branchId" UUID,
  "platformUserId" UUID NOT NULL,
  "scopePermission" TEXT NOT NULL,
  "httpMethod" TEXT NOT NULL,
  "httpPath" TEXT NOT NULL,
  "targetResourceId" TEXT,
  "occurredAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE "SupportTicketAuditLog"
DROP CONSTRAINT IF EXISTS fk_stal_ticket;


ALTER TABLE "SupportTicketAuditLog"
ADD CONSTRAINT fk_stal_ticket FOREIGN KEY ("ticketId") REFERENCES "SupportTicket" ("id") ON DELETE CASCADE NOT VALID;


ALTER TABLE "SupportTicketAuditLog" VALIDATE CONSTRAINT fk_stal_ticket;


CREATE INDEX IF NOT EXISTS idx_support_audit_ticket ON "SupportTicketAuditLog" ("ticketId", "occurredAt" DESC);
