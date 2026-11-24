import type { Context } from 'hono';
import type { RestaurantBillingSummaryDto } from '@/billing/application/queries';
import type { AppEnv, RequestContext } from '@/container';
import type { CommandBus, QueryBus } from '@/core/application/cqrs';
import { DomainError, type Result } from '@/core/domain/result';

function mapBillingError(c: Context<AppEnv>, error: DomainError) {
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

export class BillingController {
  private readonly commandBus: CommandBus;
  private readonly queryBus: QueryBus;
  private readonly request: RequestContext;

  constructor(commandBus: CommandBus, queryBus: QueryBus, request: RequestContext) {
    this.commandBus = commandBus;
    this.queryBus = queryBus;
    this.request = request;
  }

  async getRestaurantBilling(
    c: Context<AppEnv>,
    query: {
      restaurantId?: string;
    },
  ) {
    const restaurantId = query.restaurantId ?? this.request.restaurantId ?? '';
    try {
      const summary = await this.queryBus.ask<RestaurantBillingSummaryDto>('GetRestaurantBilling', {
        restaurantId,
      });
      return c.json(summary as unknown as Record<string, unknown>, 200);
    } catch (error) {
      if (error instanceof DomainError) return mapBillingError(c, error);
      throw error;
    }
  }

  async refundOrder(
    c: Context<AppEnv>,
    body: {
      orderId: string;
      amountGbp: string;
      reason: string;
    },
  ) {
    const res = await this.commandBus.dispatch<
      Result<
        {
          refundReference: string;
        },
        DomainError
      >
    >('RefundOrder', body);
    if (!res.ok) return mapBillingError(c, res.error);
    return c.json(res.value, 200);
  }

  async settleMerchant(
    c: Context<AppEnv>,
    params: {
      restaurantId: string;
    },
    body: {
      applyLoyaltyOffset?: boolean;
      markPaidReference?: string;
    },
  ) {
    const res = await this.commandBus.dispatch<
      Result<
        {
          settlementId: string;
          netPayoutGbp: string;
        },
        DomainError
      >
    >('SettleMerchant', {
      restaurantId: params.restaurantId,
      ...body,
    });
    if (!res.ok) return mapBillingError(c, res.error);
    return c.json(res.value, 201);
  }
}
