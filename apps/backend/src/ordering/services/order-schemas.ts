import { createRoute, z } from '@hono/zod-openapi';
import {
  DomainErrorResponseSchema,
  ValidationErrorResponseSchema,
} from '@/core/services/openapi-shared';

export const OrderLineInputSchema = z
  .object({
    menuItemId: z.uuid(),
    quantity: z.number().int().min(1),
    modifierIds: z.array(z.uuid()).optional(),
  })
  .openapi('OrderLineInput');

export const PlacePosOrderBodySchema = z
  .object({
    clientOrderId: z.string().optional(),
    restaurantId: z.uuid().optional(),
    diningTableId: z.uuid().optional(),
    customerId: z.uuid().optional(),
    orderSource: z
      .enum([
        'DINE_IN',
        'TAKEAWAY',
        'ONLINE_DELIVERY',
      ])
      .default('DINE_IN'),
    items: z.array(OrderLineInputSchema).min(1),
  })
  .openapi('PlacePosOrderBody');

export const KdsStationSlipSchema = z
  .object({
    itemName: z.string(),
    qty: z.number().int(),
    mods: z.array(z.string()),
  })
  .openapi('KdsStationSlip');

export const KdsTicketOutputSchema = z
  .object({
    orderId: z.uuid(),
    tableId: z.uuid().optional(),
    stationSlips: z.object({
      KITCHEN_SCREEN: z.array(KdsStationSlipSchema),
      BAR_PRINTER: z.array(KdsStationSlipSchema),
      PASTRY_STATION: z.array(KdsStationSlipSchema),
    }),
  })
  .openapi('KdsTicketOutput');

export const PlacePosOrderResponseSchema = z
  .object({
    orderId: z.uuid(),
    kdsTickets: KdsTicketOutputSchema,
  })
  .openapi('PlacePosOrderResponse');

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

export const PosOrderSummarySchema = z
  .object({
    id: z.uuid(),
    restaurantId: z.uuid(),
    diningTableId: z.uuid().nullable(),
    orderSource: z.string(),
    paymentMethod: z.string(),
    subtotal: z.string(),
    vatTotal: z.string(),
    tipAmount: z.string(),
    totalAmount: z.string(),
    rowVersion: z.number().int(),
    latestMilestone: z.string(),
    createdAt: z.string(),
  })
  .openapi('PosOrderSummary');

export const ListPosOrdersResponseSchema = z
  .object({
    orders: z.array(PosOrderSummarySchema),
  })
  .openapi('ListPosOrdersResponse');

export const OrderIdParamSchema = z.object({
  id: z.uuid().openapi({
    param: {
      name: 'id',
      in: 'path',
    },
  }),
});

export const SettlePosOrderBodySchema = z
  .object({
    paymentMethod: z.enum([
      'CASH',
      'CARD_TERMINAL',
      'ONLINE_GATEWAY',
    ]),
    tipAmount: z.number().min(0).default(0),
  })
  .openapi('SettlePosOrderBody');

export const SettlePosOrderResponseSchema = z
  .object({
    success: z.literal(true),
    orderId: z.uuid(),
  })
  .openapi('SettlePosOrderResponse');

export const placePosOrderRoute = createRoute({
  method: 'post',
  path: '/',
  tags: [
    'Ordering',
  ],
  summary: 'Place a new POS order and dispatch KDS station slips (requires orders:place right)',
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
      description: 'Order created and KDS tickets generated',
      content: {
        'application/json': {
          schema: PlacePosOrderResponseSchema,
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
      description: 'Unauthorized POS staff session',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    403: {
      description: 'Cross-tenant access denied or missing orders:place right',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    404: {
      description: 'Menu item unavailable or not found',
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
    'Ordering',
  ],
  summary: 'List recent POS orders for the active restaurant (requires orders:read right)',
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
      description: 'Restaurant POS orders',
      content: {
        'application/json': {
          schema: ListPosOrdersResponseSchema,
        },
      },
    },
    400: {
      description: 'Missing restaurantId or invalid query',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    401: {
      description: 'Unauthorized POS staff session',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    403: {
      description: 'Cross-tenant access denied or missing orders:read right',
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
    'Ordering',
  ],
  summary:
    'Settle an open POS order bill and trigger financial ledger saga (requires orders:settle right)',
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
          schema: SettlePosOrderResponseSchema,
        },
      },
    },
    400: {
      description: 'Invalid order state transition or validation error',
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
      description: 'Unauthorized POS staff session',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    403: {
      description: 'Cross-tenant access denied or missing orders:settle right',
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
  },
});
