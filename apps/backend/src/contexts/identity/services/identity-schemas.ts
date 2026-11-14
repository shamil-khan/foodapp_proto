import { createRoute, z } from '@hono/zod-openapi';
import {
  DomainErrorResponseSchema,
  SuccessFlagResponseSchema,
  ValidationErrorResponseSchema,
} from '@/core/services/openapi-shared';

export const PosLoginBodySchema = z
  .object({
    email: z.email().openapi({
      example: 'manager@spicegarden.co.uk',
    }),
    password: z.string().min(1).openapi({
      example: 'ShiftPass123!',
    }),
  })
  .openapi('PosLoginBody');

export const PosStaffClaimsSchema = z
  .object({
    staffId: z.uuid(),
    restaurantId: z.uuid(),
    role: z.enum([
      'OWNER',
      'ADMIN',
      'MANAGER',
      'ORDER_TAKER',
    ]),
    name: z.string(),
    email: z.email(),
  })
  .openapi('PosStaffClaims');

export const PosLoginResponseSchema = z
  .object({
    success: z.literal(true),
    token: z.string().openapi({
      description: 'HS256 POS shift JWT (12h TTL)',
    }),
    staff: PosStaffClaimsSchema,
  })
  .openapi('PosLoginResponse');

export const ActiveActorProfileSchema = z
  .object({
    id: z.uuid(),
    source: z.enum([
      'GLOBAL_USER',
      'POS_STAFF',
      'SYSTEM',
    ]),
    name: z.string(),
    email: z.email(),
    role: z.string(),
    restaurantId: z.uuid().optional(),
  })
  .openapi('ActiveActorProfile');

export const GetCurrentActorResponseSchema = z
  .object({
    actor: ActiveActorProfileSchema,
  })
  .openapi('GetCurrentActorResponse');

export const loginPosStaffRoute = createRoute({
  method: 'post',
  path: '/pos/auth/login',
  tags: [
    'Identity',
  ],
  summary: 'Authenticate POS tenant staff and issue 12-hour shift JWT',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: PosLoginBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Authenticated POS staff session',
      content: {
        'application/json': {
          schema: PosLoginResponseSchema,
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
      description: 'Invalid POS staff credentials',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
  },
});

export const logoutPosStaffRoute = createRoute({
  method: 'post',
  path: '/pos/auth/logout',
  tags: [
    'Identity',
  ],
  summary: 'Clear POS staff shift cookie session',
  security: [
    {
      bearerAuth: [],
    },
  ],
  responses: {
    200: {
      description: 'Shift session cleared',
      content: {
        'application/json': {
          schema: SuccessFlagResponseSchema,
        },
      },
    },
  },
});

export const getCurrentActorRoute = createRoute({
  method: 'get',
  path: '/me',
  tags: [
    'Identity',
  ],
  summary: 'Get currently authenticated actor (Better Auth Global User or POS Staff JWT)',
  security: [
    {
      bearerAuth: [],
    },
  ],
  responses: {
    200: {
      description: 'Active actor profile',
      content: {
        'application/json': {
          schema: GetCurrentActorResponseSchema,
        },
      },
    },
    401: {
      description: 'Not authenticated',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
  },
});
