import type { ErrorHandler } from 'hono';
import type { AppEnv } from '@/di';
import { AppError } from '@/errors';

export const globalErrorHandler: ErrorHandler<AppEnv> = async (err, c) => {
  // 1. Resolve your InferDI log instance to capture structural trace
  const log = c.var.di.get('log');

  let status: number = 500;
  let code = 'INTERNAL_SERVER_ERROR';
  let message = 'An unexpected runtime error occurred.';

  // 2. Classify the exception type safely
  if (err instanceof AppError) {
    status = err.status;
    code = err.errorCode;
    message = err.message;

    log.info`Operational warning caught [${code}]: ${err.message}`;
  } else {
    // Critical unexpected crash (e.g., Database timeout, network dropped)
    log.info`CRITICAL UNCAUGHT EXCEPTION: ${err.stack || err.message}`;

    // In production, keep raw message hidden; in development you can reveal it
    if (process.env.NODE_ENV === 'development') {
      message = err.message;
    }
  }

  // 3. Return a consistent structural contract back to client
  return c.json(
    {
      success: false,
      error: {
        code,
        message,
        timestamp: new Date().toISOString(),
      },
    },
    status as any,
  );
};
