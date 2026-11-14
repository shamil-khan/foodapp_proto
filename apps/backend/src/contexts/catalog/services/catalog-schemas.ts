import { createRoute, z } from '@hono/zod-openapi';
import {
  DomainErrorResponseSchema,
  PaginationQuerySchema,
  ValidationErrorResponseSchema,
} from '@/core/services/openapi-shared';

export const StorefrontRestaurantSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
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

export const listRestaurantsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: [
    'Catalog',
  ],
  summary: 'List active storefront restaurants (optionally filtered by UK postcode sector)',
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
    400: {
      description: 'Invalid restaurantId UUID',
      content: {
        'application/json': {
          schema: ValidationErrorResponseSchema,
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
  summary: 'Update menu item base price with optimistic concurrency check (POS Staff)',
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
      description: 'Invalid price or validation error',
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
      description: 'Forbidden tenant role',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
    409: {
      description: 'Optimistic locking concurrency conflict',
      content: {
        'application/json': {
          schema: DomainErrorResponseSchema,
        },
      },
    },
  },
});
