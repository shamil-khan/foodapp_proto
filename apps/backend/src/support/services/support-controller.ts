import type { PlatformSupportScope } from '@foodapp/db';
import type { Context } from 'hono';
import type { AppEnv, RequestContext } from '@/container';
import type { CommandBus, QueryBus } from '@/core/application/cqrs';
import { DomainError, type Result } from '@/core/domain/result';
import type { SupportTicketRecord } from '@/support/domain/support-ticket';

function mapSupportError(c: Context<AppEnv>, error: DomainError) {
  const payload = {
    code: error.code,
    error: error.message,
  };
  if (error.statusCode === 401) return c.json(payload, 401);
  if (error.statusCode === 403) return c.json(payload, 403);
  if (error.statusCode === 404) return c.json(payload, 404);
  if (error.statusCode === 409) return c.json(payload, 409);
  return c.json(payload, 400);
}

export class SupportController {
  private readonly commandBus: CommandBus;
  private readonly queryBus: QueryBus;
  private readonly request: RequestContext;

  constructor(commandBus: CommandBus, queryBus: QueryBus, request: RequestContext) {
    this.commandBus = commandBus;
    this.queryBus = queryBus;
    this.request = request;
  }

  async createTicket(
    c: Context<AppEnv>,
    body: {
      restaurantId?: string;
      branchId?: string | null;
      assignedPlatformUserId?: string | null;
      scopePermission: PlatformSupportScope;
      reason: string;
      attachmentUrl?: string | null;
      attachmentNote?: string | null;
      expiresInHours?: number;
    },
  ) {
    const restaurantId = body.restaurantId ?? this.request.restaurantId;
    if (!restaurantId) {
      return c.json(
        {
          code: 'MISSING_TENANT',
          error: 'restaurantId is required',
        },
        403,
      );
    }

    const res = await this.commandBus.dispatch<
      Result<
        {
          ticketId: string;
          status: 'APPROVED';
          expiresAt: string;
        },
        DomainError
      >
    >('CreateApprovedSupportTicket', {
      ...body,
      restaurantId,
    });
    if (!res.ok) return mapSupportError(c, res.error);
    return c.json(res.value, 201);
  }

  async listTickets(
    c: Context<AppEnv>,
    query: {
      restaurantId?: string;
    },
  ) {
    const restaurantId = query.restaurantId ?? this.request.restaurantId;
    if (!restaurantId) {
      return c.json(
        {
          code: 'MISSING_TENANT',
          error: 'restaurantId is required',
        },
        403,
      );
    }

    try {
      const tickets = await this.queryBus.ask<readonly SupportTicketRecord[]>(
        'ListBrandSupportTickets',
        {
          restaurantId,
        },
      );
      return c.json(
        {
          tickets: tickets.map((t) => ({
            ...t,
            approvedAt: t.approvedAt ? t.approvedAt.toISOString() : null,
            expiresAt: t.expiresAt.toISOString(),
          })),
        },
        200,
      );
    } catch (error) {
      if (error instanceof DomainError) return mapSupportError(c, error);
      throw error;
    }
  }

  async revokeTicket(
    c: Context<AppEnv>,
    params: {
      ticketId: string;
    },
  ) {
    const res = await this.commandBus.dispatch<Result<void, DomainError>>('RevokeSupportTicket', {
      ticketId: params.ticketId,
    });
    if (!res.ok) return mapSupportError(c, res.error);
    return c.json(
      {
        success: true as const,
      },
      200,
    );
  }
}
