import { CONFIG } from '../config';
import { CrawlJob, PageDocument } from '../types';
import { logger } from '../utils/logger';
import { redis } from '../queue';
import { markUrlIndexed, isUrlIndexed } from '../queue/visited';
import { checkDomainRateLimit, checkGlobalRateLimit } from '../queue/rate-limit';
import { fetchWithPlaywright } from '../fetcher/playwright-client';
import { extractAll } from '../extractor';
import { indexPage, getPage } from '../indexer';
import { normalizeUrl, getDomain, isSafeUrl } from '../utils/url';
import { closeBrowser } from '../fetcher/playwright-client';
import { withRetry } from '../utils/retry';
import { batchPushToCrawlQueue } from '../queue/crawl';

const PLAYWRIGHT_QUEUE_KEY = 'playwright:queue';
const PLAYWRIGHT_PROCESSING_PREFIX = 'processing:playwright:';

let playwrightWorkers: Promise<void>[] = [];
let stopping = false;

export async function startPlaywrightWorkers(count: number): Promise<void> {
  stopping = false;

  for (let i = 0; i < count; i++) {
    const worker = runPlaywrightWorker(`playwright-${i}`);
    playwrightWorkers.push(worker);
  }

  logger.info('Started Playwright workers', { count });
}

export async function stopPlaywrightWorkers(): Promise<void> {
  stopping = true;
  await Promise.all(playwrightWorkers);
  await closeBrowser();
  playwrightWorkers = [];
}

async function runPlaywrightWorker(workerId: string): Promise<void> {
  logger.info('Playwright worker started', { workerId });

  while (!stopping) {
    try {
      const result = await redis.brpoplpush(
        PLAYWRIGHT_QUEUE_KEY,
        `${PLAYWRIGHT_PROCESSING_PREFIX}${workerId}`,
        5
      );

      if (!result) continue;

      const job: CrawlJob = JSON.parse(result);
      
      try {
        await processPlaywrightJob(workerId, job);
      } catch (err) {
        logger.error('Process Playwright job error', {
          url: job.url,
          depth: job.depth,
          error: err instanceof Error ? { message: err.message, stack: err.stack, name: err.name } : err,
        });
      } finally {
        await redis.lrem(`${PLAYWRIGHT_PROCESSING_PREFIX}${workerId}`, 1, job.url);
      }
    } catch (error) {
      logger.error('Playwright worker error', {
        workerId,
        error: error instanceof Error ? { message: (error as Error).message, stack: (error as Error).stack, name: (error as Error).name } : error,
      });
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  logger.info('Playwright worker stopped', { workerId });
}

async function processPlaywrightJob(workerId: string, job: CrawlJob): Promise<void> {
  const normalizedUrl = normalizeUrl(job.url);
  if (!normalizedUrl) {
    logger.warn('Invalid URL format', { url: job.url });
    return;
  }

  if (!isSafeUrl(normalizedUrl)) {
    logger.warn('Unsafe URL detected', { url: normalizedUrl });
    return;
  }

  const domain = getDomain(normalizedUrl);
  if (!domain) {
    logger.warn('Invalid URL', { url: job.url });
    return;
  }

  await checkGlobalRateLimit();
  
  if (CONFIG.domainDelayMs > 0) {
    await checkDomainRateLimit(normalizedUrl);
  }

  const indexedCheck = await isUrlIndexed(normalizedUrl);
  if (indexedCheck.indexed && indexedCheck.lastIndexed) {
    const hoursSince = (Date.now() - indexedCheck.lastIndexed) / (1000 * 60 * 60);
    if (hoursSince < CONFIG.reindexAfterHours) {
      logger.debug('Recently indexed, skipping', { url: normalizedUrl });
      return;
    }
  }

  const fetchResult = await withRetry(
    () => fetchWithPlaywright(normalizedUrl),
    { maxRetries: 3, baseDelay: 1000 }
  );
  
  const { content, links } = extractAll(fetchResult.html, normalizedUrl);

  const now = Date.now();
  
  const existingDoc = await getPage(normalizedUrl);
  const document: PageDocument = {
    url: normalizedUrl,
    domain,
    title: content.title,
    content: content.content,
    metaDescription: content.metadata.description,
    metaKeywords: content.metadata.keywords,
    ogTitle: content.metadata.ogTitle,
    ogDescription: content.metadata.ogDescription,
    ogImage: content.metadata.ogImage,
    depth: job.depth,
    contentType: 'javascript',
    wordCount: content.wordCount,
    firstIndexed: existingDoc?.firstIndexed || now,
    lastIndexed: now,
    updatedAt: now,
    contentHash: content.contentHash,
  };

  await withRetry(
    () => indexPage(document),
    { maxRetries: 3, baseDelay: 2000 }
  );
  
  await markUrlIndexed(normalizedUrl);

  logger.info('Indexed page with Playwright', { url: normalizedUrl, wordCount: content.wordCount, linksCount: links.length });

  // Queue discovered links for crawling
  if (job.depth < CONFIG.maxDepth && links.length > 0) {
    const batchResult = await batchPushToCrawlQueue(
      links.map(link => ({
        url: link,
        depth: job.depth + 1,
        source: 'link',
        enqueuedAt: Date.now(),
      }))
    );
    logger.info('Queued links from Playwright', {
      attempted: links.length,
      queued: batchResult.queued,
      skipped: batchResult.skipped,
      depth: job.depth + 1,
    });
  }
}

export async function pushToPlaywrightQueue(job: CrawlJob): Promise<void> {
  await redis.lpush(PLAYWRIGHT_QUEUE_KEY, JSON.stringify(job));
}