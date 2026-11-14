import type { Context } from 'hono';
import type { AppEnv, RequestContext } from '@/container';
import type { CommandBus, QueryBus } from '@/core/application/cqrs';
import type { DomainError, Result } from '@/core/domain/result';

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
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
    private readonly request: RequestContext,
  ) {}

  async getRestaurantLedger(
    c: Context<AppEnv>,
    query: {
      restaurantId?: string;
      skip?: number;
      take?: number;
    },
  ) {
    const restaurantId = this.request.restaurantId ?? query.restaurantId;

    if (!restaurantId) {
      return c.json(
        {
          error: 'restaurantId is required',
        },
        400,
      );
    }

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
  }

  async getMyLoyaltyBalance(c: Context<AppEnv>) {
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
            item.createdAt instanceof Date ? item.createdAt.toISOString() : String(item.createdAt),
        })),
      },
      200,
    );
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
