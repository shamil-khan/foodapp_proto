import fs from 'node:fs';
import path from 'node:path';

interface JsonSchema {
  $ref?: string;
  type?: string | string[];
  enum?: unknown[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  additionalProperties?: boolean | JsonSchema;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  allOf?: JsonSchema[];
}

interface OpenApiParameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required?: boolean;
  schema?: JsonSchema;
}

interface OpenApiMediaType {
  schema?: JsonSchema;
}

interface OpenApiResponse {
  description?: string;
  content?: Record<string, OpenApiMediaType>;
}

interface OpenApiOperation {
  parameters?: OpenApiParameter[];
  requestBody?: {
    required?: boolean;
    content?: Record<string, OpenApiMediaType>;
  };
  responses?: Record<string, OpenApiResponse>;
}

interface OpenApiDocument {
  components?: {
    schemas?: Record<string, JsonSchema>;
  };
  paths?: Record<string, Record<string, OpenApiOperation>>;
}

const scriptDir = import.meta.dirname;
const frontendRoot = path.resolve(scriptDir, '..');

const liveBaseUrl = process.env.VITE_API_URL ?? 'http://localhost:3000';
const liveDocUrl = `${liveBaseUrl.replace(/\/$/, '')}/api/doc`;
const localContractPath = path.resolve(frontendRoot, 'contracts/open-api.json');

const schemaOutPath = path.resolve(frontendRoot, 'src/api/schema.generated.ts');
const modelsOutPath = path.resolve(frontendRoot, 'src/api/models.generated.ts');
const endpointsOutPath = path.resolve(frontendRoot, 'src/api/endpoints.generated.ts');

function schemaToTs(schema: JsonSchema | undefined, indent = '  '): string {
  if (!schema) {
    return 'unknown';
  }

  if (schema.$ref) {
    const refName = schema.$ref.split('/').pop() ?? 'unknown';
    return `components['schemas']['${refName}']`;
  }

  if (schema.allOf) {
    return schema.allOf.map((s) => schemaToTs(s, indent)).join(' & ');
  }

  if (schema.oneOf) {
    return schema.oneOf.map((s) => schemaToTs(s, indent)).join(' | ');
  }

  if (schema.anyOf) {
    return schema.anyOf.map((s) => schemaToTs(s, indent)).join(' | ');
  }

  if (schema.enum) {
    return schema.enum.map((val) => JSON.stringify(val)).join(' | ');
  }

  if (Array.isArray(schema.type)) {
    return schema.type
      .map((singleType) =>
        schemaToTs(
          {
            ...schema,
            type: singleType,
          },
          indent,
        ),
      )
      .join(' | ');
  }

  switch (schema.type) {
    case 'string':
      return 'string';
    case 'number':
    case 'integer':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'null':
      return 'null';
    case 'array':
      return `Array<${schemaToTs(schema.items, indent)}>`;
    case 'object': {
      const props = schema.properties ?? {};
      const requiredSet = new Set(schema.required ?? []);
      const entries = Object.entries(props);
      if (entries.length === 0) {
        return 'Record<string, unknown>';
      }
      const nextIndent = `${indent}  `;
      const propLines = entries.map(([key, propSchema]) => {
        const opt = requiredSet.has(key) ? '' : '?';
        const safeKey = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
        return `${nextIndent}${safeKey}${opt}: ${schemaToTs(propSchema, nextIndent)};`;
      });
      return `{\n${propLines.join('\n')}\n${indent}}`;
    }
    default:
      return 'unknown';
  }
}

function buildParametersTs(params: OpenApiParameter[] | undefined, indent = '      '): string {
  const byLocation: Record<'path' | 'query' | 'header' | 'cookie', OpenApiParameter[]> = {
    path: [],
    query: [],
    header: [],
    cookie: [],
  };

  for (const param of params ?? []) {
    byLocation[param.in].push(param);
  }

  const lines: string[] = [];
  for (const loc of [
    'query',
    'header',
    'path',
    'cookie',
  ] as const) {
    const group = byLocation[loc];
    if (group.length === 0) {
      lines.push(`${indent}${loc}?: never;`);
      continue;
    }
    const allOptional = group.every((p) => !p.required && loc !== 'path');
    const fields = group
      .map((p) => {
        const opt = p.required || loc === 'path' ? '' : '?';
        return `${indent}    ${p.name}${opt}: ${schemaToTs(p.schema, `${indent}    `)};`;
      })
      .join('\n');
    lines.push(`${indent}${loc}${allOptional ? '?' : ''}: {\n${fields}\n${indent}  };`);
  }

  return `{\n${lines.join('\n')}\n${indent}}`;
}

function buildOperationTs(op: OpenApiOperation, indent = '    '): string {
  const paramsTs = buildParametersTs(op.parameters, `${indent}  `);

  const reqJsonSchema = op.requestBody?.content?.['application/json']?.schema;
  const reqBodyTs = reqJsonSchema
    ? `{\n${indent}    content: {\n${indent}      'application/json': ${schemaToTs(reqJsonSchema, `${indent}      `)};\n${indent}    };\n${indent}  }`
    : 'never';

  const responses = op.responses ?? {};
  const responseLines = Object.entries(responses).map(([statusCode, res]) => {
    const resSchema = res.content?.['application/json']?.schema;
    const contentTs = resSchema
      ? `{\n${indent}        'application/json': ${schemaToTs(resSchema, `${indent}        `)};\n${indent}      }`
      : 'never';
    return `${indent}    ${statusCode}: {\n${indent}      headers: { [name: string]: unknown };\n${indent}      content: ${contentTs};\n${indent}    };`;
  });

  return [
    '{',
    `${indent}  parameters: ${paramsTs};`,
    `${indent}  requestBody${op.requestBody?.required ? '' : '?'}: ${reqBodyTs};`,
    `${indent}  responses: {\n${responseLines.join('\n')}\n${indent}  };`,
    `${indent}}`,
  ].join('\n');
}

