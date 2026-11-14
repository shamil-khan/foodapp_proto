import { OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '@/container';
import {
  getMenuSnapshotRoute,
  listRestaurantsRoute,
  updateItemPriceRoute,
} from '@/contexts/catalog/services/catalog-schemas';
import { requirePosStaff } from '@/contexts/identity/services/auth-middleware';
import { openApiValidationHook } from '@/core/services/openapi-shared';

export const catalogRoutes = new OpenAPIHono<AppEnv>({
  defaultHook: openApiValidationHook,
});

catalogRoutes.openapi(listRestaurantsRoute, (c) =>
  c.var.di.get('catalogController').listRestaurants(c, c.req.valid('query')),
);

catalogRoutes.openapi(getMenuSnapshotRoute, (c) =>
  c.var.di.get('catalogController').getMenuSnapshot(c, c.req.valid('param')),
);

catalogRoutes.use(
  '/items/:itemId/price',
  requirePosStaff([
    'OWNER',
    'ADMIN',
    'MANAGER',
  ]),
);

catalogRoutes.openapi(updateItemPriceRoute, (c) =>
  c.var.di.get('catalogController').updateItemPrice(c, c.req.valid('param'), c.req.valid('json')),
);
