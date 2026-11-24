import './env.ts';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Client } from 'pg';

const TARGET_DB_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/food_app';

interface ColumnInfo {
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: 'YES' | 'NO';
  column_default: string | null;
}

function mapPgToTsType(col: ColumnInfo): string {
  const isNullable = col.is_nullable === 'YES';
  let tsType = 'unknown';

  if (col.data_type === 'ARRAY') {
    if (col.udt_name === '_text' || col.udt_name === '_varchar') {
      tsType = 'string[]';
    } else if (col.udt_name === '_int4' || col.udt_name === '_int8') {
      tsType = 'number[]';
    } else {
      tsType = 'unknown[]';
    }
  } else {
    switch (col.data_type) {
      case 'uuid':
      case 'text':
      case 'character varying':
      case 'numeric':
      case 'decimal':
      case 'USER-DEFINED':
        tsType = 'string';
        break;
      case 'integer':
      case 'smallint':
      case 'bigint':
      case 'real':
      case 'double precision':
        tsType = 'number';
        break;
      case 'boolean':
        tsType = 'boolean';
        break;
      case 'timestamp without time zone':
      case 'timestamp with time zone':
      case 'date':
        tsType = 'Date';
        break;
      case 'json':
      case 'jsonb':
        tsType = 'Record<string, unknown>';
        break;
      default:
        tsType = 'unknown';
    }
  }

  return isNullable ? `${tsType} | null` : tsType;
}

function toPascalCase(str: string): string {
  return str
    .replace(/^_+/, '')
    .split(/[_-]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function appendTableMetadata(lines: string[], tableName: string, columns: ColumnInfo[]): void {
  const pascalName = toPascalCase(tableName);
  const rowInterfaceName = `${pascalName}Row`;
  const insertInterfaceName = `${pascalName}Insert`;
  const metaConstName = `${pascalName}Table`;

  // 1. Row Interface
  lines.push(`export interface ${rowInterfaceName} {`);
  for (const col of columns) {
    lines.push(`  ${col.column_name}: ${mapPgToTsType(col)};`);
  }
  lines.push('}', '');

  // 2. Insert Interface (columns with defaults or nullable are optional)
  lines.push(`export interface ${insertInterfaceName} {`);
  for (const col of columns) {
    const isOptional = col.is_nullable === 'YES' || col.column_default !== null;
    lines.push(`  ${col.column_name}${isOptional ? '?' : ''}: ${mapPgToTsType(col)};`);
  }
  lines.push('}', '');

  // 3. Runtime Table & Quoted Column Metadata
  lines.push(`export const ${metaConstName}: TableMeta<`);
  lines.push('  {');
  for (const col of columns) {
    lines.push(`    ${col.column_name}: '"${col.column_name}"';`);
  }
  lines.push('  },');
  lines.push(`  ${rowInterfaceName},`);
  lines.push(`  ${insertInterfaceName}`);
  lines.push('> = {');
  lines.push(`  table: '"${tableName}"',`);
  lines.push('  cols: {');
  for (const col of columns) {
    lines.push(`    ${col.column_name}: '"${col.column_name}"',`);
  }
  lines.push('  },');
  lines.push('} as const;', '');
}

async function generateSchema(): Promise<void> {
  const client = new Client({
    connectionString: TARGET_DB_URL,
  });

  try {
    await client.connect();
    console.log('🔍 Introspecting PostgreSQL schema for TypeScript metadata generation...');

    const { rows } = await client.query<ColumnInfo>(`
      SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name <> '_Migration_History'
      ORDER BY table_name ASC, ordinal_position ASC;
    `);

    const tables = new Map<string, ColumnInfo[]>();
    for (const row of rows) {
      const list = tables.get(row.table_name) ?? [];
      list.push(row);
      tables.set(row.table_name, list);
    }

    const lines: string[] = [
      '// AUTO-GENERATED FILE — DO NOT EDIT MANUALLY',
      '// Run `pnpm db:codegen` after applying new SQL migrations.',
      '',
      'export interface TableMeta<TCols extends Record<string, string>, TRow, TInsert = Partial<TRow>> {',
      '  readonly table: string;',
      '  readonly cols: TCols;',
      '  readonly _row?: TRow;',
      '  readonly _insert?: TInsert;',
      '}',
      '',
    ];

    for (const [tableName, columns] of tables.entries()) {
      appendTableMetadata(lines, tableName, columns);
    }

    const generatedDir = path.resolve(import.meta.dirname, '../generated');
    fs.mkdirSync(generatedDir, {
      recursive: true,
    });
    const outPath = path.join(generatedDir, 'schema.generated.ts');
    fs.writeFileSync(outPath, lines.join('\n'), 'utf-8');
    console.log(`✅ Generated metadata for ${tables.size} tables at ${outPath}`);
  } finally {
    await client.end();
  }
}

await generateSchema();
