import { createRoute, z } from '@hono/zod-openapi';
import {
  DomainErrorResponseSchema,
  PaginationQuerySchema,
  SuccessFlagResponseSchema,
  ValidationErrorResponseSchema,
} from '@/core/services/openapi-shared';

export const StorefrontRestaurantSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    subdomain: z.string().openapi({
      example: 'westminster-patty',
    }),
    postcodeSector: z.string().openapi({
      example: 'E1 6',
    }),
    foodHygieneRating: z.number().int().nullable(),
    averagePrepTimeMinutes: z.number().int(),
    branding: z
      .object({
        templateId: z.string(),
        primaryColor: z.string(),
        bannerUrl: z.string().nullable(),
      })
      .nullable(),
  })
  .openapi('StorefrontRestaurant');

export const SubdomainParamSchema = z.object({
  subdomain: z
    .string()
    .min(2)
    .max(63)
    .openapi({
      param: {
        name: 'subdomain',
        in: 'path',
      },
      example: 'westminster-patty',
    }),
});

export const ListRestaurantsQuerySchema = PaginationQuerySchema.extend({
  postcodeSector: z
    .string()
    .optional()
    .openapi({
      param: {
        name: 'postcodeSector',
        in: 'query',
      },
      example: 'SW1A',
    }),
  search: z
    .string()
    .optional()
    .openapi({
      param: {
        name: 'search',
        in: 'query',
      },
      example: 'Curry',
    }),
});

export const ListRestaurantsResponseSchema = z
  .object({
    restaurants: z.array(StorefrontRestaurantSchema),
  })
  .openapi('ListRestaurantsResponse');

export const RestaurantIdParamSchema = z.object({
  restaurantId: z.uuid().openapi({
    param: {
      name: 'restaurantId',
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

export const SnapshotModifierSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    extraPrice: z.number(),
  })
  .openapi('SnapshotModifier');

export const SnapshotMenuItemSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    description: z.string().nullable(),
    basePrice: z.number(),
    vatRate: z.number(),
    allergenFlags: z.array(z.string()),
    kdsTarget: z.enum([
      'KITCHEN_SCREEN',
      'BAR_PRINTER',
      'PASTRY_STATION',
    ]),
    imageUrl: z.string().nullable(),
    modifiers: z.array(SnapshotModifierSchema),
  })
  .openapi('SnapshotMenuItem');

export const SnapshotCategorySchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    sortWeight: z.number().int(),
    items: z.array(SnapshotMenuItemSchema),
  })
  .openapi('SnapshotCategory');

export const CompiledMenuSnapshotSchema = z
  .object({
    restaurantId: z.uuid(),
    restaurantName: z.string(),
    postcodeSector: z.string(),
    versionHash: z.string(),
    generatedAt: z.string(),
    categories: z.array(SnapshotCategorySchema),
  })
  .openapi('CompiledMenuSnapshot');
export const UpdateMenuItemPriceBodySchema = z
  .object({
    newBasePrice: z.number().min(0).openapi({
      example: 12.99,
    }),
    expectedRowVersion: z.number().int().min(1).openapi({
      example: 1,
    }),
  })
  .openapi('UpdateMenuItemPriceBody');

export const UpdateMenuItemPriceResponseSchema = z
  .object({
    success: z.literal(true),
    menuItemId: z.uuid(),
  })
  .openapi('UpdateMenuItemPriceResponse');

export const CreateRestaurantByAdminBodySchema = z
  .object({
    name: z.string().min(2).max(120).openapi({
      example: 'Subway Soho',
    }),
    subdomain: z
      .string()
      .min(2)
      .max(63)
      .regex(/^[a-z0-9-]+$/i)
      .openapi({
        example: 'subway',
      }),
    postcodeSector: z.string().min(2).max(10).openapi({
      example: 'W1D',
    }),
    ownerName: z.string().min(2).max(100).openapi({
      example: 'Subway Soho Owner',
    }),
    ownerEmail: z.email().openapi({
      example: 'owner@subway-soho.co.uk',
    }),
    ownerPassword: z.string().min(8).openapi({
      example: 'OwnerPass123!',
    }),
    platformFeeRate: z.number().min(0).max(50).optional().openapi({
      example: 12.5,
    }),
  })
  .openapi('CreateRestaurantByAdminBody');

