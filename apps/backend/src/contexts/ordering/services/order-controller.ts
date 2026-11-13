import type { InStorePaymentMethod, OrderSource } from '@foodapp/db';
import type { Context } from 'hono';
import type { AppEnv, RequestContext } from '@/container';
import type { PosOrderSummaryDto } from '@/contexts/ordering/application/queries';
import type { KdsTicketOutput } from '@/contexts/ordering/domain/order-visitor';
import type { CommandBus, QueryBus } from '@/core/application/cqrs';
import type { DomainError, Result } from '@/core/domain/result';

export class OrderController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
    private readonly request: RequestContext,
  ) {}

  async listOrders(c: Context<AppEnv>) {
    const restaurantId = this.request.restaurantId ?? c.req.query('restaurantId');

    if (!restaurantId) {
      return c.json(
        {
          error: 'restaurantId is required',
        },
        400,
      );
    }

    const orders = await this.queryBus.ask<PosOrderSummaryDto[]>('GetRestaurantOrders', {
      restaurantId,
    });

    return c.json({
      orders,
    });
  }

  async placeOrder(c: Context<AppEnv>) {
    const body = await c.req.json<{
      restaurantId?: string;
      diningTableId?: string;
      customerId?: string;
      orderSource?: OrderSource;
      items: {
        menuItemId: string;
        quantity: number;
        modifierIds?: string[];
      }[];
    }>();

    const restaurantId = this.request.restaurantId ?? body.restaurantId;
    if (!restaurantId) {
      return c.json(
        {
          error: 'restaurantId is required',
        },
        400,
      );
    }

    const result = await this.commandBus.dispatch<
      Result<
        {
          orderId: string;
          kdsTickets: KdsTicketOutput;
        },
        DomainError
      >
    >('PlacePosOrder', {
      restaurantId,
      diningTableId: body.diningTableId,
      customerId: body.customerId,
      orderSource: body.orderSource ?? 'DINE_IN',
      items: body.items,
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

    return c.json(result.value, 201);
  }

  async settleOrder(c: Context<AppEnv>) {
    const orderId = c.req.param('id');
    const body = await c.req.json<{
      paymentMethod: InStorePaymentMethod;
      tipAmount?: number;
    }>();

    const result = await this.commandBus.dispatch<Result<void, DomainError>>('SettlePosOrder', {
      orderId,
      paymentMethod: body.paymentMethod,
      tipAmount: body.tipAmount ?? 0,
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

    return c.json({
      success: true,
      orderId,
    });
  }
}
