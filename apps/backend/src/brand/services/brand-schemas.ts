// FILE: apps/backend/src/brand/services/brand-schemas.ts (Part 1 of 4)
import { createRoute, z } from '@hono/zod-openapi';
import { RESERVED_BRAND_HANDLES } from '@/brand/application/brand-commands';
import {
  DomainErrorResponseSchema,
  PaginationQuerySchema,
  SuccessFlagResponseSchema,
  ValidationErrorResponseSchema,
} from '@/core/services/openapi-shared';

export const KitchenTypeSchema = z.enum([
  'RESTAURANT_BRANCH',
  'HOME_KITCHEN',
  'CLOUD_KITCHEN',
]);
export const OperationalStatusSchema = z.enum([
  'OPEN',
  'BUSY_PAUSED',
  'CLOSED',
  'HOLIDAY',
]);

export const StorefrontBrandSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    handle: z.string(),
    logoUrl: z.string().nullable(),
    description: z.string().nullable(),
    foodHygieneRating: z.number().int().nullable(),
    branding: z
      .object({
        templateId: z.string(),
        primaryColor: z.string(),
        bannerUrl: z.string().nullable(),
        galleryImages: z.unknown(),
      })
      .nullable(),
  })
  .openapi('StorefrontBrand');

export const BrandHandleParamSchema = z.object({
  brand: z
    .string()
    .min(2)
    .max(63)
    .openapi({
      param: {
        name: 'brand',
        in: 'path',
      },
      example: 'pizza-hut',
    }),
});

export const BranchSlugParamsSchema = z.object({
  brand: z
    .string()
    .min(2)
    .max(63)
    .openapi({
      param: {
        name: 'brand',
        in: 'path',
      },
      example: 'pizza-hut',
    }),
  city: z
    .string()
    .min(2)
    .max(63)
    .openapi({
      param: {
        name: 'city',
        in: 'path',
      },
      example: 'bristol',
    }),
  branch: z
    .string()
    .min(2)
    .max(63)
    .openapi({
      param: {
        name: 'branch',
        in: 'path',
      },
      example: 'clifton',
    }),
});

export const BranchIdParamSchema = z.object({
  branchId: z.uuid().openapi({
    param: {
      name: 'branchId',
      in: 'path',
    },
  }),
});
// FILE: apps/backend/src/brand/services/brand-schemas.ts (Part 2 of 4)
export const RegisterBrandBodySchema = z
  .object({
    brandName: z.string().min(2).max(120),
    handle: z
      .string()
      .min(2)
      .max(63)
      .regex(/^[a-z0-9-]+$/i)
      .refine((val) => !RESERVED_BRAND_HANDLES.has(val.trim().toLowerCase()), {
        message: 'This brand handle is reserved by the platform.',
      }),
    logoUrl: z.string().optional(),
    description: z.string().optional(),
    kitchenType: KitchenTypeSchema,
    isMultiBranchEnterprise: z.boolean().optional(),
    branchName: z.string().min(2).max(120),
    branchKey: z.string().min(2).max(63).optional(),
    city: z.string().min(2).max(80),
    postcodeSector: z.string().min(2).max(20),
    streetAddress: z.string().min(4).max(255),
    areaLocality: z.string().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    contactPersonName: z.string().min(2).max(100),
    contactPersonPhone: z.string().min(5).max(30),
    contactPersonEmail: z.email().optional(),
    supportsDineIn: z.boolean().optional(),
    supportsTakeaway: z.boolean().optional(),
    supportsPlatformDelivery: z.boolean().optional(),
    dropPointConfig: z
      .object({
        label: z.string().min(2),
        areaLocality: z.string().optional(),
        instructions: z.string().optional(),
        latitude: z.number().optional(),
        longitude: z.number().optional(),
      })
      .nullable()
      .optional(),
    ownerName: z.string().min(2).max(100),
    ownerEmail: z.email(),
    ownerPassword: z.string().min(8),
  })
  .openapi('RegisterBrandBody');

export const CreateBranchBodySchema = z
  .object({
    restaurantId: z.uuid().optional(),
    name: z.string().min(2).max(120),
    branchKey: z.string().min(2).max(63).optional(),
    city: z.string().min(2).max(80),
    kitchenType: KitchenTypeSchema.default('RESTAURANT_BRANCH'),
    postcodeSector: z.string().min(2).max(20),
    streetAddress: z.string().min(4).max(255),
    areaLocality: z.string().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    contactPersonName: z.string().min(2).max(100),
    contactPersonPhone: z.string().min(5).max(30),
    contactPersonEmail: z.email().optional(),
    supportsDineIn: z.boolean().optional(),
    supportsTakeaway: z.boolean().optional(),
    supportsPlatformDelivery: z.boolean().optional(),
    menuSelectionMode: z
      .enum([
        'ALL_BRAND_ITEMS',
        'SELECTED_ITEMS_ONLY',
      ])
      .optional(),
  })
  .openapi('CreateBranchBody');

export const UpdateBranchStatusBodySchema = z.object({
  operationalStatus: OperationalStatusSchema,
  reason: z.string().max(255).optional(),
});

