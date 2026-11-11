import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Client } from 'pg';

const TARGET_DB_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/food_app';

async function ensureDatabaseExists(dbUrl: string): Promise<void> {
  const parsedUrl = new URL(dbUrl);
  const targetDbName = parsedUrl.pathname.replace(/^\//, '');

  if (!targetDbName) {
    throw new Error('Invalid DATABASE_URL: No target database name specified.');
  }

  parsedUrl.pathname = '/postgres';
  const adminClient = new Client({
    connectionString: parsedUrl.toString(),
  });

  try {
    await adminClient.connect();
    console.log(`Checking if database "${targetDbName}" exists...`);

    const res = await adminClient.query<{
      exists: number;
    }>('SELECT 1 AS exists FROM pg_database WHERE datname = $1;', [
      targetDbName,
    ]);

    if (res.rowCount === 0) {
      console.log(`Database "${targetDbName}" not found. Creating new database...`);
      await adminClient.query(`CREATE DATABASE "${targetDbName.replace(/"/g, '""')}";`);
      console.log(`Database "${targetDbName}" created successfully.`);
    } else {
      console.log(`Database "${targetDbName}" already exists. Proceeding to migrations...`);
    }
  } finally {
    await adminClient.end();
  }
}

async function runSqlMigrations(dbUrl: string): Promise<void> {
  const client = new Client({
    connectionString: dbUrl,
  });

  try {
    await client.connect();
    console.log('Connected to target database. Checking migration history...');

    await client.query(`
      CREATE TABLE IF NOT EXISTS "_Migration_History" (
        "id" SERIAL PRIMARY KEY,
        "filename" TEXT UNIQUE NOT NULL,
        "checksum" TEXT NOT NULL,
        "executedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const migrationsDir = path.join(import.meta.dirname, '../migrations');
    const files = fs
      .readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    const { rows: appliedRows } = await client.query<{
      filename: string;
    }>('SELECT "filename" FROM "_Migration_History";');
    const appliedSet = new Set(appliedRows.map((row) => row.filename));

    for (const file of files) {
      if (appliedSet.has(file)) {
        console.log(`Skipping [${file}] (Already applied)`);
        continue;
      }

      console.log(`Executing [${file}]...`);
      const filePath = path.join(migrationsDir, file);
      const sqlContent = fs.readFileSync(filePath, 'utf-8');
      const checksum = crypto.createHash('sha256').update(sqlContent).digest('hex');

      await client.query('BEGIN');
      try {
        await client.query(sqlContent);
        await client.query(
          'INSERT INTO "_Migration_History" ("filename", "checksum") VALUES ($1, $2);',
          [
            file,
            checksum,
          ],
        );
        await client.query('COMMIT');
        console.log(`Successfully applied [${file}]`);
      } catch (err: unknown) {
        await client.query('ROLLBACK');
        console.error(`Error applying [${file}]. Transaction rolled back:`, err);
        process.exit(1);
      }
    }

    console.log('Database setup and all 5 migration steps are complete.');
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  try {
    await ensureDatabaseExists(TARGET_DB_URL);
    await runSqlMigrations(TARGET_DB_URL);
  } catch (error: unknown) {
    console.error('Fatal Database Setup Error:', error);
    process.exit(1);
  }
}

await main();
