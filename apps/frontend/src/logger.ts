import { configure, getConsoleSink, getLogger } from '@logtape/logtape';

// 1. Initialize LogTape configuration
await configure({
  sinks: {
    console: getConsoleSink(),
  },
  loggers: [
    {
      category: [
        'app',
      ],
      // Only show debug/info logs during local development
      lowestLevel: import.meta.env.DEV ? 'debug' : 'warning',
      sinks: [
        'console',
      ],
    },
  ],
});

// 2. Export the logger instance for use across your components
export const logger = getLogger([
  'app',
]);
