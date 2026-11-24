// FILE: apps/backend/src/iam/services/iam-routes.ts
import { OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '@/container';
import { openApiValidationHook } from '@/core/services/openapi-shared';
import { auth } from '@/iam/infrastructure/better-auth';
import { requirePermission, requirePosStaff } from '@/iam/services/auth-middleware';
import {
  assignStaffBranchAccessRoute,
  createStaffRoleRoute,
  deleteStaffRoleRoute,
  getCurrentActorRoute,
  listAssignablePermissionsRoute,
  listStaffRolesRoute,
  loginPosStaffRoute,
  logoutPosStaffRoute,
  switchPosBranchRoute,
  updateStaffRoleRoute,
} from '@/iam/services/iam-schemas';

export const iamRoutes = new OpenAPIHono<AppEnv>({
  defaultHook: openApiValidationHook,
});

// Better Auth handles Global User sessions, Mobile OTP (`/auth/phone-number/*`), and Platform Admin auth
iamRoutes.on(
  [
    'POST',
    'GET',
  ],
  '/auth/**',
  (c) => auth.handler(c.req.raw),
);

iamRoutes.openapi(loginPosStaffRoute, (c) =>
  c.var.di.get('iamController').loginPosStaff(c, c.req.valid('json')),
);

// Fail-fast guard: switching active branch requires an authenticated POS_STAFF shift token
iamRoutes.post('/pos/auth/switch-branch', requirePosStaff());
iamRoutes.openapi(switchPosBranchRoute, (c) =>
  c.var.di.get('iamController').switchPosBranch(c, c.req.valid('json')),
);

iamRoutes.openapi(logoutPosStaffRoute, (c) => c.var.di.get('iamController').logoutPosStaff(c));
iamRoutes.openapi(getCurrentActorRoute, (c) => c.var.di.get('iamController').getCurrentActor(c));

iamRoutes.use('/pos/roles', requirePermission('staff:roles:manage'));
iamRoutes.use('/pos/roles/*', requirePermission('staff:roles:manage'));

iamRoutes.openapi(listAssignablePermissionsRoute, (c) =>
  c.var.di.get('iamController').listAssignablePermissions(c),
);
iamRoutes.openapi(listStaffRolesRoute, (c) =>
  c.var.di.get('iamController').listStaffRoles(c, c.req.valid('query')),
);
iamRoutes.openapi(createStaffRoleRoute, (c) =>
  c.var.di.get('iamController').createStaffRole(c, c.req.valid('json')),
);
iamRoutes.openapi(updateStaffRoleRoute, (c) =>
  c.var.di.get('iamController').updateStaffRole(c, c.req.valid('param'), c.req.valid('json')),
);
iamRoutes.openapi(deleteStaffRoleRoute, (c) =>
  c.var.di.get('iamController').deleteStaffRole(c, c.req.valid('param')),
);

iamRoutes.use('/pos/staff/*', requirePermission('staff:manage'));

iamRoutes.openapi(assignStaffBranchAccessRoute, (c) =>
  c.var.di
    .get('iamController')
    .assignStaffBranchAccess(c, c.req.valid('param'), c.req.valid('json')),
);
