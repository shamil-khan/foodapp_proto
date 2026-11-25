import { OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '@/container';
import { openApiValidationHook } from '@/core/services/openapi-shared';
import { requirePermission } from '@/iam/services/auth-middleware';
import {
  createSupportTicketRoute,
  listSupportTicketsRoute,
  revokeSupportTicketRoute,
} from '@/support/services/support-schemas';

export const supportRoutes = new OpenAPIHono<AppEnv>({
  defaultHook: openApiValidationHook,
});

// Brand-authorized JIT support ticket endpoints (requires `brand:support:authorize`)
supportRoutes.use('/', requirePermission('brand:support:authorize'));
supportRoutes.use('/*', requirePermission('brand:support:authorize'));

supportRoutes.openapi(createSupportTicketRoute, (c) =>
  c.var.di.get('supportController').createTicket(c, c.req.valid('json')),
);
supportRoutes.openapi(listSupportTicketsRoute, (c) =>
  c.var.di.get('supportController').listTickets(c, c.req.valid('query')),
);
supportRoutes.openapi(revokeSupportTicketRoute, (c) =>
  c.var.di.get('supportController').revokeTicket(c, c.req.valid('param')),
);
