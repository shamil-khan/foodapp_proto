import type { InStorePaymentMethod, OrderSource } from '@foodapp/db';
import type { Context } from 'hono';
import type { AppEnv, RequestContext } from '@/container';
import type { CommandBus, QueryBus } from '@/core/application/cqrs';
import { DomainError, type Result } from '@/core/domain/result';
import type { PosOrderSummaryDto } from '@/ordering/application/queries';
import type { KdsTicketOutput } from '@/ordering/domain/order-visitor';

export class OrderController {
  private readonly commandBus: CommandBus;
  private readonly queryBus: QueryBus;
  private readonly request: RequestContext;

  constructor(commandBus: CommandBus, queryBus: QueryBus, request: RequestContext) {
    this.commandBus = commandBus;
    this.queryBus = queryBus;
    this.request = request;
  }

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
      if (result.error.statusCode === 403) {
        return c.json(
          {
            code: result.error.code,
            error: result.error.message,
          },
          403,
        );
      }
      if (result.error.statusCode === 404) {
        return c.json(
          {
            code: result.error.code,
            error: result.error.message,
          },
          404,
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
      if (result.error.statusCode === 403) {
        return c.json(
          {
            code: result.error.code,
            error: result.error.message,
          },
          403,
        );
      }
      if (result.error.statusCode === 404) {
        return c.json(
          {
            code: result.error.code,
            error: result.error.message,
          },
          404,
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

    return c.json(
      {
        success: true as const,
        orderId: params.id,
      },
      200,
    );
  }
}
