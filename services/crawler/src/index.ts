import { logger } from './utils/logger';
import { startAllWorkers, stopAllWorkers } from './workers';
import { loadSeeds } from './scripts/load-seeds';
import { ensureIndex } from './indexer';
import { CONFIG } from './config';

async function main(): Promise<void> {
  logger.info('Starting crawler service', { config: CONFIG });

  await ensureIndex();
  logger.info('Elasticsearch index ready');

  await loadSeeds();

  await startAllWorkers();

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function shutdown(): Promise<void> {
  logger.info('Shutting down crawler service');
  await stopAllWorkers();
  process.exit(0);
}

if (require.main === module) {
  main().catch(error => {
    logger.error('Crawler service failed', { error });
    process.exit(1);
  });
}

export { main };