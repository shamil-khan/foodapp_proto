import { OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '@/container';
import { openApiValidationHook } from '@/core/services/openapi-shared';
import { requireAnyPermission, requirePermission } from '@/iam/services/auth-middleware';
import {
  auditLoyaltyEntryRoute,
  getMyLoyaltyWalletRoute,
  updateLoyaltyGovernanceRoute,
} from '@/loyalty/services/loyalty-schemas';

export const loyaltyRoutes = new OpenAPIHono<AppEnv>({
  defaultHook: openApiValidationHook,
});

loyaltyRoutes.use('/me', requirePermission('loyalty:read'));
loyaltyRoutes.openapi(getMyLoyaltyWalletRoute, (c) =>
  c.var.di.get('loyaltyController').getMyWallet(c, c.req.valid('query')),
);

loyaltyRoutes.patch(
  '/governance',
  requireAnyPermission('pricing:policy:manage', 'platform:support:loyalty-governance'),
);
loyaltyRoutes.openapi(updateLoyaltyGovernanceRoute, (c) =>
  c.var.di.get('loyaltyController').updateGovernance(c, c.req.valid('json')),
);

loyaltyRoutes.post('/entries/:entryId/audit', requirePermission('platform:loyalty:audit'));
loyaltyRoutes.openapi(auditLoyaltyEntryRoute, (c) =>
  c.var.di.get('loyaltyController').auditEntry(c, c.req.valid('param'), c.req.valid('json')),
);
