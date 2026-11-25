import {
  PLATFORM_SUPPORT_SCOPES,
  type PlatformSupportScope,
  type SupportTicketStatus,
} from '@foodapp/db';
import type { ActiveSupportGrant } from '@/core/application/authorization';
import { DomainError, err, ok, type Result } from '@/core/domain/result';

const VALID_SUPPORT_SCOPES = new Set<string>(PLATFORM_SUPPORT_SCOPES);

export interface SupportTicketRecord {
  readonly id: string;
  readonly restaurantId: string;
  readonly branchId: string | null;
  readonly requestedByStaffId: string;
  readonly approvedByStaffId: string | null;
  readonly approvedAt: Date | null;
  readonly assignedPlatformUserId: string | null;
  readonly scopePermission: string;
  readonly reason: string;
  readonly attachmentUrl: string | null;
  readonly attachmentNote: string | null;
  readonly status: SupportTicketStatus;
  readonly expiresAt: Date;
}

export function isValidPlatformSupportScope(scope: string): scope is PlatformSupportScope {
  return VALID_SUPPORT_SCOPES.has(scope);
}

/**
 * Pure domain invariant checker for brand-authorized JIT support tickets.
 * Rejects unapproved, revoked, expired, unassigned, or cross-tenant/branch tickets.
 */
export function evaluateSupportTicketAccess(params: {
  readonly ticket: SupportTicketRecord;
  readonly platformUserId: string;
  readonly requiredScope?: PlatformSupportScope;
  readonly expectedRestaurantId?: string;
  readonly expectedBranchId?: string;
  readonly now?: Date;
}): Result<ActiveSupportGrant, DomainError> {
  const { ticket } = params;
  const now = params.now ?? new Date();

  if (ticket.status !== 'APPROVED' || !ticket.approvedByStaffId) {
    return err(
      new DomainError(
        'SUPPORT_TICKET_NOT_APPROVED',
        `Support ticket ${ticket.id} is in status ${ticket.status} and cannot be used.`,
        403,
      ),
    );
  }

  if (new Date(ticket.expiresAt) <= now) {
    return err(
      new DomainError(
        'SUPPORT_TICKET_EXPIRED',
        `Support ticket ${ticket.id} has expired and requires a new brand authorization.`,
        403,
      ),
    );
  }

  if (ticket.assignedPlatformUserId && ticket.assignedPlatformUserId !== params.platformUserId) {
    return err(
      new DomainError(
        'SUPPORT_TICKET_ASSIGNEE_MISMATCH',
        'Support ticket is assigned to a different platform specialist.',
        403,
      ),
    );
  }

  if (!isValidPlatformSupportScope(ticket.scopePermission)) {
    return err(
      new DomainError('INVALID_SUPPORT_SCOPE', 'Ticket holds an unrecognized support scope.', 403),
    );
  }

  if (params.requiredScope && ticket.scopePermission !== params.requiredScope) {
    return err(
      new DomainError(
        'SUPPORT_SCOPE_MISMATCH',
        `Ticket grants ${ticket.scopePermission}, but endpoint requires ${params.requiredScope}.`,
        403,
      ),
    );
  }

  if (params.expectedRestaurantId && ticket.restaurantId !== params.expectedRestaurantId) {
    return err(
      new DomainError('TENANT_FORBIDDEN', 'Support ticket does not belong to target brand.', 403),
    );
  }

  if (ticket.branchId && params.expectedBranchId && ticket.branchId !== params.expectedBranchId) {
    return err(
      new DomainError(
        'BRANCH_FORBIDDEN',
        'Support ticket is restricted to a different branch.',
        403,
      ),
    );
  }

  return ok({
    ticketId: ticket.id,
    restaurantId: ticket.restaurantId,
    branchId: ticket.branchId ?? undefined,
    scopePermission: ticket.scopePermission,
    expiresAt: new Date(ticket.expiresAt).toISOString(),
  });
}
