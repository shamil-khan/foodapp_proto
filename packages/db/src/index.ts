import './env.ts';
import { Pool } from 'pg';
import { createClient } from 'redis';

export type { Pool, PoolClient } from 'pg';

export const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const redisClient = createClient({
  url: process.env.REDIS_URL,
});

redisClient.on('error', (err: unknown) => {
  console.error('Redis Client Error:', err);
});

export * from './schema.generated.ts';
export * from './sql-builder.ts';
export * from './types.ts';