function generateSchemaFile(doc: OpenApiDocument): string {
  const schemas = doc.components?.schemas ?? {};
  const schemaBlocks = Object.entries(schemas).map(
    ([name, schema]) => `    ${name}: ${schemaToTs(schema, '    ')};`,
  );

  const paths = doc.paths ?? {};
  const pathBlocks = Object.entries(paths).map(([routePath, methods]) => {
    const methodBlocks = Object.entries(methods).map(
      ([method, op]) => `    ${method.toLowerCase()}: ${buildOperationTs(op, '    ')};`,
    );
    return `  ${JSON.stringify(routePath)}: {\n${methodBlocks.join('\n')}\n  };`;
  });

  return [
    '// Auto-generated by scripts/generate-api.ts — DO NOT EDIT MANUALLY',
    'export interface paths {',
    ...pathBlocks,
    '}',
    '',
    'export interface components {',
    '  schemas: {',
    ...schemaBlocks,
    '  };',
    '}',
    '',
  ].join('\n');
}

function toCamelCaseMethodName(routePath: string): string {
  const segments = routePath
    .replace(/^\//, '')
    .split('/')
    .map((seg) => {
      if (seg.startsWith('{') && seg.endsWith('}')) {
        const param = seg.slice(1, -1);
        return `By${param.charAt(0).toUpperCase()}${param.slice(1)}`;
      }
      return `${seg.charAt(0).toUpperCase()}${seg.slice(1)}`;
    });

  return `get${segments.join('')}`;
}

function generateModelsFile(doc: OpenApiDocument): string {
  const schemaNames = Object.keys(doc.components?.schemas ?? {});
  return [
    '// Auto-generated by scripts/generate-api.ts — DO NOT EDIT MANUALLY',
    "import type { components } from './schema.generated';",
    '',
    "export type Schemas = components['schemas'];",
    '',
    ...schemaNames.map((name) => `export type ${name} = Schemas['${name}'];`),
    '',
  ].join('\n');
}

function generateEndpointsFile(doc: OpenApiDocument): string {
  const paths = doc.paths ?? {};
  const entries: string[] = [];

  for (const [routePath, methods] of Object.entries(paths)) {
    const getOp = methods.get;
    if (!getOp) {
      continue;
    }

    const fnName = toCamelCaseMethodName(routePath);
    const params = getOp.parameters ?? [];
    const hasRequiredParam = params.some((p) => p.in === 'path' || p.required);

    if (params.length === 0) {
      entries.push(`  ${fnName}: () =>
    queryOptions({
      queryKey: ['${routePath}'] as const,
      queryFn: () => api.GET('${routePath}'),
    }),`);
    } else if (hasRequiredParam) {
      entries.push(`  ${fnName}: (options: paths['${routePath}']['get']['parameters']) =>
    queryOptions({
      queryKey: ['${routePath}', options] as const,
      queryFn: () => api.GET('${routePath}', { params: options }),
    }),`);
    } else {
      entries.push(`  ${fnName}: (options?: paths['${routePath}']['get']['parameters']) =>
    queryOptions({
      queryKey: ['${routePath}', options] as const,
      queryFn: () => api.GET('${routePath}', { params: options }),
    }),`);
    }
  }

  return [
    '// Auto-generated by scripts/generate-api.ts — DO NOT EDIT MANUALLY',
    "import { queryOptions } from '@tanstack/react-query';",
    "import { api } from '@/lib/api-client';",
    "import type { paths } from './schema.generated';",
    '',
    'export const apiQueries = {',
    ...entries,
    '};',
    '',
  ].join('\n');
}

async function loadOpenApiSpec(): Promise<OpenApiDocument> {
  if (!process.argv.includes('--offline')) {
    try {
      const response = await fetch(liveDocUrl, {
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) {
        const doc = (await response.json()) as OpenApiDocument;
        fs.mkdirSync(path.dirname(localContractPath), {
          recursive: true,
        });
        fs.writeFileSync(localContractPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
        console.log(
          `Fetched live OpenAPI spec from ${liveDocUrl} and synced contracts/openapi.json`,
        );
        return doc;
      }
    } catch {
      // Live server unreachable; fall back to local contracts/openapi.json
    }
  }

  if (!fs.existsSync(localContractPath)) {
    throw new Error(
      `Neither live OpenAPI endpoint (${liveDocUrl}) nor local contract (${localContractPath}) is available.`,
    );
  }

  const raw = fs.readFileSync(localContractPath, 'utf8');
  console.log(`Using local OpenAPI contract file: ${localContractPath}`);
  return JSON.parse(raw) as OpenApiDocument;
}

async function main() {
  const doc = await loadOpenApiSpec();
  fs.mkdirSync(path.dirname(schemaOutPath), {
    recursive: true,
  });
  fs.writeFileSync(schemaOutPath, generateSchemaFile(doc), 'utf8');
  fs.writeFileSync(modelsOutPath, generateModelsFile(doc), 'utf8');
  fs.writeFileSync(endpointsOutPath, generateEndpointsFile(doc), 'utf8');
  console.log('Generated:');
  console.log(`  - ${schemaOutPath}`);
  console.log(`  - ${modelsOutPath}`);
  console.log(`  - ${endpointsOutPath}`);
}
void main();
