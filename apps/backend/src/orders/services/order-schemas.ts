import { createRoute, z } from '@hono/zod-openapi';
import {
  DomainErrorResponseSchema,
  ValidationErrorResponseSchema,
} from '@/core/services/openapi-shared';

export const OrderChannelSchema = z.enum([
  'DINE_IN',
  'TAKEAWAY',
  'ONLINE_DELIVERY',
  'POS',
]);

export const OrderStatusSchema = z.enum([
  'PENDING_PAYMENT',
  'PLACED',
  'ACCEPTED',
  'PREPARING',
  'PACKING',
  'READY_FOR_PICKUP',
  'OUT_FOR_DELIVERY',
  'COMPLETED',
  'CANCELLED',
  'REJECTED',
]);

export const PaymentChannelModeSchema = z.enum([
  'CASH',
  'COD',
  'CARD_TERMINAL',
  'ONLINE_GATEWAY',
  'LOYALTY_POINTS',
]);

export const LoyaltyWalletScopeSchema = z.enum([
  'PLATFORM',
  'MERCHANT',
]);

export const OrderLineInputSchema = z
  .object({
    menuItemId: z.uuid(),
    quantity: z.number().int().min(1),
    modifierIds: z.array(z.uuid()).optional(),
  })
  .openapi('OrderLineInput');

export const CartBranchParamSchema = z.object({
  branchId: z.uuid().openapi({
    param: {
      name: 'branchId',
      in: 'path',
    },
  }),
});

export const UpsertCartBodySchema = z
  .object({
    orderSource: OrderChannelSchema.default('ONLINE_DELIVERY'),
    promoCode: z.string().max(40).optional(),
    mergeWithExisting: z.boolean().optional(),
    lines: z.array(OrderLineInputSchema),
  })
  .openapi('UpsertCartBody');

export const PreviewOrderBodySchema = z
  .object({
    branchId: z.uuid(),
    orderSource: OrderChannelSchema.default('ONLINE_DELIVERY'),
    promoCode: z.string().max(40).optional(),
    items: z.array(OrderLineInputSchema).min(1),
  })
  .openapi('PreviewOrderBody');

export const CheckoutOrderBodySchema = z
  .object({
    branchId: z.uuid(),
    orderSource: OrderChannelSchema.default('ONLINE_DELIVERY'),
    paymentMode: PaymentChannelModeSchema,
    paymentToken: z.string().max(120).optional(),
    promoCode: z.string().max(40).optional(),
    loyaltyPointsToRedeem: z.number().int().min(1).optional(),
    loyaltyWalletScope: LoyaltyWalletScopeSchema.optional(),
    items: z.array(OrderLineInputSchema).optional(),
  })
  .openapi('CheckoutOrderBody');

export const PlacePosOrderBodySchema = z
  .object({
    clientOrderId: z.string().optional(),
    restaurantId: z.uuid().optional(),
    diningTableId: z.uuid().optional(),
    customerId: z.uuid().optional(),
    orderSource: OrderChannelSchema.default('DINE_IN'),
    items: z.array(OrderLineInputSchema).min(1),
  })
  .openapi('PlacePosOrderBody');

export const SettlePosOrderBodySchema = z
  .object({
    paymentMethod: PaymentChannelModeSchema,
    tipAmount: z.number().min(0).default(0),
    expectedRowVersion: z.number().int().min(1).optional(),
  })
  .openapi('SettlePosOrderBody');

export const TransitionOrderBodySchema = z
  .object({
    toStatus: OrderStatusSchema,
    expectedRowVersion: z.number().int().min(1).optional(),
    reason: z.string().max(255).optional(),
  })
  .openapi('TransitionOrderBody');

export const SyncPosOrdersBodySchema = z
  .object({
    orders: z
      .array(
        z.object({
          clientOrderId: z.string().min(3).max(80),
          posTerminalId: z.string().min(2).max(40),
          posReceiptNumber: z.string().min(2).max(40),
          occurredAt: z.iso.datetime(),
          orderSource: OrderChannelSchema.default('POS'),
          paymentMethod: PaymentChannelModeSchema,
          diningTableId: z.uuid().optional(),
          customerId: z.uuid().optional(),
          tipAmountGbp: z.number().min(0).optional(),
          items: z.array(OrderLineInputSchema).min(1),
        }),
      )
      .min(1)
      .max(50),
  })
  .openapi('SyncPosOrdersBody');

export const OrderIdParamSchema = z.object({
  id: z.uuid().openapi({
    param: {
      name: 'id',
      in: 'path',
    },
  }),
});

