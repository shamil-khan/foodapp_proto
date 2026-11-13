import { serve } from '@hono/node-server';
import { withContext } from '@logtape/logtape';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { requestId } from 'hono/request-id';
import type { AppEnv } from '@/container';
import { catalogRoutes } from '@/contexts/catalog/services/catalog-routes';
import { initDiScope, requirePosStaff } from '@/contexts/identity/services/auth-middleware';
import { identityRoutes } from '@/contexts/identity/services/identity-routes';
import { ledgerRoutes } from '@/contexts/ledger/services/ledger-routes';
import { orderRoutes } from '@/contexts/ordering/services/order-routes';
import { globalErrorHandler } from '@/errorHandler';
import { AppLogger, initLogger } from '@/logger';

await initLogger();
const bootLog = new AppLogger('startup');
const httpLog = new AppLogger();

const app = new Hono<AppEnv>();

// 1. Generate Request ID & bind LogTape AsyncLocalStorage context
app.use('*', requestId());
app.use('*', async (c, next) => {
  return withContext(
    {
      requestId: c.get('requestId'),
    },
    next,
  );
});

// 2. Chronological Hono HTTP Logger (<-- Start, Errors in middle, --> End)
app.use(
  '*',
  logger((str) => {
    httpLog.raw(str);
  }),
);

// 3. @inferdi/hono Scope Hydration (`c.var.di`)
app.use('/api/*', initDiScope);

// 4. Bounded Context Routes
app.route('/api', identityRoutes);
app.route('/api/restaurants', catalogRoutes);

app.use('/api/pos/orders/*', requirePosStaff());
app.route('/api/pos/orders', orderRoutes);

app.route('/api/ledger', ledgerRoutes);

app.get('/api/health', (c) => {
  const currentDatetime = new Date().toISOString();
  c.var.di.get('log').info`health check endpoint accessed at ${currentDatetime}`;
  // throw new Error('Simulated error for testing error handling'); // Simulate an error for testing
  return c.json({
    status: 'ok',
    service: 'foodapp-backend',
    datetime: currentDatetime,
  });
});

app.onError(globalErrorHandler);

serve(
  {
    fetch: app.fetch,
    port: 3000,
  },
  (info) => {
    bootLog.info`Hono DDD Backend running at http://localhost:${info.port}`;
  },
);
