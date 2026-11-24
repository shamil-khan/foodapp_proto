import type { Context } from 'hono';
import type { AppEnv, RequestContext } from '@/container';
import type { CommandBus, QueryBus } from '@/core/application/cqrs';
import { DomainError, type Result } from '@/core/domain/result';
import type { CustomerLoyaltySummaryDto } from '@/loyalty/application/queries';

function mapLoyaltyError(c: Context<AppEnv>, error: DomainError) {
  const payload = {
    code: error.code,
    error: error.message,
  };
  if (error.statusCode === 401) return c.json(payload, 401);
  if (error.statusCode === 403) return c.json(payload, 403);
  if (error.statusCode === 404) return c.json(payload, 404);
  return c.json(payload, 400);
}

export class LoyaltyController {
  private readonly commandBus: CommandBus;
  private readonly queryBus: QueryBus;
  private readonly request: RequestContext;

  constructor(commandBus: CommandBus, queryBus: QueryBus, request: RequestContext) {
    this.commandBus = commandBus;
    this.queryBus = queryBus;
    this.request = request;
  }

  async getMyWallet(
    c: Context<AppEnv>,
    query: {
      scope?: 'PLATFORM' | 'MERCHANT';
      merchantId?: string;
    },
  ) {
    try {
      const summary = await this.queryBus.ask<CustomerLoyaltySummaryDto>('GetCustomerLoyalty', {
        userId: this.request.actorId,
        issuerScope: query.scope,
        merchantId: query.merchantId,
      });
      return c.json(summary as unknown as Record<string, unknown>, 200);
    } catch (error) {
      if (error instanceof DomainError) return mapLoyaltyError(c, error);
      throw error;
    }
  }

  async updateGovernance(c: Context<AppEnv>, body: Record<string, unknown>) {
    const res = await this.commandBus.dispatch<Result<void, DomainError>>(
      'UpdateLoyaltyGovernance',
      body,
    );
    if (!res.ok) return mapLoyaltyError(c, res.error);
    return c.json(
      {
        success: true as const,
      },
      200,
    );
  }

  async auditEntry(
    c: Context<AppEnv>,
    params: {
      entryId: string;
    },
    body: Record<string, unknown>,
  ) {
    const res = await this.commandBus.dispatch<Result<void, DomainError>>('AuditLoyaltyEntry', {
      entryId: params.entryId,
      ...body,
    });
    if (!res.ok) return mapLoyaltyError(c, res.error);
    return c.json(
      {
        success: true as const,
      },
      200,
    );
  }
}
