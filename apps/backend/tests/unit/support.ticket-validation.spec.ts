// FILE: apps/backend/tests/unit/support.ticket-validation.spec.ts
import { describe, expect, it } from 'vitest';
import {
  evaluateSupportTicketAccess,
  type SupportTicketRecord,
} from '@/support/domain/support-ticket';

const baseTicket: SupportTicketRecord = {
  id: '70000000-0000-4000-8000-000000000001',
  restaurantId: 'a0000000-0000-4000-8000-000000000001',
  branchId: 'b0000000-0000-4000-8000-000000000001',
  requestedByStaffId: 'c0000000-0000-4000-8000-000000000001',
  approvedByStaffId: 'c0000000-0000-4000-8000-000000000001',
  approvedAt: new Date('2026-11-24T10:00:00.000Z'),
  assignedPlatformUserId: '00000000-0000-4000-8000-000000000001',
  scopePermission: 'platform:support:catalog-override',
  reason: 'Menu photo update',
  attachmentUrl: 'https://foodapp.co.uk',
  attachmentNote: 'Update Biryani price',
  status: 'APPROVED',
  expiresAt: new Date('2026-11-24T18:00:00.000Z'),
};

describe('support.ticket-validation — JIT Support Ticket Invariants', () => {
  const now = new Date('2026-11-24T12:00:00.000Z');

  it('grants scoped access when ticket is APPROVED, unexpired, and matches assignee, scope, and tenant', () => {
    const res = evaluateSupportTicketAccess({
      ticket: baseTicket,
      platformUserId: '00000000-0000-4000-8000-000000000001',
      requiredScope: 'platform:support:catalog-override',
      expectedRestaurantId: 'a0000000-0000-4000-8000-000000000001',
      expectedBranchId: 'b0000000-0000-4000-8000-000000000001',
      now,
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.ticketId).toBe(baseTicket.id);
      expect(res.value.scopePermission).toBe('platform:support:catalog-override');
    }
  });

  it('rejects expired, revoked, wrong-scope, wrong-assignee, and cross-branch tickets', () => {
    expect(
      evaluateSupportTicketAccess({
        ticket: {
          ...baseTicket,
          expiresAt: new Date('2026-11-24T11:59:59.000Z'),
        },
        platformUserId: '00000000-0000-4000-8000-000000000001',
        now,
      }).ok,
    ).toBe(false);

    expect(
      evaluateSupportTicketAccess({
        ticket: {
          ...baseTicket,
          status: 'REVOKED',
        },
        platformUserId: '00000000-0000-4000-8000-000000000001',
        now,
      }).ok,
    ).toBe(false);

    expect(
      evaluateSupportTicketAccess({
        ticket: baseTicket,
        platformUserId: '00000000-0000-4000-8000-000000000001',
        requiredScope: 'platform:support:billing-settle',
        now,
      }).ok,
    ).toBe(false);

    expect(
      evaluateSupportTicketAccess({
        ticket: baseTicket,
        platformUserId: '00000000-0000-4000-8000-000000000002',
        now,
      }).ok,
    ).toBe(false);

    expect(
      evaluateSupportTicketAccess({
        ticket: baseTicket,
        platformUserId: '00000000-0000-4000-8000-000000000001',
        expectedBranchId: 'b0000000-0000-4000-8000-000000000099',
        now,
      }).ok,
    ).toBe(false);
  });
});
