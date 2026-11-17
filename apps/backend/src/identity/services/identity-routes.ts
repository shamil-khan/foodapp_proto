import { OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '@/container';
import { openApiValidationHook } from '@/core/services/openapi-shared';
import { auth } from '@/identity/infrastructure/better-auth';
import { requirePermission } from '@/identity/services/auth-middleware';
import {
  assignStaffRoleRoute,
  createStaffRoleRoute,
  deleteStaffRoleRoute,
  getCurrentActorRoute,
  listAssignablePermissionsRoute,
  listStaffRolesRoute,
  loginPosStaffRoute,
  logoutPosStaffRoute,
  updateStaffRoleRoute,
} from '@/identity/services/identity-schemas';

export const identityRoutes = new OpenAPIHono<AppEnv>({
  defaultHook: openApiValidationHook,
});

// Better Auth wildcard handler (/api/auth/*) — skipped from OpenAPI spec generation automatically
identityRoutes.on(
  [
    'POST',
    'GET',
  ],
  '/auth/**',
  (c) => auth.handler(c.req.raw),
);

identityRoutes.openapi(loginPosStaffRoute, (c) =>
  c.var.di.get('identityController').loginPosStaff(c, c.req.valid('json')),
);

identityRoutes.openapi(logoutPosStaffRoute, (c) =>
  c.var.di.get('identityController').logoutPosStaff(c),
);

identityRoutes.openapi(getCurrentActorRoute, (c) =>
  c.var.di.get('identityController').getCurrentActor(c),
);

identityRoutes.use('/pos/roles', requirePermission('staff:roles:manage'));
identityRoutes.use('/pos/roles/*', requirePermission('staff:roles:manage'));

identityRoutes.openapi(listAssignablePermissionsRoute, (c) =>
  c.var.di.get('identityController').listAssignablePermissions(c),
);

identityRoutes.openapi(listStaffRolesRoute, (c) =>
  c.var.di.get('identityController').listStaffRoles(c, c.req.valid('query')),
);

identityRoutes.openapi(createStaffRoleRoute, (c) =>
  c.var.di.get('identityController').createStaffRole(c, c.req.valid('json')),
);

identityRoutes.openapi(updateStaffRoleRoute, (c) =>
  c.var.di.get('identityController').updateStaffRole(c, c.req.valid('param'), c.req.valid('json')),
);

identityRoutes.openapi(deleteStaffRoleRoute, (c) =>
  c.var.di.get('identityController').deleteStaffRole(c, c.req.valid('param')),
);

identityRoutes.use('/pos/staff/*', requirePermission('staff:manage'));

identityRoutes.openapi(assignStaffRoleRoute, (c) =>
  c.var.di.get('identityController').assignStaffRole(c, c.req.valid('param'), c.req.valid('json')),
);
