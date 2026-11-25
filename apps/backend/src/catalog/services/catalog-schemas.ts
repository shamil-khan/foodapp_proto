import { createRoute, z } from '@hono/zod-openapi';
import {
  DomainErrorResponseSchema,
  SuccessFlagResponseSchema,
  ValidationErrorResponseSchema,
} from '@/core/services/openapi-shared';

export const MenuPricingModeSchema = z.enum([
  'CENTRAL_LOCKED',
  'BRANCH_DIRECT',
  'BRANCH_APPROVAL_REQUIRED',
  'THRESHOLD_HYBRID',
]);

export const BranchIdParamSchema = z.object({
  branchId: z.uuid().openapi({
    param: {
      name: 'branchId',
      in: 'path',
    },
  }),
});

export const ItemIdParamSchema = z.object({
  itemId: z.uuid().openapi({
    param: {
      name: 'itemId',
      in: 'path',
    },
  }),
});

export const UpsertPricingPolicyBodySchema = z.object({
  restaurantId: z.uuid().optional(),
  branchId: z.uuid().nullable().optional(),
  menuPricingMode: MenuPricingModeSchema,
  maxDirectPriceDeltaPercent: z.number().min(0).max(100),
  allowBranchLocalItems: z.boolean(),
  maxDirectOrderDiscountPercent: z.number().min(0).max(100),
  allowFullCompWaiveOff: z.boolean(),
  requireReasonForCompOrDiscount: z.boolean(),
  maxDirectRefundAmount: z.number().min(0),
});

export const UpsertBranchMenuOverrideBodySchema = z.object({
  isIncluded: z.boolean().optional(),
  isAvailable: z.boolean().optional(),
  proposedPrice: z.number().min(0).nullable().optional(),
});

export const ReviewPriceOverrideBodySchema = z.object({
  decision: z.enum([
    'APPROVED',
    'REJECTED',
  ]),
  reviewNote: z.string().max(255).optional(),
});

export const CreateMenuItemBodySchema = z.object({
  restaurantId: z.uuid().optional(),
  categoryId: z.uuid(),
  branchId: z.uuid().nullable().optional(),
  name: z.string().min(2).max(120),
  description: z.string().optional(),
  basePrice: z.number().min(0),
  vatRate: z.number().min(0).max(100).optional(),
  allergenFlags: z.array(z.string()).optional(),
  ingredientTags: z.array(z.string()).optional(),
  kdsTarget: z
    .enum([
      'KITCHEN_SCREEN',
      'BAR_PRINTER',
      'PASTRY_STATION',
    ])
    .optional(),
});

export const getBranchMenuSnapshotRoute = createRoute({
  method: 'get',
  path: '/branches/{branchId}/menu',
  tags: [
    'Catalog',
  ],
  summary:
    'Fetch compiled branch menu snapshot with optional ingredient hashtag filter (?tag=#cheese)',
  request: {
    params: BranchIdParamSchema,
    query: z.object({
      tag: z
        .string()
        .optional()
        .openapi({
          param: {
            name: 'tag',
            in: 'query',
          },
        }),
    }),
  },
  responses: {
    200: {
      description: 'Compiled branch menu',
      content: {
        'application/json': {
          schema: z.record(z.string(), z.unknown()),
        },
      },
    },
    404: {
      description: 'Branch menu not found',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
  },
});

export const upsertPricingPolicyRoute = createRoute({
  method: 'put',
  path: '/pricing-policy',
  tags: [
    'POS Catalog & Pricing',
  ],
  summary: 'Configure brand-wide or branch-level pricing workflow and POS floor discount/comp caps',
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
          schema: UpsertPricingPolicyBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Pricing policy saved',
      content: {
        'application/json': {
          schema: SuccessFlagResponseSchema,
        },
      },
    },
    400: {
      description: 'Validation or domain rule error',
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

export const upsertBranchMenuOverrideRoute = createRoute({
  method: 'put',
  path: '/branches/{branchId}/menu/{itemId}',
  tags: [
    'POS Catalog & Pricing',
  ],
  summary: 'Set branch item opt-in/availability or propose/apply branch price override',
  security: [
    {
      bearerAuth: [],
    },
  ],
  request: {
    params: BranchIdParamSchema.merge(ItemIdParamSchema),
    body: {
      required: true,
      content: {
        'application/json': {
          schema: UpsertBranchMenuOverrideBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Branch menu override saved',
      content: {
        'application/json': {
          schema: z.record(z.string(), z.unknown()),
        },
      },
    },
    400: {
      description: 'Validation or domain rule error',
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
      description: 'Forbidden or CENTRAL_LOCKED',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    404: {
      description: 'Branch or item not found',
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

export const reviewPriceOverrideRoute = createRoute({
  method: 'post',
  path: '/branches/{branchId}/menu/{itemId}/review',
  tags: [
    'POS Catalog & Pricing',
  ],
  summary: 'Approve or reject a pending branch price override proposal',
  security: [
    {
      bearerAuth: [],
    },
  ],
  request: {
    params: BranchIdParamSchema.merge(ItemIdParamSchema),
    body: {
      required: true,
      content: {
        'application/json': {
          schema: ReviewPriceOverrideBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Price override reviewed',
      content: {
        'application/json': {
          schema: SuccessFlagResponseSchema,
        },
      },
    },
    400: {
      description: 'Validation or domain rule error',
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
      description: 'No pending override',
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

export const createMenuItemRoute = createRoute({
  method: 'post',
  path: '/items',
  tags: [
    'POS Catalog & Pricing',
  ],
  summary: 'Create a brand-wide or branch-local menu item with ingredient hashtags',
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
          schema: CreateMenuItemBodySchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Menu item created',
      content: {
        'application/json': {
          schema: z.record(z.string(), z.unknown()),
        },
      },
    },
    400: {
      description: 'Validation or domain rule error',
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
      description: 'Category not found',
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
