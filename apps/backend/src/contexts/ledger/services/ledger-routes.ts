import { OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '@/container';
import { requireGlobalUser, requirePosStaff } from '@/contexts/identity/services/auth-middleware';
import {
  getMyLoyaltyBalanceRoute,
  getRestaurantLedgerRoute,
  redeemLoyaltyPointsRoute,
} from '@/contexts/ledger/services/ledger-schemas';
import { openApiValidationHook } from '@/core/services/openapi-shared';

export const ledgerRoutes = new OpenAPIHono<AppEnv>({
  defaultHook: openApiValidationHook,
});

ledgerRoutes.use(
  '/restaurant',
  requirePosStaff([
    'OWNER',
    'ADMIN',
  ]),
);

ledgerRoutes.openapi(getRestaurantLedgerRoute, (c) =>
  c.var.di.get('ledgerController').getRestaurantLedger(c, c.req.valid('query')),
);

ledgerRoutes.use(
  '/loyalty/*',
  requireGlobalUser([
    'CUSTOMER',
  ]),
);

ledgerRoutes.openapi(getMyLoyaltyBalanceRoute, (c) =>
  c.var.di.get('ledgerController').getMyLoyaltyBalance(c),
);

ledgerRoutes.openapi(redeemLoyaltyPointsRoute, (c) =>
  c.var.di.get('ledgerController').redeemLoyaltyPoints(c, c.req.valid('json')),
);