export const ListPosOrdersQuerySchema = z.object({
  restaurantId: z
    .uuid()
    .optional()
    .openapi({
      param: {
        name: 'restaurantId',
        in: 'query',
      },
    }),
});

export const getCartRoute = createRoute({
  method: 'get',
  path: '/cart/{branchId}',
  tags: [
    'Storefront Orders',
  ],
  summary: 'Fetch authenticated customer Redis cart for a branch',
  security: [
    {
      bearerAuth: [],
    },
  ],
  request: {
    params: CartBranchParamSchema,
  },
  responses: {
    200: {
      description: 'Customer cart',
      content: {
        'application/json': {
          schema: z.record(z.string(), z.unknown()),
        },
      },
    },
    401: {
      description: 'Unauthorized customer session',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
  },
});

export const upsertCartRoute = createRoute({
  method: 'put',
  path: '/cart/{branchId}',
  tags: [
    'Storefront Orders',
  ],
  summary: 'Save or merge guest cart items into Redis cart (24h TTL)',
  security: [
    {
      bearerAuth: [],
    },
  ],
  request: {
    params: CartBranchParamSchema,
    body: {
      required: true,
      content: {
        'application/json': {
          schema: UpsertCartBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated cart',
      content: {
        'application/json': {
          schema: z.record(z.string(), z.unknown()),
        },
      },
    },
    400: {
      description: 'Validation error',
      content: {
        'application/json': {
          schema: ValidationErrorResponseSchema,
        },
      },
    },
    401: {
      description: 'Unauthorized customer session',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
  },
});

export const previewOrderRoute = createRoute({
  method: 'post',
  path: '/preview',
  tags: [
    'Storefront Orders',
  ],
  summary: 'Authoritatively price items, promos, delivery fee, and UK VAT in GBP',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: PreviewOrderBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Authoritative GBP order quote',
      content: {
        'application/json': {
          schema: z.record(z.string(), z.unknown()),
        },
      },
    },
    400: {
      description: 'Validation or promo error',
      content: {
        'application/json': {
          schema: z.union([
            ValidationErrorResponseSchema,
            DomainErrorResponseSchema,
          ]),
        },
      },
    },
    401: {
      description: 'Unauthorized',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    403: {
      description: 'Forbidden',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    404: {
      description: 'Branch, item, or promo not found',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    409: {
      description: 'Conflict',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
  },
});

export const checkoutOrderRoute = createRoute({
  method: 'post',
  path: '/checkout',
  tags: [
    'Storefront Orders',
  ],
  summary: 'Authoritative idempotent storefront checkout with loyalty holds and gateway capture',
  security: [
    {
      bearerAuth: [],
    },
  ],
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: CheckoutOrderBodySchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Order placed',
      content: {
        'application/json': {
          schema: z.record(z.string(), z.unknown()),
        },
      },
    },
    400: {
      description: 'Validation or capability error',
      content: {
        'application/json': {
          schema: z.union([
            ValidationErrorResponseSchema,
            DomainErrorResponseSchema,
          ]),
        },
      },
    },
    401: {
      description: 'Unauthorized',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    403: {
      description: 'Forbidden or credit limit exceeded',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    404: {
      description: 'Not found',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    409: {
      description: 'Branch closed or concurrent idempotency lock',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
  },
});

export const getOrderDetailRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: [
    'Orders',
  ],
  summary: 'Get order details with immutable line modifier & VAT snapshots',
  security: [
    {
      bearerAuth: [],
    },
  ],
  request: {
    params: OrderIdParamSchema,
  },
  responses: {
    200: {
      description: 'Order details',
      content: {
        'application/json': {
          schema: z.record(z.string(), z.unknown()),
        },
      },
    },
    400: {
      description: 'Validation or domain error',
      content: {
        'application/json': {
          schema: z.union([
            ValidationErrorResponseSchema,
            DomainErrorResponseSchema,
          ]),
        },
      },
    },
    401: {
      description: 'Unauthorized',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    403: {
      description: 'Forbidden',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    404: {
      description: 'Order not found',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    409: {
      description: 'Conflict',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
  },
});

export const transitionOrderStatusRoute = createRoute({
  method: 'patch',
  path: '/{id}/status',
  tags: [
    'Orders',
  ],
  summary: 'Advance or cancel/reject order using branch-assigned named state machine',
  security: [
    {
      bearerAuth: [],
    },
  ],
  request: {
    params: OrderIdParamSchema,
    body: {
      required: true,
      content: {
        'application/json': {
          schema: TransitionOrderBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Order status updated',
      content: {
        'application/json': {
          schema: z.record(z.string(), z.unknown()),
        },
      },
    },
    400: {
      description: 'Invalid transition',
      content: {
        'application/json': {
          schema: z.union([
            ValidationErrorResponseSchema,
            DomainErrorResponseSchema,
          ]),
        },
      },
    },
    401: {
      description: 'Unauthorized',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    403: {
      description: 'Forbidden',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    404: {
      description: 'Order not found',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    409: {
      description: 'Optimistic lock conflict or terminal state',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
  },
});

export const placePosOrderRoute = createRoute({
  method: 'post',
  path: '/',
  tags: [
    'POS Orders',
  ],
  summary: 'Place an in-store POS order and generate KDS station tickets',
  security: [
    {
      bearerAuth: [],
    },
  ],
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: PlacePosOrderBodySchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'POS order created',
      content: {
        'application/json': {
          schema: z.record(z.string(), z.unknown()),
        },
      },
    },
    400: {
      description: 'Validation or domain error',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    401: {
      description: 'Unauthorized',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    403: {
      description: 'Forbidden',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    404: {
      description: 'Item or branch not found',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    409: {
      description: 'Conflict',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
  },
});

export const listPosOrdersRoute = createRoute({
  method: 'get',
  path: '/',
  tags: [
    'POS Orders',
  ],
  summary: 'List recent orders for the active POS branch',
  security: [
    {
      bearerAuth: [],
    },
  ],
  request: {
    query: ListPosOrdersQuerySchema,
  },
  responses: {
    200: {
      description: 'Branch orders',
      content: {
        'application/json': {
          schema: z.record(z.string(), z.unknown()),
        },
      },
    },
    400: {
      description: 'Missing tenant',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    401: {
      description: 'Unauthorized',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    403: {
      description: 'Forbidden',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    404: {
      description: 'Not found',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    409: {
      description: 'Conflict',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
  },
});

export const settlePosOrderRoute = createRoute({
  method: 'post',
  path: '/{id}/settle',
  tags: [
    'POS Orders',
  ],
  summary: 'Settle an open POS order bill and trigger double-entry billing saga',
  security: [
    {
      bearerAuth: [],
    },
  ],
  request: {
    params: OrderIdParamSchema,
    body: {
      required: true,
      content: {
        'application/json': {
          schema: SettlePosOrderBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Order settled',
      content: {
        'application/json': {
          schema: z.record(z.string(), z.unknown()),
        },
      },
    },
    400: {
      description: 'Already settled or invalid input',
      content: {
        'application/json': {
          schema: z.union([
            ValidationErrorResponseSchema,
            DomainErrorResponseSchema,
          ]),
        },
      },
    },
    401: {
      description: 'Unauthorized',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    403: {
      description: 'Forbidden',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    404: {
      description: 'Order not found',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    409: {
      description: 'Optimistic concurrency conflict',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
  },
});

export const syncPosOrdersRoute = createRoute({
  method: 'post',
  path: '/sync',
  tags: [
    'POS Orders',
  ],
  summary: 'Batch-sync offline POS orders (max 50) with clientOrderId deduplication',
  security: [
    {
      bearerAuth: [],
    },
  ],
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: SyncPosOrdersBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Batch sync summary',
      content: {
        'application/json': {
          schema: z.record(z.string(), z.unknown()),
        },
      },
    },
    400: {
      description: 'Invalid batch',
      content: {
        'application/json': {
          schema: z.union([
            ValidationErrorResponseSchema,
            DomainErrorResponseSchema,
          ]),
        },
      },
    },
    401: {
      description: 'Unauthorized',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    403: {
      description: 'Forbidden',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    404: {
      description: 'Item not found',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    409: {
      description: 'Conflict',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
  },
});

export const deliveryWebhookRoute = createRoute({
  method: 'post',
  path: '/{provider}',
  tags: [
    'Delivery Webhooks',
  ],
  summary: 'Inbound normalized UK 3PL courier status webhook (Stuart, Uber Direct, Gophr)',
  request: {
    params: z.object({
      provider: z
        .string()
        .min(2)
        .max(40)
        .openapi({
          param: {
            name: 'provider',
            in: 'path',
          },
        }),
    }),
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z.record(z.string(), z.unknown()),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Webhook processed',
      content: {
        'application/json': {
          schema: z.record(z.string(), z.unknown()),
        },
      },
    },
    400: {
      description: 'Malformed webhook payload',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    401: {
      description: 'Unauthorized',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    403: {
      description: 'Forbidden',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    404: {
      description: 'Order not found',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    409: {
      description: 'Conflict',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
  },
});
