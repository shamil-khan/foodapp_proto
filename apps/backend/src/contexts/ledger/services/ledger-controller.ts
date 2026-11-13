import type { Context } from 'hono';
import type { AppEnv, RequestContext } from '@/container';
import type { CommandBus, QueryBus } from '@/core/application/cqrs';
import type { DomainError, Result } from '@/core/domain/result';

export class LedgerController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
    private readonly request: RequestContext,
  ) {}

  async getRestaurantLedger(c: Context<AppEnv>) {
    const restaurantId = this.request.restaurantId ?? c.req.query('restaurantId');

    if (!restaurantId) {
      return c.json(
        {
          error: 'restaurantId is required',
        },
        400,
      );
    }

    const skip = Number(c.req.query('skip') ?? 0);
    const take = Number(c.req.query('take') ?? 50);

    const entries = await this.queryBus.ask<unknown[]>('GetRestaurantLedger', {
      restaurantId,
      skip,
      take,
    });

    return c.json({
      entries,
    });
  }

  async getMyLoyaltyBalance(c: Context<AppEnv>) {
    const summary = await this.queryBus.ask<{
      totalPoints: number;
      history: unknown[];
    }>('GetUserLoyaltyBalance', {
      userId: this.request.actorId,
    });

    return c.json(summary);
  }

  async redeemLoyaltyPoints(c: Context<AppEnv>) {
    const body = await c.req.json<{
      restaurantId?: string;
      orderId?: string;
      pointsToRedeem: number;
    }>();

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
        result.error.statusCode as 400,
      );
    }

    return c.json(result.value);
  }
}
