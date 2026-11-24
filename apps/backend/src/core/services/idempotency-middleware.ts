import * as crypto from 'node:crypto';
import type { redisClient } from '@foodapp/db';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '@/container';

type RedisClientType = typeof redisClient;

export interface CachedIdempotencyRecord {
  readonly requestHash: string;
  readonly status: number;
  readonly body: unknown;
}

export interface IdempotencyStorePort {
  acquireLock(key: string, ttlSeconds: number): Promise<boolean>;
  getRecord(key: string): Promise<CachedIdempotencyRecord | null>;
  saveRecord(key: string, record: CachedIdempotencyRecord, ttlSeconds: number): Promise<void>;
  releaseLock(key: string): Promise<void>;
}

export class RedisIdempotencyStore implements IdempotencyStorePort {
  private readonly redis: RedisClientType;

  constructor(redis: RedisClientType) {
    this.redis = redis;
  }

  private async ensureOpen(): Promise<void> {
    if (!this.redis.isOpen) {
      await this.redis.connect();
    }
  }

  async acquireLock(key: string, ttlSeconds: number): Promise<boolean> {
    await this.ensureOpen();
    const res = await this.redis.set(`idemp:lock:${key}`, '1', {
      NX: true,
      EX: ttlSeconds,
    });
    return res === 'OK';
  }

  async getRecord(key: string): Promise<CachedIdempotencyRecord | null> {
    await this.ensureOpen();
    const raw = await this.redis.get(`idemp:resp:${key}`);
    return raw ? (JSON.parse(raw) as CachedIdempotencyRecord) : null;
  }

  async saveRecord(
    key: string,
    record: CachedIdempotencyRecord,
    ttlSeconds: number,
  ): Promise<void> {
    await this.ensureOpen();
    await this.redis.set(`idemp:resp:${key}`, JSON.stringify(record), {
      EX: ttlSeconds,
    });
  }

  async releaseLock(key: string): Promise<void> {
    await this.ensureOpen();
    await this.redis.del(`idemp:lock:${key}`);
  }
}

export function hashRequestPayload(rawBody: string): string {
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    const canonical = JSON.stringify(parsed, Object.keys(parsed as Record<string, unknown>).sort());
    return crypto.createHash('sha256').update(canonical).digest('hex');
  } catch {
    return crypto.createHash('sha256').update(rawBody).digest('hex');
  }
}

function replayCachedResponse(
  c: Context<AppEnv>,
  existing: CachedIdempotencyRecord,
  requestHash: string,
): Response {
  if (existing.requestHash !== requestHash) {
    return c.json(
      {
        type: 'https://foodapp.co.uk',
        title: 'Idempotency Key Payload Mismatch',
        status: 422,
        code: 'IDEMPOTENCY_KEY_REUSED',
        detail: 'Idempotency-Key was previously used with a different request payload.',
      },
      422,
    );
  }
  c.header('X-Idempotent-Replay', 'true');
  return c.json(existing.body as Record<string, unknown>, existing.status as 200);
}

export function idempotencyMiddleware(options: {
  readonly store: IdempotencyStorePort;
  readonly required?: boolean;
  readonly lockTtlSeconds?: number;
  readonly responseTtlSeconds?: number;
}) {
  const lockTtl = options.lockTtlSeconds ?? 30;
  const responseTtl = options.responseTtlSeconds ?? 86_400;

  return createMiddleware<AppEnv>(async (c, next) => {
    const rawKey = c.req.header('Idempotency-Key')?.trim();
    if (!rawKey) {
      if (options.required) {
        return c.json(
          {
            type: 'https://foodapp.co.uk',
            title: 'Idempotency-Key Header Required',
            status: 400,
            code: 'IDEMPOTENCY_KEY_REQUIRED',
            detail: 'This endpoint requires a unique Idempotency-Key header.',
          },
          400,
        );
      }
      await next();
      return;
    }

    const actorId = c.var.di?.get('request')?.actorId ?? 'anonymous';
    const scopedKey = `${actorId}:${c.req.path}:${rawKey}`;
    const rawBody = await c.req.raw.clone().text();
    const requestHash = hashRequestPayload(rawBody);

    const existing = await options.store.getRecord(scopedKey);
    if (existing) {
      return replayCachedResponse(c, existing, requestHash);
    }

    const locked = await options.store.acquireLock(scopedKey, lockTtl);
    if (!locked) {
      return c.json(
        {
          type: 'https://foodapp.co.uk',
          title: 'Concurrent Request In Progress',
          status: 409,
          code: 'IDEMPOTENCY_IN_PROGRESS',
          detail: 'A request with this Idempotency-Key is currently being processed.',
        },
        409,
      );
    }

    try {
      await next();
      if (c.res.status >= 200 && c.res.status < 300) {
        const cloned = c.res.clone();
        const body = (await cloned.json().catch(() => ({}))) as unknown;
        await options.store.saveRecord(
          scopedKey,
          {
            requestHash,
            status: c.res.status,
            body,
          },
          responseTtl,
        );
      }
    } finally {
      await options.store.releaseLock(scopedKey);
    }
  });
}
