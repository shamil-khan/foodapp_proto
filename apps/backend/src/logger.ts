import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
// import { getFileSink } from '@logtape/file';
import {
  configure,
  getConsoleSink,
  getLogger,
  type Logger,
  type LogRecord,
} from '@logtape/logtape';

// Generates your clean timestamp string: YYYY-MM-DD_HH-MM-SS
const getLogFilename = () => {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
  //const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-'); // HH-MM-SS
  // return `dev_${dateStr}_${timeStr}.log`;
  return `dev_${dateStr}.log`;
};

const customFormatter = (record: LogRecord): string => {
  const ts = new Date(record.timestamp).toISOString();
  const level = record.level.toUpperCase().slice(0, 3);
  const cat = record.category.join('·');
  const msg = record.message
    .map((part) => (typeof part === 'string' ? part : JSON.stringify(part)))
    .join('');
  const reqTag = record.properties.requestId
    ? ` [RequestID: ${String(record.properties.requestId)}]`
    : '';
  return `${ts} [${level}] ${cat}: ${msg}${reqTag}\n`;
};

export const initLogger = async () => {
  const logDir = path.join(process.cwd(), 'logs');
  fs.mkdirSync(logDir, {
    recursive: true,
  });
  const logFilePath = path.join(logDir, getLogFilename());

  await configure({
    contextLocalStorage: new AsyncLocalStorage(),
    sinks: {
      console: getConsoleSink({
        formatter: customFormatter,
      }),
      file: (record: LogRecord) => {
        fs.appendFileSync(logFilePath, customFormatter(record), 'utf8');
      },
    },
    loggers: [
      {
        category: [
          'logtape',
          'meta',
        ],
        sinks: [
          'console',
        ],
        lowestLevel: 'warning',
      },
      {
        category: [],
        sinks: [
          'console',
          'file',
        ],
        lowestLevel: 'debug',
      },
    ],
  });
};

export class AppLogger {
  private readonly logtape: Logger;
  private readonly fallbackRequestId?: string;

  constructor(fallbackRequestId?: string) {
    this.fallbackRequestId = fallbackRequestId;
    this.logtape = getLogger([
      'foodapp',
      'backend',
    ]);
  }

  raw(message: string) {
    const ANSI_ESCAPE_REGEX = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
    const clean = message.replace(ANSI_ESCAPE_REGEX, '');
    const props = this.fallbackRequestId
      ? {
          message: clean,
          requestId: this.fallbackRequestId,
        }
      : {
          message: clean,
        };
    this.logtape.info('{message}', props);
  }

  debug(strings: TemplateStringsArray, ...values: unknown[]) {
    const message = strings.reduce((acc, str, i) => acc + str + String(values[i] ?? ''), '');
    const props = this.fallbackRequestId
      ? {
          message,
          requestId: this.fallbackRequestId,
        }
      : {
          message,
        };
    this.logtape.debug('{message}', props);
  }

  info(strings: TemplateStringsArray, ...values: unknown[]) {
    const message = strings.reduce((acc, str, i) => acc + str + String(values[i] ?? ''), '');
    const props = this.fallbackRequestId
      ? {
          message,
          requestId: this.fallbackRequestId,
        }
      : {
          message,
        };
    this.logtape.info('{message}', props);
  }

  error(strings: TemplateStringsArray, ...values: unknown[]) {
    const message = strings.reduce((acc, str, i) => acc + str + String(values[i] ?? ''), '');
    const props = this.fallbackRequestId
      ? {
          message,
          requestId: this.fallbackRequestId,
        }
      : {
          message,
        };
    this.logtape.error('{message}', props);
  }
}
