import { createRoute, z } from '@hono/zod-openapi';
import { RESERVED_BRAND_HANDLES } from '@/catalog/application/branch-commands';
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
export const MenuPricingModeSchema = z.enum([
  'CENTRAL_LOCKED',
  'BRANCH_DIRECT',
  'BRANCH_APPROVAL_REQUIRED',
  'THRESHOLD_HYBRID',
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

export const StorefrontBranchSchema = z
  .object({
    id: z.uuid(),
    restaurantId: z.uuid(),
    name: z.string(),
    branchKey: z.string(),
    city: z.string(),
    cityKey: z.string(),
    kitchenType: KitchenTypeSchema,
    operationalStatus: OperationalStatusSchema,
    statusLockedUntil: z.string().nullable(),
    supportsDineIn: z.boolean(),
    supportsTakeaway: z.boolean(),
    supportsPlatformDelivery: z.boolean(),
    averagePrepTimeMinutes: z.number().int(),
    scheduleConfig: z.record(z.string(), z.unknown()),
    location: z.object({
      isAddressRedacted: z.boolean(),
      privacyNotice: z.string().nullable(),
      postcodeSector: z.string(),
      areaLocality: z.string().nullable(),
      streetAddress: z.string().nullable(),
      latitude: z.number().nullable(),
      longitude: z.number().nullable(),
      dropPoint: z.record(z.string(), z.unknown()).nullable(),
      contactPersonName: z.string(),
      contactPersonPhone: z.string().nullable(),
      contactPersonEmail: z.string().nullable(),
      canOrderTakeawayDirectly: z.boolean(),
      takeawayWhitelistStatus: z.enum([
        'NOT_REQUIRED',
        'NONE',
        'PENDING',
        'APPROVED',
        'REJECTED',
      ]),
    }),
  })
  .openapi('StorefrontBranch');

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
      example: 'karachi',
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

export const ItemIdParamSchema = z.object({
  itemId: z.uuid().openapi({
    param: {
      name: 'itemId',
      in: 'path',
    },
  }),
});

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

export const listBrandsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: [
    'Catalog',
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
    'Catalog',
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
    'Catalog',
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
    'Catalog',
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

export const createBrandBranchRoute = createRoute({
  method: 'post',
  path: '/pos/branches',
  tags: [
    'Catalog & Branches',
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
  path: '/pos/branches/{branchId}/status',
  tags: [
    'Catalog & Branches',
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
  path: '/pos/branches/{branchId}/settings',
  tags: [
    'Catalog & Branches',
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
  path: '/pos/branches/{branchId}/whitelist',
  tags: [
    'Catalog & Branches',
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
// `apps/backend/src/catalog/services/catalog-schemas.ts` (Chunk 3 of 3):

export const upsertPricingPolicyRoute = createRoute({
  method: 'put',
  path: '/pos/pricing-policy',
  tags: [
    'Catalog & Pricing',
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
  path: '/pos/branches/{branchId}/menu/{itemId}',
  tags: [
    'Catalog & Pricing',
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
  path: '/pos/branches/{branchId}/menu/{itemId}/review',
  tags: [
    'Catalog & Pricing',
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
  path: '/pos/items',
  tags: [
    'Catalog & Pricing',
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
