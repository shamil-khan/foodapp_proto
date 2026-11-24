import './env.ts';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Client } from 'pg';

const TARGET_DB_URL =
  process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/food_app';

async function runSeed(): Promise<void> {
  const client = new Client({
    connectionString: TARGET_DB_URL,
  });

  try {
    await client.connect();
    console.log('🌱 Connecting to database for domain seeding...');

    const seedsDir = path.join(import.meta.dirname, '../seeds');
    const seedFiles = fs
      .readdirSync(seedsDir)
      .filter((file) => /^\d+_.+\.sql$/.test(file))
      .sort();

    if (seedFiles.length === 0) {
      throw new Error(`No numbered seed files found in ${seedsDir}`);
    }

    const combinedSeedSql = seedFiles
      .map((file) => `-- >>> ${file}\n${fs.readFileSync(path.join(seedsDir, file), 'utf-8')}`)
      .join('\n\n');

    console.log(`▶️  Executing ${seedFiles.length} seed files: ${seedFiles.join(', ')}...`);
    await client.query('BEGIN');
    await client.query(combinedSeedSql);
    await client.query('COMMIT');

    console.log(
      '✅ Successfully seeded platform users, 5 brands, 8 branches, roles, menus, and promos!',
    );
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error during database seeding. Transaction rolled back:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

await runSeed();
