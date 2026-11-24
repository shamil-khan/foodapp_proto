import { createRoute, z } from '@hono/zod-openapi';
import {
  DomainErrorResponseSchema,
  SuccessFlagResponseSchema,
  ValidationErrorResponseSchema,
} from '@/core/services/openapi-shared';

const BadRequestUnionSchema = z.union([
  ValidationErrorResponseSchema,
  DomainErrorResponseSchema,
]);

export const LoyaltyScopeSchema = z.enum([
  'PLATFORM',
  'MERCHANT',
]);
export const LoyaltyProgramStatusSchema = z.enum([
  'ACTIVE',
  'PAUSED_REDEEM',
  'FROZEN',
]);

export const GetCustomerLoyaltyQuerySchema = z.object({
  scope: LoyaltyScopeSchema.optional().openapi({
    param: {
      name: 'scope',
      in: 'query',
    },
  }),
  merchantId: z
    .uuid()
    .optional()
    .openapi({
      param: {
        name: 'merchantId',
        in: 'query',
      },
    }),
});

export const UpdateLoyaltyGovernanceBodySchema = z.object({
  issuerScope: LoyaltyScopeSchema,
  restaurantId: z.uuid().nullable().optional(),
  status: LoyaltyProgramStatusSchema,
  freezeExpiry: z.boolean().optional(),
  statusReason: z.string().min(3).max(255),
});

export const AuditLoyaltyEntryBodySchema = z.object({
  action: z.enum([
    'HOLD',
    'APPROVE',
    'REVOKE',
  ]),
  reason: z.string().min(3).max(255),
});

export const getMyLoyaltyWalletRoute = createRoute({
  method: 'get',
  path: '/me',
  tags: [
    'Loyalty',
  ],
  summary: 'Get authenticated customer available, held, and pending-maturation loyalty points',
  security: [
    {
      bearerAuth: [],
    },
  ],
  request: {
    query: GetCustomerLoyaltyQuerySchema,
  },
  responses: {
    200: {
      description: 'Customer loyalty wallet summary',
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
  },
});

export const updateLoyaltyGovernanceRoute = createRoute({
  method: 'patch',
  path: '/governance',
  tags: [
    'Loyalty Governance',
  ],
  summary: 'Freeze, pause redemptions, or reactivate platform/merchant loyalty program',
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
          schema: UpdateLoyaltyGovernanceBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Governance updated',
      content: {
        'application/json': {
          schema: SuccessFlagResponseSchema,
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
  },
});

export const auditLoyaltyEntryRoute = createRoute({
  method: 'post',
  path: '/entries/{entryId}/audit',
  tags: [
    'Loyalty Governance',
  ],
  summary: 'Place AUDIT_HOLD, APPROVE to AVAILABLE, or append REVOKED clawback (PLATFORM_ADMIN)',
  security: [
    {
      bearerAuth: [],
    },
  ],
  request: {
    params: z.object({
      entryId: z.uuid().openapi({
        param: {
          name: 'entryId',
          in: 'path',
        },
      }),
    }),
    body: {
      required: true,
      content: {
        'application/json': {
          schema: AuditLoyaltyEntryBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Audit action applied',
      content: {
        'application/json': {
          schema: SuccessFlagResponseSchema,
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
      description: 'Entry not found',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
  },
});
