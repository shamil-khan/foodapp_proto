// FILE: apps/backend/src/catalog/services/catalog-routes.ts
import { OpenAPIHono } from '@hono/zod-openapi';
import {
  createMenuItemRoute,
  getBranchMenuSnapshotRoute,
  reviewPriceOverrideRoute,
  upsertBranchMenuOverrideRoute,
  upsertPricingPolicyRoute,
} from '@/catalog/services/catalog-schemas';
import type { AppEnv } from '@/container';
import { openApiValidationHook } from '@/core/services/openapi-shared';
import { requirePermission, requireTenantOrSupportTicket } from '@/iam/services/auth-middleware';

// Public storefront menu snapshot reads (`/api/catalog`)
export const catalogRoutes = new OpenAPIHono<AppEnv>({
  defaultHook: openApiValidationHook,
});

catalogRoutes.openapi(getBranchMenuSnapshotRoute, (c) =>
  c.var.di
    .get('catalogController')
    .getBranchMenuSnapshot(c, c.req.valid('param'), c.req.valid('query')),
);

// Authenticated POS / Merchant catalog & pricing mutations (`/api/pos/catalog`)
export const posCatalogRoutes = new OpenAPIHono<AppEnv>({
  defaultHook: openApiValidationHook,
});

posCatalogRoutes.put('/pricing-policy', requirePermission('pricing:policy:manage'));
posCatalogRoutes.put(
  '/branches/:branchId/menu/:itemId',
  requireTenantOrSupportTicket({
    tenantPermissions: [
      'catalog:items:manage',
      'catalog:price:update',
    ],
    supportScope: 'platform:support:catalog-override',
    resolveTargetIds: (c) => ({
      branchId: c.req.param('branchId'),
      targetResourceId: c.req.param('itemId'),
    }),
  }),
);
posCatalogRoutes.post(
  '/branches/:branchId/menu/:itemId/review',
  requirePermission('catalog:price:approve'),
);
posCatalogRoutes.post(
  '/items',
  requireTenantOrSupportTicket({
    tenantPermissions: [
      'catalog:items:manage',
    ],
    supportScope: 'platform:support:catalog-override',
  }),
);

posCatalogRoutes.openapi(upsertPricingPolicyRoute, (c) =>
  c.var.di.get('catalogController').upsertPricingPolicy(c, c.req.valid('json')),
);
posCatalogRoutes.openapi(upsertBranchMenuOverrideRoute, (c) =>
  c.var.di
    .get('catalogController')
    .upsertBranchMenuOverride(c, c.req.valid('param'), c.req.valid('json')),
);
posCatalogRoutes.openapi(reviewPriceOverrideRoute, (c) =>
  c.var.di
    .get('catalogController')
    .reviewPriceOverride(c, c.req.valid('param'), c.req.valid('json')),
);
posCatalogRoutes.openapi(createMenuItemRoute, (c) =>
  c.var.di.get('catalogController').createMenuItem(c, c.req.valid('json')),
);
