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
import { requireGlobalUser } from '@/identity/services/auth-middleware';

export const catalogRoutes = new OpenAPIHono<AppEnv>({
  defaultHook: openApiValidationHook,
});

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

adminCatalogRoutes.use(
  '/brands',
  requireGlobalUser([
    'PLATFORM_ADMIN',
  ]),
);
adminCatalogRoutes.use(
  '/brands/*',
  requireGlobalUser([
    'PLATFORM_ADMIN',
  ]),
);

adminCatalogRoutes.openapi(createBrandByAdminRoute, (c) =>
  c.var.di.get('catalogController').createBrandByAdmin(c, c.req.valid('json')),
);
adminCatalogRoutes.openapi(updateBrandStatusByAdminRoute, (c) =>
  c.var.di
    .get('catalogController')
    .updateBrandStatusByAdmin(c, c.req.valid('param'), c.req.valid('json')),
);
