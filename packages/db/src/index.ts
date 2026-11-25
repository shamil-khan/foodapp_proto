import './env.ts';
import { Pool } from 'pg';
import { createClient } from 'redis';
import { PgDbReader, PgUnitOfWork } from './unit-of-work.ts';

export type { Pool, PoolClient } from 'pg';

export const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const dbReader = new PgDbReader(pgPool);
export const unitOfWork = new PgUnitOfWork(pgPool);

export const redisClient = createClient({
  url: process.env.REDIS_URL,
});

redisClient.on('error', (err: unknown) => {
  console.error('Redis Client Error:', err);
});

export * from '../generated/schema.generated.ts';
export * from './sql-builder.ts';
export * from './types.ts';
export * from './unit-of-work.ts';
