import * as fs from 'node:fs';
import * as path from 'node:path';

const rootEnvPath = path.resolve(import.meta.dirname, '../../../.env');

if (fs.existsSync(rootEnvPath)) {
  process.loadEnvFile(rootEnvPath);
}
