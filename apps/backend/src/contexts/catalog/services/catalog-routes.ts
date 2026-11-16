import { OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '@/container';
import {
  createRestaurantByAdminRoute,
  getMenuSnapshotRoute,
  getRestaurantBySubdomainRoute,
  listRestaurantsRoute,
  updateItemPriceRoute,
  updateRestaurantStatusByAdminRoute,
} from '@/contexts/catalog/services/catalog-schemas';
import { requireGlobalUser, requirePermission } from '@/contexts/identity/services/auth-middleware';
import { openApiValidationHook } from '@/core/services/openapi-shared';

export const catalogRoutes = new OpenAPIHono<AppEnv>({
  defaultHook: openApiValidationHook,
});

catalogRoutes.openapi(listRestaurantsRoute, (c) =>
  c.var.di.get('catalogController').listRestaurants(c, c.req.valid('query')),
);

catalogRoutes.openapi(getRestaurantBySubdomainRoute, (c) =>
  c.var.di.get('catalogController').getRestaurantBySubdomain(c, c.req.valid('param')),
);

catalogRoutes.openapi(getMenuSnapshotRoute, (c) =>
  c.var.di.get('catalogController').getMenuSnapshot(c, c.req.valid('param')),
);

catalogRoutes.use('/items/:itemId/price', requirePermission('catalog:price:update'));

catalogRoutes.openapi(updateItemPriceRoute, (c) =>
  c.var.di.get('catalogController').updateItemPrice(c, c.req.valid('param'), c.req.valid('json')),
);

export const adminCatalogRoutes = new OpenAPIHono<AppEnv>({
  defaultHook: openApiValidationHook,
});

adminCatalogRoutes.use(
  '/restaurants',
  requireGlobalUser([
    'PLATFORM_ADMIN',
  ]),
);
adminCatalogRoutes.use(
  '/restaurants/*',
  requireGlobalUser([
    'PLATFORM_ADMIN',
  ]),
);

adminCatalogRoutes.openapi(createRestaurantByAdminRoute, (c) =>
  c.var.di.get('catalogController').createRestaurantByAdmin(c, c.req.valid('json')),
);

adminCatalogRoutes.openapi(updateRestaurantStatusByAdminRoute, (c) =>
  c.var.di
    .get('catalogController')
    .updateRestaurantStatusByAdmin(c, c.req.valid('param'), c.req.valid('json')),
);
