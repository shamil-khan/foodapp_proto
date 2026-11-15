import createClient, { type Middleware } from 'openapi-fetch';
import type { paths } from '@/api/schema.generated';
import { logger } from '@/logger';
import { authStore } from './auth-store';

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
  }
}

const posMiddleware: Middleware = {
  async onRequest({ request }) {
    const session = authStore.getSession();
    if (session?.token) {
      request.headers.set('Authorization', `Bearer ${session.token}`);
    }

    if (!request.signal) {
      return new Request(request, {
        signal: AbortSignal.timeout(8000),
      });
    }

    return request;
  },

  async onResponse({ request, response }) {
    if (response.ok) {
      return response;
    }

    let code = `HTTP_${response.status}`;
    let message = response.statusText || 'Unexpected server error';

    try {
      const payload = (await response.clone().json()) as {
        code?: string;
        error?: string;
        message?: string;
      };
      if (payload.code) {
        code = payload.code;
      }
      if (payload.error) {
        message = payload.error;
      } else if (payload.message) {
        message = payload.message;
      }
    } catch {
      // Non-JSON error body
    }

    logger.warning('API request failed: {method} {url} -> {status} ({code})', {
      method: request.method,
      url: request.url,
      status: response.status,
      code,
    });

    if (response.status === 401) {
      await authStore.clearSession();
    }

    throw new ApiClientError(response.status, code, message);
  },
};

export const api = createClient<paths>({
  baseUrl: import.meta.env.VITE_API_URL ?? 'http://localhost:3000',
});

api.use(posMiddleware);