export const UpdateRestaurantStatusBodySchema = z
  .object({
    isActive: z.boolean(),
  })
  .openapi('UpdateRestaurantStatusBody');

export const listRestaurantsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: [
    'Catalog',
  ],
  summary: 'List active storefront restaurants',
  request: {
    query: ListRestaurantsQuerySchema,
  },
  responses: {
    200: {
      description: 'Active restaurants matching filters',
      content: {
        'application/json': {
          schema: ListRestaurantsResponseSchema,
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
  },
});

export const getRestaurantBySubdomainRoute = createRoute({
  method: 'get',
  path: '/by-subdomain/{subdomain}',
  tags: [
    'Catalog',
  ],
  summary: 'Resolve active storefront restaurant by URL subdomain (e.g. subway from ://fapp.com)',
  request: {
    params: SubdomainParamSchema,
  },
  responses: {
    200: {
      description: 'Resolved storefront restaurant',
      content: {
        'application/json': {
          schema: z.object({
            restaurant: StorefrontRestaurantSchema,
          }),
        },
      },
    },
    404: {
      description: 'Restaurant subdomain not found or inactive',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
  },
});

export const getMenuSnapshotRoute = createRoute({
  method: 'get',
  path: '/{restaurantId}/menu',
  tags: [
    'Catalog',
  ],
  summary: 'Fetch compiled menu snapshot for a restaurant',
  request: {
    params: RestaurantIdParamSchema,
  },
  responses: {
    200: {
      description: 'Compiled menu snapshot',
      content: {
        'application/json': {
          schema: CompiledMenuSnapshotSchema,
        },
      },
    },
    404: {
      description: 'Restaurant menu not found',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
  },
});
export const updateItemPriceRoute = createRoute({
  method: 'patch',
  path: '/items/{itemId}/price',
  tags: [
    'Catalog',
  ],
  summary: 'Update menu item base price (requires catalog:price:update right & matching tenant)',
  security: [
    {
      bearerAuth: [],
    },
  ],
  request: {
    params: ItemIdParamSchema,
    body: {
      required: true,
      content: {
        'application/json': {
          schema: UpdateMenuItemPriceBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Menu item price updated',
      content: {
        'application/json': {
          schema: UpdateMenuItemPriceResponseSchema,
        },
      },
    },
    400: {
      description: 'Validation error',
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
      description: 'Forbidden tenant or missing catalog:price:update right',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    404: {
      description: 'Menu item not found',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    409: {
      description: 'Optimistic locking conflict',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
  },
});

export const createRestaurantByAdminRoute = createRoute({
  method: 'post',
  path: '/restaurants',
  tags: [
    'Platform Admin',
  ],
  summary: 'Register a new restaurant with unique subdomain, default roles, and owner account',
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
          schema: CreateRestaurantByAdminBodySchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Restaurant registered',
      content: {
        'application/json': {
          schema: z.object({
            restaurantId: z.uuid(),
            subdomain: z.string(),
            ownerStaffId: z.uuid(),
          }),
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
      description: 'Forbidden: PLATFORM_ADMIN required',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    409: {
      description: 'Subdomain already taken',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
  },
});

export const updateRestaurantStatusByAdminRoute = createRoute({
  method: 'patch',
  path: '/restaurants/{restaurantId}/status',
  tags: [
    'Platform Admin',
  ],
  summary: 'Activate or suspend a restaurant tenant (PLATFORM_ADMIN only)',
  security: [
    {
      bearerAuth: [],
    },
  ],
  request: {
    params: RestaurantIdParamSchema,
    body: {
      required: true,
      content: {
        'application/json': {
          schema: UpdateRestaurantStatusBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Restaurant status updated',
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
          schema: DomainErrorResponseSchema,
        },
      },
    },
    403: {
      description: 'Forbidden: PLATFORM_ADMIN required',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    404: {
      description: 'Restaurant not found',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
  },
});
