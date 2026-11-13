import { Hono } from 'hono';
import type { AppEnv } from '@/container';
import { requirePosStaff } from '@/contexts/identity/services/auth-middleware';

export const catalogRoutes = new Hono<AppEnv>();

catalogRoutes.get('/', (c) => c.var.di.get('catalogController').listRestaurants(c));

catalogRoutes.get('/:restaurantId/menu', (c) =>
  c.var.di.get('catalogController').getMenuSnapshot(c),
);

catalogRoutes.patch(
  '/items/:itemId/price',
  requirePosStaff([
    'OWNER',
    'ADMIN',
    'MANAGER',
  ]),
  (c) => c.var.di.get('catalogController').updateItemPrice(c),
);
