import { createRoute, z } from '@hono/zod-openapi';
import {
  DomainErrorResponseSchema,
  ValidationErrorResponseSchema,
} from '@/core/services/openapi-shared';

const BadRequestUnionSchema = z.union([
  ValidationErrorResponseSchema,
  DomainErrorResponseSchema,
]);

export const getRestaurantBillingRoute = createRoute({
  method: 'get',
  path: '/restaurant',
  tags: [
    'Billing & Accounting',
  ],
  summary: 'Get double-entry ledger balances, journal lines, and B2B settlements',
  security: [
    {
      bearerAuth: [],
    },
  ],
  request: {
    query: z.object({
      restaurantId: z
        .uuid()
        .optional()
        .openapi({
          param: {
            name: 'restaurantId',
            in: 'query',
          },
        }),
    }),
  },
  responses: {
    200: {
      description: 'Restaurant billing summary',
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
          schema: BadRequestUnionSchema,
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

export const refundOrderRoute = createRoute({
  method: 'post',
  path: '/refunds',
  tags: [
    'Billing & Accounting',
  ],
  summary: 'Issue full or partial GBP refund via gateway and post reversing journal lines',
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
          schema: z.object({
            orderId: z.uuid(),
            amountGbp: z.string().regex(/^\d+(\.\d{1,2})?$/),
            reason: z.string().min(3).max(255),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Refund recorded',
      content: {
        'application/json': {
          schema: z.object({
            refundReference: z.string(),
          }),
        },
      },
    },
    400: {
      description: 'Validation or refund limit error',
      content: {
        'application/json': {
          schema: BadRequestUnionSchema,
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

export const settleMerchantRoute = createRoute({
  method: 'post',
  path: '/merchants/{restaurantId}/settle',
  tags: [
    'Billing & Accounting',
  ],
  summary: 'Net online payable against cash/COD commission receivable and B2B loyalty offsets',
  security: [
    {
      bearerAuth: [],
    },
  ],
  request: {
    params: z.object({
      restaurantId: z.uuid().openapi({
        param: {
          name: 'restaurantId',
          in: 'path',
        },
      }),
    }),
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z.object({
            applyLoyaltyOffset: z.boolean().optional(),
            markPaidReference: z.string().max(100).optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'B2B merchant settlement created',
      content: {
        'application/json': {
          schema: z.object({
            settlementId: z.string(),
            netPayoutGbp: z.string(),
          }),
        },
      },
    },
    400: {
      description: 'Validation or domain error',
      content: {
        'application/json': {
          schema: BadRequestUnionSchema,
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
      description: 'Merchant frozen or forbidden',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    404: {
      description: 'Merchant not found',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    409: {
      description: 'Nothing to settle',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
  },
});
