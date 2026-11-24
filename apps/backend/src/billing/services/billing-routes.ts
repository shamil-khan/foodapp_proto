// FILE: apps/backend/src/billing/services/billing-routes.ts
import { OpenAPIHono } from '@hono/zod-openapi';
import {
  getRestaurantBillingRoute,
  refundOrderRoute,
  settleMerchantRoute,
} from '@/billing/services/billing-schemas';
import type { AppEnv } from '@/container';
import { openApiValidationHook } from '@/core/services/openapi-shared';
import { requirePermission, requireTenantOrSupportTicket } from '@/iam/services/auth-middleware';

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

billingRoutes.post(
  '/merchants/:restaurantId/settle',
  requireTenantOrSupportTicket({
    tenantPermissions: [
      'ledger:read',
    ],
    supportScope: 'platform:support:billing-settle',
    resolveTargetIds: (c) => ({
      restaurantId: c.req.param('restaurantId'),
      targetResourceId: c.req.param('restaurantId'),
    }),
  }),
);
billingRoutes.openapi(settleMerchantRoute, (c) =>
  c.var.di.get('billingController').settleMerchant(c, c.req.valid('param'), c.req.valid('json')),
);
