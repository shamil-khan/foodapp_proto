import type { Context } from 'hono';
import type { AppEnv, RequestContext } from '@/container';
import type { CommandBus, QueryBus } from '@/core/application/cqrs';
import { DomainError, type Result } from '@/core/domain/result';

interface LedgerRowDto {
  id: string;
  orderId: string | null;
  entityName: string;
  creditAmount: string;
  debitAmount: string;
  description: string | null;
  createdAt: Date | string;
}

interface LoyaltyRowDto {
  id: string;
  restaurantId: string | null;
  orderId: string | null;
  txType: 'EARNED' | 'REDEEMED';
  pointsDelta: number;
  createdAt: Date | string;
}

export class LedgerController {
  private readonly commandBus: CommandBus;
  private readonly queryBus: QueryBus;
  private readonly request: RequestContext;

  constructor(commandBus: CommandBus, queryBus: QueryBus, request: RequestContext) {
    this.commandBus = commandBus;
    this.queryBus = queryBus;
    this.request = request;
  }

  async getRestaurantLedger(
    c: Context<AppEnv>,
    query: {
      restaurantId?: string;
      skip?: number;
      take?: number;
    },
  ) {
    const restaurantId = query.restaurantId ?? this.request.restaurantId;

    if (!restaurantId) {
      return c.json(
        {
          code: 'MISSING_TENANT',
          error: 'restaurantId is required',
        },
        400,
      );
    }

    try {
      const entries = await this.queryBus.ask<LedgerRowDto[]>('GetRestaurantLedger', {
        restaurantId,
        skip: query.skip ?? 0,
        take: query.take ?? 50,
      });

      return c.json(
        {
          entries: entries.map((entry) => ({
            ...entry,
            createdAt:
              entry.createdAt instanceof Date
                ? entry.createdAt.toISOString()
                : String(entry.createdAt),
          })),
        },
        200,
      );
    } catch (error) {
      if (error instanceof DomainError && error.statusCode === 403) {
        return c.json(
          {
            code: error.code,
            error: error.message,
          },
          403,
        );
      }
      throw error;
    }
  }

  async getMyLoyaltyBalance(c: Context<AppEnv>) {
    try {
      const summary = await this.queryBus.ask<{
        totalPoints: number;
        history: LoyaltyRowDto[];
      }>('GetUserLoyaltyBalance', {
        userId: this.request.actorId,
      });

      return c.json(
        {
          totalPoints: summary.totalPoints,
          history: summary.history.map((item) => ({
            ...item,
            createdAt:
              item.createdAt instanceof Date
                ? item.createdAt.toISOString()
                : String(item.createdAt),
          })),
        },
        200,
      );
    } catch (error) {
      if (error instanceof DomainError && error.statusCode === 403) {
        return c.json(
          {
            code: error.code,
            error: error.message,
          },
          403,
        );
      }
      throw error;
    }
  }

  async redeemLoyaltyPoints(
    c: Context<AppEnv>,
    body: {
      restaurantId?: string;
      orderId?: string;
      pointsToRedeem: number;
    },
  ) {
    const result = await this.commandBus.dispatch<
      Result<
        {
          remainingBalance: number;
        },
        DomainError
      >
    >('RedeemLoyaltyPoints', {
      userId: this.request.actorId,
      restaurantId: body.restaurantId,
      orderId: body.orderId,
      pointsToRedeem: body.pointsToRedeem,
    });

    if (!result.ok) {
      if (result.error.statusCode === 403) {
        return c.json(
          {
            code: result.error.code,
            error: result.error.message,
          },
          403,
        );
      }
      return c.json(
        {
          code: result.error.code,
          error: result.error.message,
        },
        400,
      );
    }

    return c.json(result.value, 200);
  }
}
