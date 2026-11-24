// FILE: apps/backend/src/support/services/support-schemas.ts (Part 1 of 2)
import { PLATFORM_SUPPORT_SCOPES } from '@foodapp/db';
import { createRoute, z } from '@hono/zod-openapi';
import {
  DomainErrorResponseSchema,
  SuccessFlagResponseSchema,
  ValidationErrorResponseSchema,
} from '@/core/services/openapi-shared';

export const PlatformSupportScopeSchema = z
  .enum(PLATFORM_SUPPORT_SCOPES)
  .openapi('PlatformSupportScope');

export const CreateSupportTicketBodySchema = z
  .object({
    restaurantId: z.uuid().optional(),
    branchId: z.uuid().nullable().optional(),
    assignedPlatformUserId: z.uuid().nullable().optional(),
    scopePermission: PlatformSupportScopeSchema,
    reason: z.string().min(5).max(500),
    attachmentUrl: z.url().nullable().optional(),
    attachmentNote: z.string().max(1000).nullable().optional(),
    expiresInHours: z.number().int().min(1).max(24).default(4),
  })
  .openapi('CreateSupportTicketBody');

export const TicketIdParamSchema = z.object({
  ticketId: z.uuid().openapi({
    param: {
      name: 'ticketId',
      in: 'path',
    },
  }),
});

export const ListSupportTicketsQuerySchema = z.object({
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
// FILE: apps/backend/src/support/services/support-schemas.ts (Part 2 of 2)
// FILE: apps/backend/src/support/services/support-schemas.ts (Part 2 of 3)
export const createSupportTicketRoute = createRoute({
  method: 'post',
  path: '/',
  tags: [
    'Brand Support Authorization',
  ],
  summary:
    'Create and approve a time-bound JIT support ticket (with optional catalog menu photo/note)',
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
          schema: CreateSupportTicketBodySchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Approved JIT support ticket created',
      content: {
        'application/json': {
          schema: z.object({
            ticketId: z.uuid(),
            status: z.literal('APPROVED'),
            expiresAt: z.string(),
          }),
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

export const listSupportTicketsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: [
    'Brand Support Authorization',
  ],
  summary: 'List JIT support tickets for the active brand',
  security: [
    {
      bearerAuth: [],
    },
  ],
  request: {
    query: ListSupportTicketsQuerySchema,
  },
  responses: {
    200: {
      description: 'Brand JIT support tickets',
      content: {
        'application/json': {
          schema: z.object({
            tickets: z.array(z.record(z.string(), z.unknown())),
          }),
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
// FILE: apps/backend/src/support/services/support-schemas.ts (Part 3 of 3)
export const revokeSupportTicketRoute = createRoute({
  method: 'patch',
  path: '/{ticketId}/revoke',
  tags: [
    'Brand Support Authorization',
  ],
  summary: 'Immediately revoke an active JIT support ticket',
  security: [
    {
      bearerAuth: [],
    },
  ],
  request: {
    params: TicketIdParamSchema,
  },
  responses: {
    200: {
      description: 'Support ticket revoked',
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
      description: 'Ticket not found',
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
