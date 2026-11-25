import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { Scalar } from '@scalar/hono-api-reference';
import { billingRoutes } from '@/billing/services/billing-routes';
import { adminBrandRoutes, brandRoutes, posBrandRoutes } from '@/brand/services/brand-routes';
import { catalogRoutes, posCatalogRoutes } from '@/catalog/services/catalog-routes';
import { apiCorsMiddleware } from '@/config/cors';
import { type AppEnv, sharedIdempotencyStore } from '@/container';
import { openApiValidationHook } from '@/core/services/openapi-shared';
import { globalErrorHandler } from '@/errorHandler';
import { initDiScope } from '@/iam/services/auth-middleware';
import { iamRoutes } from '@/iam/services/iam-routes';
import { loyaltyRoutes } from '@/loyalty/services/loyalty-routes';
import {
  createPosOrderRoutes,
  createStorefrontOrderRoutes,
  deliveryWebhookRoutes,
} from '@/orders/services/order-routes';
import { supportRoutes } from '@/support/services/support-routes';

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

  app.route('/api', iamRoutes);
  app.route('/api/pos/support-tickets', supportRoutes);
  app.route('/api/brands', brandRoutes);
  app.route('/api/pos/brands', posBrandRoutes);
  app.route('/api/admin', adminBrandRoutes);
  app.route('/api/catalog', catalogRoutes);
  app.route('/api/pos/catalog', posCatalogRoutes);
  app.route('/api/orders', createStorefrontOrderRoutes(sharedIdempotencyStore));
  app.route('/api/pos/orders', createPosOrderRoutes(sharedIdempotencyStore));
  app.route('/api/webhooks/delivery', deliveryWebhookRoutes);
  app.route('/api/billing', billingRoutes);
  app.route('/api/loyalty', loyaltyRoutes);

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
      title: 'FoodApp Multi-Branch POS, Storefront, Billing & Loyalty API',
      version: '1.0.0',
      description:
        'Multi-branch restaurants, home/cloud kitchens, pricing workflows, per-branch PBAC, JIT Support Tickets, Event-sourced DDD/CQRS modular monolith for storefronts, offline-capable POS terminals, double-entry GBP billing, and multi-scope loyalty.',
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
