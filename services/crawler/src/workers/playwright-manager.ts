import { logger } from '../utils/logger';
import { redis } from '../queue';
import { CONFIG } from '../config';
import { startPlaywrightWorkers, stopPlaywrightWorkers } from './playwright';
import { CrawlJob } from '../types';

const PLAYWRIGHT_QUEUE_KEY = 'playwright:queue';
const MAX_QUEUE_LENGTH = 5000;
const IDLE_TIMEOUT_MS = 60000;

let currentWorkerCount = 0;
let lastActivityTime = Date.now();
let monitorInterval: NodeJS.Timeout | null = null;

interface SpawnConfig {
  minQueue: number;
  workers: number;
}

const SPAWN_CONFIG: SpawnConfig[] = [
  { minQueue: 0, workers: 0 },
  { minQueue: 1, workers: 1 },
  { minQueue: 10, workers: 2 },
  { minQueue: 50, workers: 3 },
  { minQueue: 100, workers: CONFIG.playwrightWorkers },
];

export async function ensurePlaywrightWorkers(): Promise<void> {
  const queueLength = await redis.llen(PLAYWRIGHT_QUEUE_KEY);

  if (queueLength === 0) {
    if (currentWorkerCount > 0) {
      const idleTime = Date.now() - lastActivityTime;
      if (idleTime > IDLE_TIMEOUT_MS) {
        logger.info('Stopping idle Playwright workers', { idleTimeMs: idleTime });
        await stopPlaywrightWorkers();
        currentWorkerCount = 0;
      }
    }
    return;
  }

  lastActivityTime = Date.now();

  let neededWorkers = 0;
  for (const config of SPAWN_CONFIG) {
    if (queueLength >= config.minQueue) {
      neededWorkers = config.workers;
    }
  }

  if (neededWorkers > currentWorkerCount) {
    const toStart = neededWorkers - currentWorkerCount;
    logger.info('Spawning additional Playwright workers', {
      current: currentWorkerCount,
      starting: toStart,
      queueDepth: queueLength,
    });
    await startPlaywrightWorkers(toStart);
    currentWorkerCount = neededWorkers;
  }
}

export async function pushToPlaywrightQueue(job: CrawlJob): Promise<boolean> {
  const queueLen = await redis.llen(PLAYWRIGHT_QUEUE_KEY);
  if (queueLen >= MAX_QUEUE_LENGTH) {
    return false;
  }

  await redis.lpush(PLAYWRIGHT_QUEUE_KEY, JSON.stringify(job));

  await ensurePlaywrightWorkers();

  return true;
}

export function startPlaywrightManager(): void {
  if (monitorInterval) return;

  monitorInterval = setInterval(async () => {
    try {
      await ensurePlaywrightWorkers();
    } catch (error) {
      logger.error('Playwright manager error', { error });
    }
  }, 5000);

  logger.info('Playwright manager started');
}

export function stopPlaywrightManager(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
}