import { CONFIG } from '../config';
import { logger } from './logger';

let lastCheck = 0;
let checkInterval = CONFIG.memoryCheckInterval;

export function getMemoryUsage(): { rss: number; heapUsed: number; heapTotal: number } {
  const usage = process.memoryUsage();
  return {
    rss: usage.rss,
    heapUsed: usage.heapUsed,
    heapTotal: usage.heapTotal,
  };
}

export function getMemoryUsageMB(): { rss: number; heapUsed: number; heapTotal: number } {
  const usage = getMemoryUsage();
  return {
    rss: Math.round(usage.rss / 1024 / 1024),
    heapUsed: Math.round(usage.heapUsed / 1024 / 1024),
    heapTotal: Math.round(usage.heapTotal / 1024 / 1024),
  };
}

export function isMemoryLimitExceeded(): boolean {
  const usage = getMemoryUsage();
  return usage.rss > CONFIG.memoryLimitBytes;
}

export function checkMemoryUsage(): void {
  const now = Date.now();
  if (now - lastCheck < checkInterval) {
    return;
  }

  lastCheck = now;
  const usage = getMemoryUsageMB();

  if (isMemoryLimitExceeded()) {
    logger.warn('Memory limit exceeded', usage);
  }

  logger.debug('Memory usage', usage);
}

export function setMemoryCheckInterval(interval: number): void {
  checkInterval = interval;
}