import { CONFIG } from '../config';
import { logger } from '../utils/logger';
import { getPagesOlderThan } from '../indexer/operations';
import { pushToReindexQueue } from '../queue/reindex';
import { normalizeUrl } from '../utils/url';

async function runReindexCron(): Promise<void> {
  logger.info('Starting reindex cron', { reindexAfterHours: CONFIG.reindexAfterHours });

  try {
    const urls = await getPagesOlderThan(CONFIG.reindexAfterHours, CONFIG.reindexBatchSize);
    logger.info('Found pages for reindex', { count: urls.length });

    let queued = 0;
    for (const url of urls) {
      try {
        const normalized = normalizeUrl(url);
        if (!normalized) continue;
        await pushToReindexQueue(normalized);
        queued++;
      } catch (error) {
        logger.warn('Failed to queue URL for reindex', { url, error });
      }
    }

    logger.info('Reindex cron complete', { found: urls.length, queued });
  } catch (error) {
    logger.error('Reindex cron failed', { error });
    throw error;
  }
}

if (require.main === module) {
  runReindexCron()
    .then(() => process.exit(0))
    .catch(error => {
      logger.error('Reindex cron failed', { error });
      process.exit(1);
    });
}

export { runReindexCron };