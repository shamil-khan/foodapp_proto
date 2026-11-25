import { OpenAPIHono } from '@hono/zod-openapi';
import {
  createBrandBranchRoute,
  createBrandByAdminRoute,
  listBrandsRoute,
  registerBrandRoute,
  resolveBranchBySlugRoute,
  resolveBrandByHandleRoute,
  reviewWhitelistRoute,
  updateBranchSettingsRoute,
  updateBranchStatusRoute,
  updateBrandStatusByAdminRoute,
} from '@/brand/services/brand-schemas';
import type { AppEnv } from '@/container';
import { openApiValidationHook } from '@/core/services/openapi-shared';
import { requirePermission, requireTenantOrSupportTicket } from '@/iam/services/auth-middleware';

// Public storefront brand discovery & self-service registration (`/api/brands`)
export const brandRoutes = new OpenAPIHono<AppEnv>({
  defaultHook: openApiValidationHook,
});

brandRoutes.openapi(listBrandsRoute, (c) =>
  c.var.di.get('brandController').listBrands(c, c.req.valid('query')),
);
brandRoutes.openapi(registerBrandRoute, (c) =>
  c.var.di.get('brandController').registerBrand(c, c.req.valid('json')),
);
brandRoutes.openapi(resolveBrandByHandleRoute, (c) =>
  c.var.di.get('brandController').resolveBrandByHandle(c, c.req.valid('param')),
);
brandRoutes.openapi(resolveBranchBySlugRoute, (c) =>
  c.var.di.get('brandController').resolveBranchBySlug(c, c.req.valid('param')),
);

// Authenticated POS / Merchant back-office branch management (`/api/pos/brands`)
export const posBrandRoutes = new OpenAPIHono<AppEnv>({
  defaultHook: openApiValidationHook,
});

posBrandRoutes.post('/branches', requirePermission('brand:branches:create'));
posBrandRoutes.patch(
  '/branches/:branchId/status',
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
posBrandRoutes.patch('/branches/:branchId/settings', requirePermission('branch:settings:manage'));
posBrandRoutes.post('/branches/:branchId/whitelist', requirePermission('branch:whitelist:manage'));

posBrandRoutes.openapi(createBrandBranchRoute, (c) =>
  c.var.di.get('brandController').createBrandBranch(c, c.req.valid('json')),
);
posBrandRoutes.openapi(updateBranchStatusRoute, (c) =>
  c.var.di.get('brandController').updateBranchStatus(c, c.req.valid('param'), c.req.valid('json')),
);
posBrandRoutes.openapi(updateBranchSettingsRoute, (c) =>
  c.var.di
    .get('brandController')
    .updateBranchSettings(c, c.req.valid('param'), c.req.valid('json')),
);
posBrandRoutes.openapi(reviewWhitelistRoute, (c) =>
  c.var.di.get('brandController').reviewWhitelist(c, c.req.valid('param'), c.req.valid('json')),
);

// Platform admin brand governance (`/api/admin/brands`)
export const adminBrandRoutes = new OpenAPIHono<AppEnv>({
  defaultHook: openApiValidationHook,
});

adminBrandRoutes.use('/brands', requirePermission('platform:restaurants:manage'));
adminBrandRoutes.use('/brands/*', requirePermission('platform:restaurants:manage'));

adminBrandRoutes.openapi(createBrandByAdminRoute, (c) =>
  c.var.di.get('brandController').createBrandByAdmin(c, c.req.valid('json')),
);
adminBrandRoutes.openapi(updateBrandStatusByAdminRoute, (c) =>
  c.var.di
    .get('brandController')
    .updateBrandStatusByAdmin(c, c.req.valid('param'), c.req.valid('json')),
);
