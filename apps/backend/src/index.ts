import { serve } from '@hono/node-server';
import { inferdiHono } from '@inferdi/hono';
import { honoLogger } from '@logtape/hono';
import { Hono } from 'hono';
import { type AppEnv, openRequestScope, rootContainer } from '@/di';
import { globalErrorHandler } from '@/errorHandler';
import { NotFoundError } from '@/errors';
import { initLogger } from '@/logger';

// 1. Initialize LogTape multi-sink system immediately
await initLogger();

const app = new Hono<AppEnv>();

// Wire up the middleware to generate a unique scope per inbound HTTP request
app.use(
  '*',
  inferdiHono({
    container: rootContainer,
    createScope: (_root, c) => openRequestScope(crypto.randomUUID(), c.req.header('x-user-id')),
  }),
);

// 2. Attach LogTape HTTP request logger
app.use(
  honoLogger({
    format: 'dev',
    context: true,
  }),
);

app.onError(globalErrorHandler);

app.get('/api/health', (c) => {
  const currentDatetime = new Date().toISOString();

  // Logs to both Console and the dynamic File at the same time
  c.var.di.get('log').info`health check endpoint accessed at ${currentDatetime}`;

  return c.json({
    status: 'ok',
    service: 'foodapp-backend',
    datetime: currentDatetime,
  });
});

app.get('/users/:id', async (c) => {
  const userId = c.req.param('id');
  if (userId === 'forbidden') {
    // Simply throw it; the boundary automatically traps it cleanly
    throw new NotFoundError(`User with ID ${userId} does not exist.`);
  }
  return c.json(await c.var.di.get('users').profile(userId));
});

// Explicit 404 handler fallback for unmatched routing patterns
app.notFound((c) => {
  return c.json(
    {
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: `Route ${c.req.path} not found`,
      },
    },
    404,
  );
});

serve(
  {
    fetch: app.fetch,
    port: 4000,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  },
);
