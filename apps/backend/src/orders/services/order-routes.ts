import { OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '@/container';
import {
  type IdempotencyStorePort,
  idempotencyMiddleware,
} from '@/core/services/idempotency-middleware';
import { openApiValidationHook } from '@/core/services/openapi-shared';
import {
  checkoutOrderRoute,
  deliveryWebhookRoute,
  getCartRoute,
  getOrderDetailRoute,
  listPosOrdersRoute,
  placePosOrderRoute,
  previewOrderRoute,
  settlePosOrderRoute,
  syncPosOrdersRoute,
  transitionOrderStatusRoute,
  upsertCartRoute,
} from '@/orders/services/order-schemas';

export function createStorefrontOrderRoutes(idempotencyStore: IdempotencyStorePort) {
  const routes = new OpenAPIHono<AppEnv>({
    defaultHook: openApiValidationHook,
  });

  routes.use(
    '/checkout',
    idempotencyMiddleware({
      store: idempotencyStore,
      required: false,
    }),
  );

  routes.openapi(getCartRoute, (c) =>
    c.var.di.get('orderController').getCart(c, c.req.valid('param')),
  );
  routes.openapi(upsertCartRoute, (c) =>
    c.var.di.get('orderController').upsertCart(c, c.req.valid('param'), c.req.valid('json')),
  );
  routes.openapi(previewOrderRoute, (c) =>
    c.var.di.get('orderController').previewOrder(c, c.req.valid('json')),
  );
  routes.openapi(checkoutOrderRoute, (c) =>
    c.var.di.get('orderController').checkoutOrder(c, c.req.valid('json')),
  );
  routes.get('/:id/stream', (c) =>
    c.var.di.get('orderController').streamOrderEvents(c, c.req.param('id')),
  );
  routes.openapi(getOrderDetailRoute, (c) =>
    c.var.di.get('orderController').getOrderDetail(c, c.req.valid('param')),
  );
  routes.openapi(transitionOrderStatusRoute, (c) =>
    c.var.di
      .get('orderController')
      .transitionOrderStatus(c, c.req.valid('param'), c.req.valid('json')),
  );

  return routes;
}

export function createPosOrderRoutes(idempotencyStore: IdempotencyStorePort) {
  const routes = new OpenAPIHono<AppEnv>({
    defaultHook: openApiValidationHook,
  });

  routes.use(
    '/sync',
    idempotencyMiddleware({
      store: idempotencyStore,
      required: false,
    }),
  );

  routes.openapi(listPosOrdersRoute, (c) =>
    c.var.di.get('orderController').listOrders(c, c.req.valid('query')),
  );
  routes.openapi(placePosOrderRoute, (c) =>
    c.var.di.get('orderController').placeOrder(c, c.req.valid('json')),
  );
  routes.openapi(settlePosOrderRoute, (c) =>
    c.var.di.get('orderController').settleOrder(c, c.req.valid('param'), c.req.valid('json')),
  );
  routes.openapi(syncPosOrdersRoute, (c) =>
    c.var.di.get('orderController').syncPosOrders(c, c.req.valid('json')),
  );

  return routes;
}

export const deliveryWebhookRoutes = new OpenAPIHono<AppEnv>({
  defaultHook: openApiValidationHook,
});

deliveryWebhookRoutes.openapi(deliveryWebhookRoute, (c) =>
  c.var.di.get('orderController').handleDeliveryWebhook(c, c.req.valid('param')),
);
