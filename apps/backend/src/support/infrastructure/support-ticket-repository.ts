import {
  type PlatformSupportScope,
  SupportTicketAuditLogTable,
  type SupportTicketStatus,
  SupportTicketTable,
  sqlInsert,
  sqlSelect,
  sqlUpdate,
  type UnitOfWork,
} from '@foodapp/db';
import type { ActiveSupportGrant, RequestContext } from '@/core/application/authorization';
import { DomainError, err, type Result } from '@/core/domain/result';
import { ScopedRepository } from '@/core/infrastructure/scoped-repository';
import type {
  SupportAccessPort,
  ValidateSupportTicketInput,
} from '@/iam/application/support-access-port';
import {
  evaluateSupportTicketAccess,
  type SupportTicketRecord,
} from '@/support/domain/support-ticket';

function mapRowToTicketRecord(
  row: typeof SupportTicketTable._row & Record<string, unknown>,
): SupportTicketRecord {
  return {
    id: String(row.id),
    restaurantId: String(row.restaurantId),
    branchId: row.branchId ? String(row.branchId) : null,
    requestedByStaffId: String(row.requestedByStaffId),
    approvedByStaffId: row.approvedByStaffId ? String(row.approvedByStaffId) : null,
    approvedAt: row.approvedAt ? new Date(row.approvedAt as string | Date) : null,
    assignedPlatformUserId: row.assignedPlatformUserId ? String(row.assignedPlatformUserId) : null,
    scopePermission: String(row.scopePermission),
    reason: String(row.reason),
    attachmentUrl: row.attachmentUrl ? String(row.attachmentUrl) : null,
    attachmentNote: row.attachmentNote ? String(row.attachmentNote) : null,
    status: String(row.status) as SupportTicketStatus,
    expiresAt: new Date(row.expiresAt as string | Date),
  };
}

export class SupportTicketRepository extends ScopedRepository implements SupportAccessPort {
  private readonly uow: UnitOfWork;

  constructor(uow: UnitOfWork, request: RequestContext) {
    super(request);
    this.uow = uow;
  }

  async createApprovedTicket(params: {
    readonly restaurantId: string;
    readonly branchId: string | null;
    readonly requestedByStaffId: string;
    readonly approvedByStaffId: string;
    readonly approvedAt: Date;
    readonly assignedPlatformUserId: string | null;
    readonly scopePermission: PlatformSupportScope;
    readonly reason: string;
    readonly attachmentUrl: string | null;
    readonly attachmentNote: string | null;
    readonly expiresAt: Date;
    readonly actorId: string;
  }): Promise<{
    readonly id: string;
  }> {
    this.resolveRestaurantScope(params.restaurantId);

    const tCols = SupportTicketTable.cols;
    const ins = sqlInsert(SupportTicketTable)
      .values({
        restaurantId: params.restaurantId,
        branchId: params.branchId,
        requestedByStaffId: params.requestedByStaffId,
        approvedByStaffId: params.approvedByStaffId,
        approvedAt: params.approvedAt,
        assignedPlatformUserId: params.assignedPlatformUserId,
        scopePermission: params.scopePermission,
        reason: params.reason,
        attachmentUrl: params.attachmentUrl,
        attachmentNote: params.attachmentNote,
        status: 'APPROVED',
        expiresAt: params.expiresAt,
        createdBy: params.actorId,
        updatedBy: params.actorId,
      })
      .returning([
        tCols.id,
      ])
      .compile();

    const row = await this.uow.queryOne(ins);
    const id = row?.id;
    if (!id) {
      throw new Error('Failed to create SupportTicket record');
    }
    return {
      id,
    };
  }

  async findTicketById(ticketId: string): Promise<SupportTicketRecord | null> {
    const tCols = SupportTicketTable.cols;
    const q = sqlSelect(SupportTicketTable).whereEq(tCols.id, ticketId).activeOnly().compile();
    const row = await this.uow.queryOne(q);
    return row
      ? mapRowToTicketRecord(
          row as unknown as typeof SupportTicketTable._row & Record<string, unknown>,
        )
      : null;
  }

  async listTicketsForRestaurant(restaurantId: string): Promise<readonly SupportTicketRecord[]> {
    this.resolveRestaurantScope(restaurantId);

    const tCols = SupportTicketTable.cols;
    const q = sqlSelect(SupportTicketTable)
      .whereEq(tCols.restaurantId, restaurantId)
      .activeOnly()
      .orderBy(tCols.createdAt, 'DESC')
      .take(50)
      .compile();
    const rows = await this.uow.queryMany(q);
    return rows.map((r) =>
      mapRowToTicketRecord(
        r as unknown as typeof SupportTicketTable._row & Record<string, unknown>,
      ),
    );
  }

  async revokeTicket(ticketId: string, actorId: string): Promise<void> {
    const tCols = SupportTicketTable.cols;
    const upd = sqlUpdate(SupportTicketTable)
      .set({
        status: 'REVOKED',
        revokedByStaffId: actorId,
        revokedAt: new Date(),
      })
      .withAuditBump(actorId)
      .whereEq(tCols.id, ticketId)
      .whereNull(tCols.deletedAt)
      .compile();
    await this.uow.execute(upd);
  }

  /**
   * Validates the JIT support ticket and writes an immutable SupportTicketAuditLog row
   * before allowing any platform support operation to execute.
   */
  async validateAndAuditTicket(
    input: ValidateSupportTicketInput,
  ): Promise<Result<ActiveSupportGrant, DomainError>> {
    const ticket = await this.findTicketById(input.ticketId);
    if (!ticket) {
      return err(
        new DomainError(
          'SUPPORT_TICKET_NOT_FOUND',
          `Support ticket ${input.ticketId} was not found.`,
          404,
        ),
      );
    }

    const decision = evaluateSupportTicketAccess({
      ticket,
      platformUserId: input.platformUserId,
      requiredScope: input.requiredScope,
      expectedRestaurantId: input.expectedRestaurantId,
      expectedBranchId: input.expectedBranchId,
    });
    if (!decision.ok) {
      return decision;
    }

    const auditIns = sqlInsert(SupportTicketAuditLogTable)
      .values({
        ticketId: ticket.id,
        restaurantId: ticket.restaurantId,
        branchId: ticket.branchId,
        platformUserId: input.platformUserId,
        scopePermission: ticket.scopePermission,
        httpMethod: input.httpMethod,
        httpPath: input.httpPath,
        targetResourceId: input.targetResourceId ?? null,
      })
      .compile();
    await this.uow.execute(auditIns);

    return decision;
  }
}
