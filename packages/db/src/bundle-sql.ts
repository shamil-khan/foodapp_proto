import * as fs from 'node:fs';
import * as path from 'node:path';

interface BundleSpec {
  readonly label: string;
  readonly sourceDir: string;
  readonly workspacePrefix: string;
  readonly outputFilename: string;
  readonly regenerateCmd: string;
}

const SPECS: Record<string, BundleSpec> = {
  '--seeds': {
    label: 'seeds',
    sourceDir: path.resolve(import.meta.dirname, '../seeds'),
    workspacePrefix: 'packages/db/seeds',
    outputFilename: 'seed.bundle.sql',
    regenerateCmd: 'pnpm --filter @foodapp/db db:seed:bundle',
  },
  '--migrations': {
    label: 'migrations',
    sourceDir: path.resolve(import.meta.dirname, '../migrations'),
    workspacePrefix: 'packages/db/migrations',
    outputFilename: 'migrations.bundle.sql',
    regenerateCmd: 'pnpm --filter @foodapp/db db:migrations:bundle',
  },
};

function runBundle(): void {
  const flag = process.argv[2] ?? '';
  const spec = SPECS[flag];
  if (!spec) {
    console.error('Usage: tsx src/bundle-sql.ts <--seeds | --migrations>');
    process.exit(1);
  }

  const files = fs
    .readdirSync(spec.sourceDir)
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort();

  if (files.length === 0) {
    throw new Error(`No numbered SQL files found in ${spec.sourceDir}`);
  }

  const header = [
    `-- AUTO-GENERATED ${spec.label.toUpperCase()} BUNDLE — DO NOT EDIT MANUALLY`,
    `-- Regenerate with: ${spec.regenerateCmd}`,
  ].join('\n');

  const body = files
    .map((file) => {
      const content = fs.readFileSync(path.join(spec.sourceDir, file), 'utf-8').trim();
      return `-- >>> ${spec.workspacePrefix}/${file}\n${content}`;
    })
    .join('\n\n');

  const bundlesDir = path.resolve(import.meta.dirname, '../generated/bundles');
  fs.mkdirSync(bundlesDir, {
    recursive: true,
  });
  const outPath = path.join(bundlesDir, spec.outputFilename);
  fs.writeFileSync(outPath, `${header}\n\n${body}\n`, 'utf-8');

  console.log(
    `✅ Bundled ${files.length} ${spec.label} files -> packages/db/generated/bundles/${spec.outputFilename}`,
  );
}

runBundle();
