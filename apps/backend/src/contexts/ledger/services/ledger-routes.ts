import { Hono } from 'hono';
import type { AppEnv } from '@/container';
import { requireGlobalUser, requirePosStaff } from '@/contexts/identity/services/auth-middleware';

export const ledgerRoutes = new Hono<AppEnv>();

ledgerRoutes.get(
  '/restaurant',
  requirePosStaff([
    'OWNER',
    'ADMIN',
  ]),
  (c) => c.var.di.get('ledgerController').getRestaurantLedger(c),
);

ledgerRoutes.get(
  '/loyalty/me',
  requireGlobalUser([
    'CUSTOMER',
  ]),
  (c) => c.var.di.get('ledgerController').getMyLoyaltyBalance(c),
);

ledgerRoutes.post(
  '/loyalty/redeem',
  requireGlobalUser([
    'CUSTOMER',
  ]),
  (c) => c.var.di.get('ledgerController').redeemLoyaltyPoints(c),
);
