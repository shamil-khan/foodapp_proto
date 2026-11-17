import { OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '@/container';
import { openApiValidationHook } from '@/core/services/openapi-shared';
import {
  listPosOrdersRoute,
  placePosOrderRoute,
  settlePosOrderRoute,
} from '@/ordering/services/order-schemas';

export const orderRoutes = new OpenAPIHono<AppEnv>({
  defaultHook: openApiValidationHook,
});

orderRoutes.openapi(listPosOrdersRoute, (c) =>
  c.var.di.get('orderController').listOrders(c, c.req.valid('query')),
);

orderRoutes.openapi(placePosOrderRoute, (c) =>
  c.var.di.get('orderController').placeOrder(c, c.req.valid('json')),
);

orderRoutes.openapi(settlePosOrderRoute, (c) =>
  c.var.di.get('orderController').settleOrder(c, c.req.valid('param'), c.req.valid('json')),
);
