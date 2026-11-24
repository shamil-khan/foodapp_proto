import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { AppEnv, RequestContext } from '@/container';
import type { CommandBus, QueryBus } from '@/core/application/cqrs';
import type { EventBus } from '@/core/application/event-bus';
import { DomainError, type Result } from '@/core/domain/result';
import type { CartLineInput, CartStorePort } from '@/orders/application/cart-service';
import type { DeliveryProviderPort } from '@/orders/application/delivery-provider-port';
import type { OfflinePosOrderBatchItem } from '@/orders/application/pos-sync-command';
import type {
  OrderDetailDto,
  OrderStreamEventDto,
  PosOrderSummaryDto,
} from '@/orders/application/queries';
import type { OrderChannel, OrderPaymentMode, OrderStatus } from '@/orders/domain/order-events';
import type { KdsTicketOutput } from '@/orders/domain/order-visitor';
import type { OrderRepository } from '@/orders/infrastructure/order-repository';

function mapOrderError(c: Context<AppEnv>, error: DomainError) {
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

export class OrderController {
  private readonly commandBus: CommandBus;
  private readonly queryBus: QueryBus;
  private readonly cartStore: CartStorePort;
  private readonly orderRepo: OrderRepository;
  private readonly deliveryProvider: DeliveryProviderPort;
  private readonly eventBus: EventBus;
  private readonly request: RequestContext;

  constructor(
    commandBus: CommandBus,
    queryBus: QueryBus,
    cartStore: CartStorePort,
    orderRepo: OrderRepository,
    deliveryProvider: DeliveryProviderPort,
    eventBus: EventBus,
    request: RequestContext,
  ) {
    this.commandBus = commandBus;
    this.queryBus = queryBus;
    this.cartStore = cartStore;
    this.orderRepo = orderRepo;
    this.deliveryProvider = deliveryProvider;
    this.eventBus = eventBus;
    this.request = request;
  }

  async getCart(
    c: Context<AppEnv>,
    params: {
      branchId: string;
    },
  ) {
    if (this.request.actorSource !== 'GLOBAL_USER') {
      return c.json(
        {
          code: 'UNAUTHORIZED',
          error: 'Customer session required',
        },
        401,
      );
    }
    const cart = await this.cartStore.getCart(this.request.actorId, params.branchId);
    return c.json(
      (cart ?? {
        userId: this.request.actorId,
        branchId: params.branchId,
        orderSource: 'ONLINE_DELIVERY',
        lines: [],
        updatedAt: new Date().toISOString(),
      }) as unknown as Record<string, unknown>,
      200,
    );
  }

  async upsertCart(
    c: Context<AppEnv>,
    params: {
      branchId: string;
    },
    body: {
      orderSource: OrderChannel;
      promoCode?: string;
      mergeWithExisting?: boolean;
      lines: CartLineInput[];
    },
  ) {
    if (this.request.actorSource !== 'GLOBAL_USER') {
      return c.json(
        {
          code: 'UNAUTHORIZED',
          error: 'Customer session required',
        },
        401,
      );
    }
    if (body.mergeWithExisting) {
      const merged = await this.cartStore.mergeGuestCart({
        userId: this.request.actorId,
        branchId: params.branchId,
        orderSource: body.orderSource,
        promoCode: body.promoCode,
        guestLines: body.lines,
      });
      return c.json(merged as unknown as Record<string, unknown>, 200);
    }
    const cart = {
      userId: this.request.actorId,
      branchId: params.branchId,
      orderSource: body.orderSource,
      promoCode: body.promoCode,
      lines: body.lines,
      updatedAt: new Date().toISOString(),
    };
    await this.cartStore.saveCart(cart);
    return c.json(cart as unknown as Record<string, unknown>, 200);
  }

  async previewOrder(c: Context<AppEnv>, body: Record<string, unknown>) {
    const res = await this.commandBus.dispatch<Result<Record<string, unknown>, DomainError>>(
      'PreviewOrder',
      body,
    );
    if (!res.ok) return mapOrderError(c, res.error);
    return c.json(res.value, 200);
  }

  async checkoutOrder(c: Context<AppEnv>, body: Record<string, unknown>) {
    const idempotencyKey = c.req.header('Idempotency-Key')?.trim();
    const res = await this.commandBus.dispatch<Result<Record<string, unknown>, DomainError>>(
      'CheckoutOrder',
      {
        ...body,
        idempotencyKey,
      },
    );
    if (!res.ok) return mapOrderError(c, res.error);
    return c.json(res.value, 201);
  }

  async getOrderDetail(
    c: Context<AppEnv>,
    params: {
      id: string;
    },
  ) {
    try {
      const detail = await this.queryBus.ask<OrderDetailDto | null>('GetOrderById', {
        orderId: params.id,
      });
      if (!detail) {
        return c.json(
          {
            code: 'ORDER_NOT_FOUND',
            error: 'Order not found',
          },
          404,
        );
      }
      return c.json(detail as unknown as Record<string, unknown>, 200);
    } catch (error) {
      if (error instanceof DomainError) return mapOrderError(c, error);
      throw error;
    }
  }

  async transitionOrderStatus(
    c: Context<AppEnv>,
    params: {
      id: string;
    },
    body: {
      toStatus: OrderStatus;
      expectedRowVersion?: number;
      reason?: string;
    },
  ) {
    const res = await this.commandBus.dispatch<Result<Record<string, unknown>, DomainError>>(
      'TransitionOrderStatus',
      {
        orderId: params.id,
        ...body,
      },
    );
    if (!res.ok) return mapOrderError(c, res.error);
    return c.json(res.value, 200);
  }

  async streamOrderEvents(c: Context<AppEnv>, orderId: string) {
    try {
      const detail = await this.queryBus.ask<OrderDetailDto | null>('GetOrderById', {
        orderId,
      });
      if (!detail) {
        return c.json(
          {
            code: 'ORDER_NOT_FOUND',
            error: 'Order not found',
          },
          404,
        );
      }
    } catch (error) {
      if (error instanceof DomainError) return mapOrderError(c, error);
      throw error;
    }

    const rawLastId = c.req.header('Last-Event-ID') ?? c.req.query('afterVersion') ?? '0';
    const afterVersion = Math.max(0, Number.parseInt(rawLastId, 10) || 0);
    const missedEvents = await this.queryBus.ask<OrderStreamEventDto[]>('GetOrderEventsSince', {
      orderId,
      afterVersion,
    });

    return streamSSE(c, async (stream) => {
      for (const ev of missedEvents) {
        await stream.writeSSE({
          id: String(ev.version),
          event: ev.eventType,
          data: JSON.stringify(ev),
        });
      }

      if (c.req.query('closeAfterReplay') === 'true') {
        return;
      }

      let active = true;
      stream.onAbort(() => {
        active = false;
      });

      const forwarder = async (event: {
        aggregateId: string;
        version: number;
        eventType: string;
        payload: unknown;
        occurredAt: Date;
      }) => {
        if (!active || event.aggregateId !== orderId) return;
        await stream.writeSSE({
          id: String(event.version),
          event: event.eventType,
          data: JSON.stringify({
            version: event.version,
            eventType: event.eventType,
            payload: event.payload,
            occurredAt: event.occurredAt.toISOString(),
          }),
        });
      };

      this.eventBus.subscribe('OrderTransitioned', forwarder);
      this.eventBus.subscribe('OrderSettled', forwarder);
      this.eventBus.subscribe('OrderCancelledOrRejected', forwarder);

      await stream.sleep(1000);
    });
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
      if (error instanceof DomainError) return mapOrderError(c, error);
      throw error;
    }
  }

  async placeOrder(c: Context<AppEnv>, body: Record<string, unknown>) {
    const restaurantId = (body.restaurantId as string | undefined) ?? this.request.restaurantId;
    if (!restaurantId) {
      return c.json(
        {
          code: 'MISSING_TENANT',
          error: 'restaurantId is required',
        },
        400,
      );
    }

    const res = await this.commandBus.dispatch<
      Result<
        {
          orderId: string;
          kdsTickets: KdsTicketOutput;
        },
        DomainError
      >
    >('PlacePosOrder', {
      ...body,
      restaurantId,
    });
    if (!res.ok) return mapOrderError(c, res.error);
    return c.json(res.value as unknown as Record<string, unknown>, 201);
  }

  async settleOrder(
    c: Context<AppEnv>,
    params: {
      id: string;
    },
    body: {
      paymentMethod: OrderPaymentMode;
      tipAmount: number;
      expectedRowVersion?: number;
    },
  ) {
    const res = await this.commandBus.dispatch<Result<void, DomainError>>('SettlePosOrder', {
      orderId: params.id,
      paymentMethod: body.paymentMethod,
      tipAmount: body.tipAmount,
      expectedRowVersion: body.expectedRowVersion,
    });
    if (!res.ok) return mapOrderError(c, res.error);
    return c.json(
      {
        success: true as const,
        orderId: params.id,
      },
      200,
    );
  }

  async syncPosOrders(
    c: Context<AppEnv>,
    body: {
      orders: OfflinePosOrderBatchItem[];
    },
  ) {
    const res = await this.commandBus.dispatch<Result<Record<string, unknown>, DomainError>>(
      'SyncPosOrders',
      body,
    );
    if (!res.ok) return mapOrderError(c, res.error);
    return c.json(res.value, 200);
  }

  async handleDeliveryWebhook(
    c: Context<AppEnv>,
    params: {
      provider: string;
    },
  ) {
    const rawBody = await c.req.raw.clone().text();
    const parsed = await this.deliveryProvider.parseWebhook(
      {
        'x-webhook-signature': c.req.header('x-webhook-signature'),
      },
      rawBody,
    );
    if (!parsed) {
      return c.json(
        {
          code: 'INVALID_WEBHOOK',
          error: 'Unrecognized courier payload',
        },
        400,
      );
    }

    const order = await this.orderRepo.findById(parsed.orderId);
    if (!order) {
      return c.json(
        {
          code: 'ORDER_NOT_FOUND',
          error: 'Target order not found',
        },
        404,
      );
    }

    if (parsed.mappedOrderStatus && order.snapshot.status !== parsed.mappedOrderStatus) {
      const trans = order.transitionTo(
        parsed.mappedOrderStatus,
        {
          reason: `Courier ${params.provider}: ${parsed.courierEventType}`,
          deliveryProviderCode: params.provider,
          externalDeliveryId: parsed.externalDeliveryId,
          providerPayloadSnapshot: parsed.rawPayload,
        },
        {
          requestId: this.request.requestId,
          actorId: this.request.actorId,
          restaurantId: order.snapshot.restaurantId,
        },
      );
      if (!trans.ok) return mapOrderError(c, trans.error);
      await this.orderRepo.save(order);
    }

    return c.json(
      {
        acknowledged: true,
        orderId: order.id,
        status: order.snapshot.status,
      },
      200,
    );
  }
}
