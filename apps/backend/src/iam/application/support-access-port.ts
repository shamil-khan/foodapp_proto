import type { PlatformSupportScope } from '@foodapp/db';
import type { ActiveSupportGrant } from '@/core/application/authorization';
import type { DomainError, Result } from '@/core/domain/result';

export interface ValidateSupportTicketInput {
  readonly ticketId: string;
  readonly platformUserId: string;
  readonly requiredScope?: PlatformSupportScope;
  readonly expectedRestaurantId?: string;
  readonly expectedBranchId?: string;
  readonly httpMethod: string;
  readonly httpPath: string;
  readonly targetResourceId?: string;
}

/**
 * Port implemented by the `support` bounded context so `iam` middleware can validate
 * brand-authorized JIT support tickets (`X-Support-Ticket-Id`) and record audit entries
 * without coupling `iam` to support ticketing tables.
 */
export interface SupportAccessPort {
  validateAndAuditTicket(
    input: ValidateSupportTicketInput,
  ): Promise<Result<ActiveSupportGrant, DomainError>>;
}
