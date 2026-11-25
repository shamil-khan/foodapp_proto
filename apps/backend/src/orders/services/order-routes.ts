import { OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '@/container';
import {
  type IdempotencyStorePort,
  idempotencyMiddleware,
} from '@/core/services/idempotency-middleware';
import { openApiValidationHook } from '@/core/services/openapi-shared';
import { requireAnyPermission, requirePermission } from '@/iam/services/auth-middleware';
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

  // Public quote endpoint: POST /preview (intentionally unauthenticated)

  // Customer-only cart & checkout routes (Mobile OTP login required; auth runs BEFORE idempotency lock)
  routes.use('/cart/*', requirePermission('storefront:orders:place'));
  routes.use('/checkout', requirePermission('storefront:orders:place'));
  routes.use(
    '/checkout',
    idempotencyMiddleware({
      store: idempotencyStore,
      required: false,
    }),
  );

  // Shared Customer / POS Staff order tracking & status transitions
  routes.get('/:id', requireAnyPermission('storefront:orders:read', 'orders:read'));
  routes.get('/:id/stream', requireAnyPermission('storefront:orders:read', 'orders:read'));
  routes.patch('/:id/status', requireAnyPermission('storefront:orders:place', 'orders:place'));

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

  // Fail-fast HTTP route-level PBAC guards (401 before controller or idempotency lock)
  routes.on('GET', '/', requirePermission('orders:read'));
  routes.on('POST', '/', requirePermission('orders:place'));
  routes.post('/:id/settle', requirePermission('orders:settle'));
  routes.post('/sync', requirePermission('orders:place'));

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
