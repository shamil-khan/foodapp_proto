import type { ErrorHandler } from 'hono';
import type { AppEnv } from '@/container';
import { AppError } from '@/errors';
import { AppLogger } from '@/logger';

export const globalErrorHandler: ErrorHandler<AppEnv> = async (err, c) => {
  let log: AppLogger;
  try {
    log = c.var.di.get('log');
  } catch {
    log = new AppLogger(c.req.header('X-Request-Id') ?? 'unhandled-error');
  }

  let status = 500;
  let code = 'INTERNAL_SERVER_ERROR';
  let message = 'An unexpected runtime error occurred.';

  if (err instanceof AppError) {
    status = err.status;
    code = err.errorCode;
    message = err.message;
    log.info`Operational warning caught [${code}]: ${err.message}`;
  } else {
    log.error`CRITICAL UNCAUGHT EXCEPTION: ${err.stack || err.message}`;
    if (process.env.NODE_ENV === 'development') {
      message = err.message;
    }
  }

  return c.json(
    {
      success: false,
      error: {
        code,
        message,
        timestamp: new Date().toISOString(),
      },
    },
    status as 500,
  );
};
