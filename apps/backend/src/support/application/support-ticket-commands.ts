import type { PlatformSupportScope } from '@foodapp/db';
import type { AuthorizationPolicy, RequestContext } from '@/core/application/authorization';
import type { Command, CommandHandler } from '@/core/application/cqrs';
import { DomainError, err, ok, type Result } from '@/core/domain/result';
import { isValidPlatformSupportScope } from '@/support/domain/support-ticket';
import type { SupportTicketRepository } from '@/support/infrastructure/support-ticket-repository';

export interface CreateApprovedSupportTicketCommand
  extends Command<
    Result<{
      readonly ticketId: string;
      readonly status: 'APPROVED';
      readonly expiresAt: string;
    }>
  > {
  readonly restaurantId: string;
  readonly branchId?: string | null;
  readonly assignedPlatformUserId?: string | null;
  readonly scopePermission: PlatformSupportScope;
  readonly reason: string;
  readonly attachmentUrl?: string | null;
  readonly attachmentNote?: string | null;
  readonly expiresInHours?: number;
}

export class CreateApprovedSupportTicketHandler
  implements
    CommandHandler<
      CreateApprovedSupportTicketCommand,
      Result<{
        readonly ticketId: string;
        readonly status: 'APPROVED';
        readonly expiresAt: string;
      }>
    >
{
  private readonly repo: SupportTicketRepository;
  private readonly authz: AuthorizationPolicy;
  private readonly request: RequestContext;

  constructor(repo: SupportTicketRepository, authz: AuthorizationPolicy, request: RequestContext) {
    this.repo = repo;
    this.authz = authz;
    this.request = request;
  }

  async execute(cmd: CreateApprovedSupportTicketCommand): Promise<
    Result<{
      readonly ticketId: string;
      readonly status: 'APPROVED';
      readonly expiresAt: string;
    }>
  > {
    if (this.request.actorSource !== 'POS_STAFF') {
      return err(
        new DomainError(
          'FORBIDDEN',
          'Only authorized brand staff can create and approve support tickets.',
          403,
        ),
      );
    }

    const access = this.authz.assertRestaurantAccess(cmd.restaurantId, 'brand:support:authorize');
    if (!access.ok) return access;

    if (!isValidPlatformSupportScope(cmd.scopePermission)) {
      return err(new DomainError('INVALID_SUPPORT_SCOPE', 'Invalid support scope requested.', 400));
    }

    const hours = Math.min(Math.max(cmd.expiresInHours ?? 4, 1), 24);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + hours * 3_600_000);

    const created = await this.repo.createApprovedTicket({
      restaurantId: cmd.restaurantId,
      branchId: cmd.branchId ?? null,
      requestedByStaffId: this.request.actorId,
      approvedByStaffId: this.request.actorId,
      approvedAt: now,
      assignedPlatformUserId: cmd.assignedPlatformUserId ?? null,
      scopePermission: cmd.scopePermission,
      reason: cmd.reason.trim(),
      attachmentUrl: cmd.attachmentUrl?.trim() ?? null,
      attachmentNote: cmd.attachmentNote?.trim() ?? null,
      expiresAt,
      actorId: this.request.actorId,
    });

    return ok({
      ticketId: created.id,
      status: 'APPROVED',
      expiresAt: expiresAt.toISOString(),
    });
  }
}

export interface RevokeSupportTicketCommand extends Command<Result<void>> {
  readonly ticketId: string;
}

export class RevokeSupportTicketHandler
  implements CommandHandler<RevokeSupportTicketCommand, Result<void>>
{
  private readonly repo: SupportTicketRepository;
  private readonly authz: AuthorizationPolicy;
  private readonly request: RequestContext;

  constructor(repo: SupportTicketRepository, authz: AuthorizationPolicy, request: RequestContext) {
    this.repo = repo;
    this.authz = authz;
    this.request = request;
  }

  async execute(cmd: RevokeSupportTicketCommand): Promise<Result<void>> {
    const ticket = await this.repo.findTicketById(cmd.ticketId);
    if (!ticket) {
      return err(new DomainError('TICKET_NOT_FOUND', 'Support ticket not found.', 404));
    }

    const access = this.authz.assertRestaurantAccess(
      ticket.restaurantId,
      'brand:support:authorize',
    );
    if (!access.ok) return access;

    await this.repo.revokeTicket(ticket.id, this.request.actorId);
    return ok(undefined);
  }
}
