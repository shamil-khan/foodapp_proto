import type { InStorePaymentMethod, OrderSource } from '@foodapp/db';
import type { Context } from 'hono';
import type { AppEnv, RequestContext } from '@/container';
import type { PosOrderSummaryDto } from '@/contexts/ordering/application/queries';
import type { KdsTicketOutput } from '@/contexts/ordering/domain/order-visitor';
import type { CommandBus, QueryBus } from '@/core/application/cqrs';
import { DomainError, type Result } from '@/core/domain/result';

export class OrderController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
    private readonly request: RequestContext,
  ) {}

  async listOrders(
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
        400,
      );
    }

    try {
      const orders = await this.queryBus.ask<PosOrderSummaryDto[]>('GetRestaurantOrders', {
        restaurantId,
      });

      return c.json(
        {
          orders: orders.map((order) => ({
            ...order,
            createdAt:
              order.createdAt instanceof Date
                ? order.createdAt.toISOString()
                : String(order.createdAt),
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

  async placeOrder(
    c: Context<AppEnv>,
    body: {
      clientOrderId?: string;
      restaurantId?: string;
      diningTableId?: string;
      customerId?: string;
      orderSource: OrderSource;
      items: {
        menuItemId: string;
        quantity: number;
        modifierIds?: string[];
      }[];
    },
  ) {
    const restaurantId = body.restaurantId ?? this.request.restaurantId;
    if (!restaurantId) {
      return c.json(
        {
          code: 'MISSING_TENANT',
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
      orderSource: body.orderSource,
      items: body.items,
    });

    if (!result.ok) {
      const status =
        result.error.statusCode === 403 ? 403 : result.error.statusCode === 404 ? 404 : 400;
      return c.json(
        {
          code: result.error.code,
          error: result.error.message,
        },
        status,
      );
    }

    return c.json(result.value, 201);
  }

  async settleOrder(
    c: Context<AppEnv>,
    params: {
      id: string;
    },
    body: {
      paymentMethod: InStorePaymentMethod;
      tipAmount: number;
    },
  ) {
    const result = await this.commandBus.dispatch<Result<void, DomainError>>('SettlePosOrder', {
      orderId: params.id,
      paymentMethod: body.paymentMethod,
      tipAmount: body.tipAmount,
    });

    if (!result.ok) {
      const status =
        result.error.statusCode === 403 ? 403 : result.error.statusCode === 404 ? 404 : 400;
      return c.json(
        {
          code: result.error.code,
          error: result.error.message,
        },
        status,
      );
    }

    return c.json(
      {
        success: true as const,
        orderId: params.id,
      },
      200,
    );
  }
}
