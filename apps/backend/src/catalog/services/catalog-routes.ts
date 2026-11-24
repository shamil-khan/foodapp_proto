// FILE: apps/backend/src/catalog/services/catalog-routes.ts (Part 1 of 2)
import { OpenAPIHono } from '@hono/zod-openapi';
import {
  createBrandBranchRoute,
  createBrandByAdminRoute,
  createMenuItemRoute,
  getBranchMenuSnapshotRoute,
  listBrandsRoute,
  registerBrandRoute,
  resolveBranchBySlugRoute,
  resolveBrandByHandleRoute,
  reviewPriceOverrideRoute,
  reviewWhitelistRoute,
  updateBranchSettingsRoute,
  updateBranchStatusRoute,
  updateBrandStatusByAdminRoute,
  upsertBranchMenuOverrideRoute,
  upsertPricingPolicyRoute,
} from '@/catalog/services/catalog-schemas';
import type { AppEnv } from '@/container';
import { openApiValidationHook } from '@/core/services/openapi-shared';
import { requirePermission, requireTenantOrSupportTicket } from '@/iam/services/auth-middleware';

export const catalogRoutes = new OpenAPIHono<AppEnv>({
  defaultHook: openApiValidationHook,
});

// Fail-fast HTTP route guards on POS / Brand Governance endpoints
catalogRoutes.post('/pos/branches', requirePermission('brand:branches:create'));
catalogRoutes.patch(
  '/pos/branches/:branchId/status',
  requireTenantOrSupportTicket({
    tenantPermissions: [
      'branch:status:manage',
    ],
    supportScope: 'platform:support:branch-override',
    resolveTargetIds: (c) => ({
      branchId: c.req.param('branchId'),
      targetResourceId: c.req.param('branchId'),
    }),
  }),
);
catalogRoutes.patch(
  '/pos/branches/:branchId/settings',
  requirePermission('branch:settings:manage'),
);
catalogRoutes.post(
  '/pos/branches/:branchId/whitelist',
  requirePermission('branch:whitelist:manage'),
);
catalogRoutes.put('/pos/pricing-policy', requirePermission('pricing:policy:manage'));
catalogRoutes.put(
  '/pos/branches/:branchId/menu/:itemId',
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
catalogRoutes.post(
  '/pos/branches/:branchId/menu/:itemId/review',
  requirePermission('catalog:price:approve'),
);
catalogRoutes.post(
  '/pos/items',
  requireTenantOrSupportTicket({
    tenantPermissions: [
      'catalog:items:manage',
    ],
    supportScope: 'platform:support:catalog-override',
  }),
);
// FILE: apps/backend/src/catalog/services/catalog-routes.ts (Part 2 of 2)
catalogRoutes.openapi(listBrandsRoute, (c) =>
  c.var.di.get('catalogController').listBrands(c, c.req.valid('query')),
);
catalogRoutes.openapi(registerBrandRoute, (c) =>
  c.var.di.get('catalogController').registerBrand(c, c.req.valid('json')),
);
catalogRoutes.openapi(createBrandBranchRoute, (c) =>
  c.var.di.get('catalogController').createBrandBranch(c, c.req.valid('json')),
);
catalogRoutes.openapi(updateBranchStatusRoute, (c) =>
  c.var.di
    .get('catalogController')
    .updateBranchStatus(c, c.req.valid('param'), c.req.valid('json')),
);
catalogRoutes.openapi(updateBranchSettingsRoute, (c) =>
  c.var.di
    .get('catalogController')
    .updateBranchSettings(c, c.req.valid('param'), c.req.valid('json')),
);
catalogRoutes.openapi(reviewWhitelistRoute, (c) =>
  c.var.di.get('catalogController').reviewWhitelist(c, c.req.valid('param'), c.req.valid('json')),
);
catalogRoutes.openapi(upsertPricingPolicyRoute, (c) =>
  c.var.di.get('catalogController').upsertPricingPolicy(c, c.req.valid('json')),
);
catalogRoutes.openapi(upsertBranchMenuOverrideRoute, (c) =>
  c.var.di
    .get('catalogController')
    .upsertBranchMenuOverride(c, c.req.valid('param'), c.req.valid('json')),
);
catalogRoutes.openapi(reviewPriceOverrideRoute, (c) =>
  c.var.di
    .get('catalogController')
    .reviewPriceOverride(c, c.req.valid('param'), c.req.valid('json')),
);
catalogRoutes.openapi(createMenuItemRoute, (c) =>
  c.var.di.get('catalogController').createMenuItem(c, c.req.valid('json')),
);
catalogRoutes.openapi(getBranchMenuSnapshotRoute, (c) =>
  c.var.di
    .get('catalogController')
    .getBranchMenuSnapshot(c, c.req.valid('param'), c.req.valid('query')),
);
catalogRoutes.openapi(resolveBrandByHandleRoute, (c) =>
  c.var.di.get('catalogController').resolveBrandByHandle(c, c.req.valid('param')),
);
catalogRoutes.openapi(resolveBranchBySlugRoute, (c) =>
  c.var.di.get('catalogController').resolveBranchBySlug(c, c.req.valid('param')),
);

export const adminCatalogRoutes = new OpenAPIHono<AppEnv>({
  defaultHook: openApiValidationHook,
});

adminCatalogRoutes.use('/brands', requirePermission('platform:restaurants:manage'));
adminCatalogRoutes.use('/brands/*', requirePermission('platform:restaurants:manage'));

adminCatalogRoutes.openapi(createBrandByAdminRoute, (c) =>
  c.var.di.get('catalogController').createBrandByAdmin(c, c.req.valid('json')),
);
adminCatalogRoutes.openapi(updateBrandStatusByAdminRoute, (c) =>
  c.var.di
    .get('catalogController')
    .updateBrandStatusByAdmin(c, c.req.valid('param'), c.req.valid('json')),
);
