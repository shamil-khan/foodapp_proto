import { Pool } from 'pg';
import { createClient } from 'redis';
import './env.ts';

export const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const redisClient = createClient({
  url: process.env.REDIS_URL,
});

redisClient.on('error', (err) => console.error('Redis Client Error:', err));

export type * from './types.ts';
