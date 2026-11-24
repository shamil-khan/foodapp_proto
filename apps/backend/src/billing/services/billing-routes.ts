import { OpenAPIHono } from '@hono/zod-openapi';
import {
  getRestaurantBillingRoute,
  refundOrderRoute,
  settleMerchantRoute,
} from '@/billing/services/billing-schemas';
import type { AppEnv } from '@/container';
import { openApiValidationHook } from '@/core/services/openapi-shared';
import { requirePermission } from '@/identity/services/auth-middleware';

export const billingRoutes = new OpenAPIHono<AppEnv>({
  defaultHook: openApiValidationHook,
});

billingRoutes.use('/restaurant', requirePermission('ledger:read'));
billingRoutes.openapi(getRestaurantBillingRoute, (c) =>
  c.var.di.get('billingController').getRestaurantBilling(c, c.req.valid('query')),
);

billingRoutes.use('/refunds', requirePermission('orders:settle'));
billingRoutes.openapi(refundOrderRoute, (c) =>
  c.var.di.get('billingController').refundOrder(c, c.req.valid('json')),
);

billingRoutes.openapi(settleMerchantRoute, (c) =>
  c.var.di.get('billingController').settleMerchant(c, c.req.valid('param'), c.req.valid('json')),
);
