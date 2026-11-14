import { serve } from '@hono/node-server';
import { withContext } from '@logtape/logtape';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { requestId } from 'hono/request-id';
import { createApp } from '@/app';
import type { AppEnv } from '@/container';
import { globalErrorHandler } from '@/errorHandler';
import { AppLogger, initLogger } from '@/logger';

await initLogger();
const bootLog = new AppLogger('startup');
const httpLog = new AppLogger();

const rootApp = new Hono<AppEnv>();

rootApp.use('*', requestId());
rootApp.use('*', async (c, next) => {
  return withContext(
    {
      requestId: c.get('requestId'),
    },
    next,
  );
});

rootApp.use(
  '*',
  logger((str) => {
    httpLog.raw(str);
  }),
);

const apiApp = createApp({
  enableRuntimeMiddleware: true,
});
rootApp.route('/', apiApp);

rootApp.onError(globalErrorHandler);

serve(
  {
    fetch: rootApp.fetch,
    port: Number(process.env.PORT ?? 3000),
  },
  (info) => {
    bootLog.info`Hono DDD Backend running at http://localhost:${info.port}`;
  },
);
