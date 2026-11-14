import { OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '@/container';
import { auth } from '@/contexts/identity/infrastructure/better-auth';
import {
  getCurrentActorRoute,
  loginPosStaffRoute,
  logoutPosStaffRoute,
} from '@/contexts/identity/services/identity-schemas';
import { openApiValidationHook } from '@/core/services/openapi-shared';

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
