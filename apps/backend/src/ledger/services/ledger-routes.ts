import { OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '@/container';
import { openApiValidationHook } from '@/core/services/openapi-shared';
import { requirePermission } from '@/identity/services/auth-middleware';
import {
  getMyLoyaltyBalanceRoute,
  getRestaurantLedgerRoute,
  redeemLoyaltyPointsRoute,
} from '@/ledger/services/ledger-schemas';

export const ledgerRoutes = new OpenAPIHono<AppEnv>({
  defaultHook: openApiValidationHook,
});

ledgerRoutes.use('/restaurant', requirePermission('ledger:read'));

ledgerRoutes.openapi(getRestaurantLedgerRoute, (c) =>
  c.var.di.get('ledgerController').getRestaurantLedger(c, c.req.valid('query')),
);

ledgerRoutes.use('/loyalty/me', requirePermission('loyalty:read'));
ledgerRoutes.use('/loyalty/redeem', requirePermission('loyalty:redeem'));

ledgerRoutes.openapi(getMyLoyaltyBalanceRoute, (c) =>
  c.var.di.get('ledgerController').getMyLoyaltyBalance(c),
);

ledgerRoutes.openapi(redeemLoyaltyPointsRoute, (c) =>
  c.var.di.get('ledgerController').redeemLoyaltyPoints(c, c.req.valid('json')),
);