export const UpdateBranchSettingsBodySchema = z.object({
  supportsDineIn: z.boolean().optional(),
  supportsTakeaway: z.boolean().optional(),
  supportsPlatformDelivery: z.boolean().optional(),
  homePickupPrivacyMode: z
    .enum([
      'ORDER_ACCEPTANCE',
      'WHITELIST',
    ])
    .optional(),
  dropPointConfig: z
    .object({
      label: z.string().min(2),
      areaLocality: z.string().optional(),
      instructions: z.string().optional(),
      latitude: z.number().optional(),
      longitude: z.number().optional(),
    })
    .nullable()
    .optional(),
  menuSelectionMode: z
    .enum([
      'ALL_BRAND_ITEMS',
      'SELECTED_ITEMS_ONLY',
    ])
    .optional(),
  scheduleConfig: z.record(z.string(), z.unknown()).optional(),
  contactPersonName: z.string().optional(),
  contactPersonPhone: z.string().optional(),
  contactPersonEmail: z.email().nullable().optional(),
});

export const ReviewWhitelistBodySchema = z.object({
  customerUserId: z.uuid(),
  decision: z.enum([
    'APPROVED',
    'REJECTED',
  ]),
});
// FILE: apps/backend/src/brand/services/brand-schemas.ts (Part 3 of 4)
export const listBrandsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: [
    'Brands',
  ],
  summary: 'List active storefront brands',
  request: {
    query: PaginationQuerySchema.extend({
      search: z
        .string()
        .optional()
        .openapi({
          param: {
            name: 'search',
            in: 'query',
          },
        }),
    }),
  },
  responses: {
    200: {
      description: 'Active brands',
      content: {
        'application/json': {
          schema: z.object({
            brands: z.array(StorefrontBrandSchema),
          }),
        },
      },
    },
  },
});

export const registerBrandRoute = createRoute({
  method: 'post',
  path: '/register',
  tags: [
    'Brands',
  ],
  summary: 'Self-service seller registration for home kitchen, cloud kitchen, or restaurant brand',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: RegisterBrandBodySchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Brand and initial branch registered',
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
      description: 'Handle already taken',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
  },
});

export const resolveBrandByHandleRoute = createRoute({
  method: 'get',
  path: '/{brand}',
  tags: [
    'Brands',
  ],
  summary: 'Resolve single-location kitchen/restaurant or multi-branch city tree by brand handle',
  request: {
    params: BrandHandleParamSchema,
  },
  responses: {
    200: {
      description: 'Resolved brand storefront',
      content: {
        'application/json': {
          schema: z.record(z.string(), z.unknown()),
        },
      },
    },
    404: {
      description: 'Brand not found',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
  },
});

export const resolveBranchBySlugRoute = createRoute({
  method: 'get',
  path: '/{brand}/{city}/{branch}',
  tags: [
    'Brands',
  ],
  summary: 'Resolve specific branch by brand handle, city, and branch slug',
  request: {
    params: BranchSlugParamsSchema,
  },
  responses: {
    200: {
      description: 'Resolved branch',
      content: {
        'application/json': {
          schema: z.record(z.string(), z.unknown()),
        },
      },
    },
    404: {
      description: 'Branch not found',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
  },
});
// FILE: apps/backend/src/brand/services/brand-schemas.ts (Part 4 of 4)
export const createBrandBranchRoute = createRoute({
  method: 'post',
  path: '/branches',
  tags: [
    'POS Brands & Branches',
  ],
  summary: 'Create a new branch under the active brand',
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
          schema: CreateBranchBodySchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Branch created',
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
      description: 'Not found',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    409: {
      description: 'Duplicate branch key in city',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
  },
});

export const updateBranchStatusRoute = createRoute({
  method: 'patch',
  path: '/branches/{branchId}/status',
  tags: [
    'POS Brands & Branches',
  ],
  summary: 'Update branch daily status (BUSY_PAUSED locks changes for 1 hour)',
  security: [
    {
      bearerAuth: [],
    },
  ],
  request: {
    params: BranchIdParamSchema,
    body: {
      required: true,
      content: {
        'application/json': {
          schema: UpdateBranchStatusBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Status updated',
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
      description: 'Branch not found',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    409: {
      description: '1-hour BUSY_PAUSED cooldown active',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
  },
});

export const updateBranchSettingsRoute = createRoute({
  method: 'patch',
  path: '/branches/{branchId}/settings',
  tags: [
    'POS Brands & Branches',
  ],
  summary: 'Update branch fulfillment flags, schedule, drop point, privacy mode, or menu mode',
  security: [
    {
      bearerAuth: [],
    },
  ],
  request: {
    params: BranchIdParamSchema,
    body: {
      required: true,
      content: {
        'application/json': {
          schema: UpdateBranchSettingsBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Settings updated',
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
      description: 'Branch not found',
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

export const reviewWhitelistRoute = createRoute({
  method: 'post',
  path: '/branches/{branchId}/whitelist',
  tags: [
    'POS Brands & Branches',
  ],
  summary: 'Approve or reject a customer for home-kitchen walk-in takeaway',
  security: [
    {
      bearerAuth: [],
    },
  ],
  request: {
    params: BranchIdParamSchema,
    body: {
      required: true,
      content: {
        'application/json': {
          schema: ReviewWhitelistBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Whitelist decision saved',
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
      description: 'Branch not found',
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

export const createBrandByAdminRoute = createRoute({
  method: 'post',
  path: '/brands',
  tags: [
    'Platform Admin',
  ],
  summary: 'Provision a new brand and initial branch (PLATFORM_ADMIN only)',
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
          schema: RegisterBrandBodySchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Brand provisioned',
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
      description: 'Not found',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    409: {
      description: 'Handle taken',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
  },
});

export const updateBrandStatusByAdminRoute = createRoute({
  method: 'patch',
  path: '/brands/{restaurantId}/status',
  tags: [
    'Platform Admin',
  ],
  summary: 'Activate or suspend a brand tenant (PLATFORM_ADMIN only)',
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
            isActive: z.boolean(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Status updated',
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
