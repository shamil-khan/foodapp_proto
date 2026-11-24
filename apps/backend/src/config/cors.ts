import { cors } from 'hono/cors';

const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
  'capacitor://localhost',
  'http://localhost',
];

export function getAllowedOrigins(): string[] {
  const raw = process.env.FRONTEND_ORIGINS;
  if (!raw || raw.trim().length === 0) {
    return DEFAULT_ALLOWED_ORIGINS;
  }

  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

export const apiCorsMiddleware = cors({
  origin: (origin) => {
    const allowed = getAllowedOrigins();
    if (!origin) return allowed[0] ?? 'http://localhost:5173';
    return allowed.includes(origin) ? origin : null;
  },
  allowMethods: [
    'GET',
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
    'OPTIONS',
  ],
  // FILE: apps/backend/src/config/cors.ts (allowHeaders block)
  allowHeaders: [
    'Content-Type',
    'Authorization',
    'X-Request-Id',
    'X-Support-Ticket-Id',
    'Idempotency-Key',
  ],

  exposeHeaders: [
    'set-auth-token',
    'X-Request-Id',
  ],
  credentials: true,
  maxAge: 86400,
});
