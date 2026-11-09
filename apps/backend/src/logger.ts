import path from 'node:path';
import { getFileSink } from '@logtape/file';
import { configure, getConsoleSink } from '@logtape/logtape';

// Generates your clean timestamp string: YYYY-MM-DD_HH-MM-SS
const getLogFilename = () => {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
  const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-'); // HH-MM-SS
  return `dev_${dateStr}_${timeStr}.log`;
};

export const initLogger = async () => {
  const logDir = path.join(process.cwd(), 'logs');
  const logFilePath = path.join(logDir, getLogFilename());

  await configure({
    sinks: {
      // Sink 1: Human-readable terminal output
      console: getConsoleSink(),

      // Sink 2: Simultaneous text stream to your physical file
      file: getFileSink(logFilePath, {
        // Automatically flushes data to disk immediately on every event
        flushOnWrite: true,
      }),
    },
    loggers: [
      {
        // Category root match: applies to your custom logs and hono's internals
        category: [],
        // 🔴 This array directs the logs to BOTH outputs at the exact same time
        sinks: [
          'console',
          'file',
        ],
        lowestLevel: 'debug',
      },
    ],
  });
};
