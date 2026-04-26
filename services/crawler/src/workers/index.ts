import { CONFIG } from '../config';
import { logger } from '../utils/logger';
import { startCrawlerWorkers, stopCrawlerWorkers } from './crawler';
import { startPlaywrightWorkers, stopPlaywrightWorkers } from './playwright';
import { startPlaywrightManager, stopPlaywrightManager } from './playwright-manager';
import { startReindexWorker } from './reindex';
import { startRetryProcessor, stopRetryProcessor } from './retry-processor';
import { redis } from '../queue';

let running = false;

export async function startAllWorkers(): Promise<void> {
  if (running) {
    logger.warn('Workers already running');
    return;
  }

  running = true;
  logger.info('Starting all workers', {
    crawlerWorkers: CONFIG.crawlerWorkers,
    playwrightWorkers: 'dynamic',
  });

  await Promise.all([
    startCrawlerWorkers(CONFIG.crawlerWorkers),
    startReindexWorker(),
    startRetryProcessor(),
  ]);

  startPlaywrightManager();

  logger.info('All workers started');
}

export async function stopAllWorkers(): Promise<void> {
  if (!running) {
    return;
  }

  running = false;
  logger.info('Stopping all workers');

  stopPlaywrightManager();
  await stopPlaywrightWorkers();
  await stopCrawlerWorkers();
  await stopRetryProcessor();

  await redis.quit();
  logger.info('Redis connection closed');
  logger.info('All workers stopped');
}

export function isRunning(): boolean {
  return running;
}