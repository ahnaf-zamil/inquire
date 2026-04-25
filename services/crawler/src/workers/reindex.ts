import { CONFIG } from '../config';
import { logger } from '../utils/logger';
import { getPagesOlderThan } from '../indexer/operations';
import { pushToReindexQueue } from '../queue/reindex';
import { normalizeUrl } from '../utils/url';
import { redis } from '../queue';

const REINDEX_QUEUE_KEY = 'reindex:queue';

let reindexInterval: NodeJS.Timeout | null = null;
let running = false;

export async function startReindexWorker(): Promise<void> {
  if (running) return;

  running = true;
  logger.info('Starting reindex worker');

  runReindexCycle();

  const intervalMs = CONFIG.reindexAfterHours * 60 * 60 * 1000;
  reindexInterval = setInterval(runReindexCycle, intervalMs);
}

export async function stopReindexWorker(): Promise<void> {
  running = false;
  if (reindexInterval) {
    clearInterval(reindexInterval);
    reindexInterval = null;
  }
  logger.info('Reindex worker stopped');
}

async function runReindexCycle(): Promise<void> {
  try {
    logger.info('Starting reindex cycle');

    const urls = await getPagesOlderThan(CONFIG.reindexAfterHours, CONFIG.reindexBatchSize);
    logger.info('Found pages for reindex', { count: urls.length });

    let queued = 0;
    for (const url of urls) {
      const normalized = normalizeUrl(url);
      if (!normalized) continue;
      
      const existingScore = await redis.zscore(REINDEX_QUEUE_KEY, normalized);
      if (!existingScore) {
        await pushToReindexQueue(normalized);
        queued++;
      }
    }

    logger.info('Reindex cycle complete', { found: urls.length, queued });
  } catch (error) {
    logger.error('Reindex cycle failed', { error });
  }
}

export async function triggerReindex(): Promise<void> {
  await runReindexCycle();
}