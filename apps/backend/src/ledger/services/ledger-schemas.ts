import { createRoute, z } from '@hono/zod-openapi';
import {
  DomainErrorResponseSchema,
  PaginationQuerySchema,
  ValidationErrorResponseSchema,
} from '@/core/services/openapi-shared';

export const RestaurantLedgerQuerySchema = PaginationQuerySchema.extend({
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

export const LedgerEntrySchema = z
  .object({
    id: z.uuid(),
    orderId: z.uuid().nullable(),
    entityName: z.string(),
    creditAmount: z.string(),
    debitAmount: z.string(),
    description: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('LedgerEntry');

export const GetRestaurantLedgerResponseSchema = z
  .object({
    entries: z.array(LedgerEntrySchema),
  })
  .openapi('GetRestaurantLedgerResponse');

export const LoyaltyTransactionSchema = z
  .object({
    id: z.uuid(),
    restaurantId: z.uuid().nullable(),
    orderId: z.uuid().nullable(),
    txType: z.enum([
      'EARNED',
      'REDEEMED',
    ]),
    pointsDelta: z.number().int(),
    createdAt: z.string(),
  })
  .openapi('LoyaltyTransaction');

export const GetUserLoyaltyBalanceResponseSchema = z
  .object({
    totalPoints: z.number().int(),
    history: z.array(LoyaltyTransactionSchema),
  })
  .openapi('GetUserLoyaltyBalanceResponse');

export const RedeemLoyaltyPointsBodySchema = z
  .object({
    restaurantId: z.uuid().optional(),
    orderId: z.uuid().optional(),
    pointsToRedeem: z.number().int().min(1).openapi({
      example: 250,
    }),
  })
  .openapi('RedeemLoyaltyPointsBody');

export const RedeemLoyaltyPointsResponseSchema = z
  .object({
    remainingBalance: z.number().int(),
  })
  .openapi('RedeemLoyaltyPointsResponse');

export const getRestaurantLedgerRoute = createRoute({
  method: 'get',
  path: '/restaurant',
  tags: [
    'Ledger & Loyalty',
  ],
  summary: 'Get double-entry financial ledger for a restaurant (OWNER & ADMIN only)',
  security: [
    {
      bearerAuth: [],
    },
  ],
  request: {
    query: RestaurantLedgerQuerySchema,
  },
  responses: {
    200: {
      description: 'Financial ledger entries',
      content: {
        'application/json': {
          schema: GetRestaurantLedgerResponseSchema,
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
      description: 'Forbidden: requires OWNER or ADMIN role',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
  },
});

export const getMyLoyaltyBalanceRoute = createRoute({
  method: 'get',
  path: '/loyalty/me',
  tags: [
    'Ledger & Loyalty',
  ],
  summary: 'Get current customer loyalty point balance and transaction history',
  security: [
    {
      bearerAuth: [],
    },
  ],
  responses: {
    200: {
      description: 'Customer loyalty summary',
      content: {
        'application/json': {
          schema: GetUserLoyaltyBalanceResponseSchema,
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

export const redeemLoyaltyPointsRoute = createRoute({
  method: 'post',
  path: '/loyalty/redeem',
  tags: [
    'Ledger & Loyalty',
  ],
  summary: 'Redeem customer loyalty points',
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
          schema: RedeemLoyaltyPointsBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Points redeemed and remaining balance returned',
      content: {
        'application/json': {
          schema: RedeemLoyaltyPointsResponseSchema,
        },
      },
    },
    400: {
      description: 'Insufficient points or validation error',
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
