import { Hono } from 'hono';
import type { AppEnv } from '@/container';
import { auth } from '@/contexts/identity/infrastructure/better-auth';

export const identityRoutes = new Hono<AppEnv>();

identityRoutes.on(
  [
    'POST',
    'GET',
  ],
  '/auth/**',
  (c) => auth.handler(c.req.raw),
);
identityRoutes.post('/pos/auth/login', (c) => c.var.di.get('identityController').loginPosStaff(c));
identityRoutes.post('/pos/auth/logout', (c) =>
  c.var.di.get('identityController').logoutPosStaff(c),
);
identityRoutes.get('/me', (c) => c.var.di.get('identityController').getCurrentActor(c));
