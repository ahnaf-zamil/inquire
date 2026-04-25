import fs from 'fs';
import path from 'path';
import { CrawlJob } from '../types';
import { logger } from '../utils/logger';
import { redis } from '../queue';
import { pushToCrawlQueue } from '../queue/crawl';
import { normalizeUrl } from '../utils/url';
import { computeShortHash } from '../utils/hash';

const SEED_LOADED_KEY = 'seed:loaded:seeds.txt';

async function loadSeeds(): Promise<void> {
  const seedFile = path.join(__dirname, '../../seeds/seeds.txt');

  if (!fs.existsSync(seedFile)) {
    logger.error('Seed file not found', { seedFile });
    return;
  }

  const content = fs.readFileSync(seedFile, 'utf-8');
  const fileHash = computeShortHash(content);
  
  const currentHash = await redis.get(SEED_LOADED_KEY);
  if (currentHash === fileHash) {
    logger.info('Seeds unchanged, skipping', { hash: fileHash });
    return;
  }

  const urls = content.split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'));

  logger.info('Loading seeds', { count: urls.length, hash: fileHash });

  for (const url of urls) {
    const normalized = normalizeUrl(url);
    if (!normalized) {
      logger.warn('Invalid seed URL, skipping', { url });
      continue;
    }
    const job: CrawlJob = {
      url: normalized,
      depth: 0,
      source: 'seed',
      enqueuedAt: Date.now(),
    };
    await pushToCrawlQueue(job);
  }

  await redis.set(SEED_LOADED_KEY, fileHash);
  logger.info('Seeds loaded', { count: urls.length, hash: fileHash });
}

if (require.main === module) {
  loadSeeds()
    .then(() => process.exit(0))
    .catch(error => {
      logger.error('Failed to load seeds', { error });
      process.exit(1);
    });
}

export { loadSeeds };