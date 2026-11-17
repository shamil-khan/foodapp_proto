import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { Scalar } from '@scalar/hono-api-reference';
import { adminCatalogRoutes, catalogRoutes } from '@/catalog/services/catalog-routes';
import { apiCorsMiddleware } from '@/config/cors';
import type { AppEnv } from '@/container';
import { openApiValidationHook } from '@/core/services/openapi-shared';
import { globalErrorHandler } from '@/errorHandler';
import { initDiScope } from '@/identity/services/auth-middleware';
import { identityRoutes } from '@/identity/services/identity-routes';
import { ledgerRoutes } from '@/ledger/services/ledger-routes';
import { orderRoutes } from '@/ordering/services/order-routes';

const HealthResponseSchema = z
  .object({
    status: z.literal('ok'),
    service: z.literal('foodapp-backend'),
    datetime: z.string(),
  })
  .openapi('HealthResponse');

const healthRoute = createRoute({
  method: 'get',
  path: '/api/health',
  tags: [
    'Platform',
  ],
  summary: 'Backend service health check',
  responses: {
    200: {
      description: 'Service is healthy',
      content: {
        'application/json': {
          schema: HealthResponseSchema,
        },
      },
    },
  },
});

export interface CreateAppOptions {
  readonly enableRuntimeMiddleware?: boolean;
}

export function createApp(options: CreateAppOptions = {}): OpenAPIHono<AppEnv> {
  const { enableRuntimeMiddleware = true } = options;
  const app = new OpenAPIHono<AppEnv>({
    defaultHook: openApiValidationHook,
  });

  app.use('/api/*', apiCorsMiddleware);

  if (enableRuntimeMiddleware) {
    app.use('/api/*', initDiScope);
  }

  app.route('/api', identityRoutes);
  app.route('/api/restaurants', catalogRoutes);
  app.route('/api/admin', adminCatalogRoutes);
  app.route('/api/pos/orders', orderRoutes);
  app.route('/api/ledger', ledgerRoutes);

  app.openapi(healthRoute, (c) => {
    const currentDatetime = new Date().toISOString();
    c.var.di.get('log').info`health check endpoint accessed at ${currentDatetime}`;
    return c.json(
      {
        status: 'ok' as const,
        service: 'foodapp-backend' as const,
        datetime: currentDatetime,
      },
      200,
    );
  });

  app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    description:
      'Bearer token authentication. Accepts either a POS Staff shift JWT (`pos_staff_token`) or a Better Auth Global User session token.',
  });

  app.doc31('/api/doc', {
    openapi: '3.1.0',
    info: {
      title: 'FoodApp UK POS & Storefront API',
      version: '1.0.0',
      description:
        'Multi-tenant UK Restaurant POS, Subdomain Storefront Catalog, Dynamic Roles & Rights (PBAC), Ordering, and Double-Entry Financial/Loyalty Ledger API.',
    },
  });

  app.get(
    '/api/reference',
    Scalar({
      url: '/api/doc',
      pageTitle: 'FoodApp API Reference',
    }),
  );

  app.onError(globalErrorHandler);

  return app;
}
