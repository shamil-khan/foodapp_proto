import { randomUUID } from 'node:crypto';
import { pgPool, redisClient, SYSTEM_ROLE_DEFINITIONS } from '@foodapp/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rootContainer } from '@/container';
import { AppLogger } from '@/logger';

describe('support.jit-workflow — Brand-Authorized JIT Support Ticket & Audit Trail', () => {
  const restaurantId = 'a0000000-0000-4000-8000-000000000001';
  const branchId = 'b0000000-0000-4000-8000-000000000001';
  const ownerStaffId = 'c0000000-0000-4000-8000-000000000001';
  const platformAdminId = '00000000-0000-4000-8000-000000000001';

  beforeAll(async () => {
    if (!redisClient.isOpen) await redisClient.connect();
  });

  afterAll(async () => {
    if (redisClient.isOpen) await redisClient.quit();
  });

  it('creates approved ticket with catalog menu attachment, audits platform usage, and blocks post-revocation', async () => {
    const ownerScope = rootContainer.createScope({
      request: {
        requestId: randomUUID(),
        actorId: ownerStaffId,
        actorSource: 'POS_STAFF',
        restaurantId,
        branchId,
        permissions: SYSTEM_ROLE_DEFINITIONS.BRAND_OWNER.permissions,
      },
      log: new AppLogger('int-support-owner'),
    });

    const supportRepo = ownerScope.get('supportTicketRepository');
    let ticketId = '';

    try {
      const created = await ownerScope.get('commandBus').dispatch<{
        ok: boolean;
        value?: {
          ticketId: string;
          status: string;
        };
      }>('CreateApprovedSupportTicket', {
        restaurantId,
        branchId,
        assignedPlatformUserId: platformAdminId,
        scopePermission: 'platform:support:catalog-override',
        reason: 'Add-on catalog service: update weekend menu items from photo',
        attachmentUrl: 'https://foodapp.co.uk',
        attachmentNote: 'Please add Lamb Nihari £11.50',
        expiresInHours: 4,
      });

      expect(created.ok).toBe(true);
      if (!created.ok || !created.value) return;
      ticketId = created.value.ticketId;

      const grantRes = await supportRepo.validateAndAuditTicket({
        ticketId,
        platformUserId: platformAdminId,
        requiredScope: 'platform:support:catalog-override',
        expectedRestaurantId: restaurantId,
        expectedBranchId: branchId,
        httpMethod: 'POST',
        httpPath: '/api/brands/pos/items',
        targetResourceId: 'item-new-1',
      });
      expect(grantRes.ok).toBe(true);

      const auditRows = await pgPool.query<{
        count: string;
      }>(`SELECT count(*)::text FROM "SupportTicketAuditLog" WHERE "ticketId" = $1`, [
        ticketId,
      ]);
      expect(Number(auditRows.rows[0]?.count)).toBe(1);

      const revoked = await ownerScope.get('commandBus').dispatch<{
        ok: boolean;
      }>('RevokeSupportTicket', {
        ticketId,
      });
      expect(revoked.ok).toBe(true);

      const afterRevoke = await supportRepo.validateAndAuditTicket({
        ticketId,
        platformUserId: platformAdminId,
        requiredScope: 'platform:support:catalog-override',
        expectedRestaurantId: restaurantId,
        expectedBranchId: branchId,
        httpMethod: 'POST',
        httpPath: '/api/brands/pos/items',
      });
      expect(afterRevoke.ok).toBe(false);
    } finally {
      await ownerScope.dispose();
    }
  });
});
