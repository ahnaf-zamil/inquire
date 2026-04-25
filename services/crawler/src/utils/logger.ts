import winston from 'winston';
import { CONFIG } from '../config';

const transports: winston.transport[] = [
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    ),
  }),
];

if (CONFIG.logFile) {
  transports.push(
    new winston.transports.File({
      filename: CONFIG.logFile,
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
    })
  );
}

export const logger = winston.createLogger({
  level: CONFIG.logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports,
});

export function createChildLogger(module: string): winston.Logger {
  return logger.child({ module });
}