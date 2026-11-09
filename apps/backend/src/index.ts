import { serve } from '@hono/node-server';
import { inferdiHono } from '@inferdi/hono';
import { honoLogger } from '@logtape/hono';
import { getLogger } from '@logtape/logtape';
import { Hono } from 'hono';
import { type AppEnv, openRequestScope, rootContainer } from '@/di';
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

// 3. Instantiate an app-specific logger category
const log = getLogger([
  'app',
  'backend',
]);

app.get('/api/health', (c) => {
  const currentDatetime = new Date().toISOString();

  // Logs to both Console and the dynamic File at the same time
  log.info`health check endpoint accessed at ${currentDatetime}`;

  return c.json({
    status: 'ok',
    service: 'foodapp-backend',
    datetime: currentDatetime,
  });
});

app.get('/users/:id', async (c) => {
  return c.json(await c.var.di.get('users').profile(c.req.param('id')));
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
