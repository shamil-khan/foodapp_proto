import './env.ts';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Client } from 'pg';

const TARGET_DB_URL =
  process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/food_app';

async function runSeed() {
  const client = new Client({
    connectionString: TARGET_DB_URL,
  });
  const forceSeed = process.argv.includes('--force');

  try {
    await client.connect();
    console.log('🌱 Connecting to database for seeding...');

    // Safety Guard: Check if data already exists
    const { rows } = await client.query(`SELECT COUNT(*) FROM "Restaurant";`);
    const existingCount = parseInt(rows[0].count, 10);

    if (existingCount > 0 && !forceSeed) {
      console.log(
        `⏭️  Database already contains ${existingCount} restaurants. Skipping seed to protect developer data.`,
      );
      console.log(
        '💡 Tip: Run "npx tsx seed-db.ts --force" if you want to append additional seed records.',
      );
      return;
    }

    const seedPath = path.join(import.meta.dirname, '../seeds/seed.sql');
    const seedSql = fs.readFileSync(seedPath, 'utf-8');

    console.log('▶️  Executing master seed script...');
    await client.query('BEGIN');
    await client.query(seedSql);
    await client.query('COMMIT');

    console.log(
      '✅ Successfully seeded 10 UK restaurants, 100 staff, global users, menus, and 20 orders!',
    );
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error during database seeding. Transaction rolled back:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runSeed();
