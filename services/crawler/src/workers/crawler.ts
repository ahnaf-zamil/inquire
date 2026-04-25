import { CONFIG } from '../config';
import { CrawlJob, PageDocument } from '../types';
import { logger } from '../utils/logger';
import { popFromCrawlQueue, batchPushToCrawlQueue, getCrawlQueueLength } from '../queue/crawl';
import { tryMarkUrlIndexed, getIndexedUrlCount, removeFromIndexed } from '../queue/visited';
import { checkDomainRateLimit, checkGlobalRateLimit } from '../queue/rate-limit';
import { fetchUrl } from '../fetcher';
import { extractAll } from '../extractor';
import { indexPage, getPage } from '../indexer';
import { normalizeUrl, getDomain, isSafeUrl } from '../utils/url';
import { checkMemoryUsage } from '../utils/memory';
import { withRetry } from '../utils/retry';
import { pushToPlaywrightQueue } from './playwright-manager';
import { redis } from '../queue';

let crawlerWorkers: Promise<void>[] = [];
let stopping = false;
let lastStatsLog = 0;

export async function startCrawlerWorkers(count: number): Promise<void> {
  stopping = false;

  for (let i = 0; i < count; i++) {
    const worker = runCrawlerWorker(`crawler-${i}`);
    crawlerWorkers.push(worker);
  }

  logger.info('Started crawler workers', { count });
}

export async function stopCrawlerWorkers(): Promise<void> {
  stopping = true;
  await Promise.all(crawlerWorkers);
  crawlerWorkers = [];
}

async function runCrawlerWorker(workerId: string): Promise<void> {
  logger.info('Crawler worker started', { workerId });

  while (!stopping) {
    try {
      checkMemoryUsage();

      const now = Date.now();
      if (now - lastStatsLog > 30000) {
        const queueLength = await getCrawlQueueLength();
        const playwrightQueueLength = await redis.llen('playwright:queue');
        const indexedCount = await getIndexedUrlCount();

        logger.info('Crawler stats', {
          crawlQueue: queueLength,
          playwrightQueue: playwrightQueueLength,
          indexedUrls: indexedCount,
          workers: crawlerWorkers.length,
        });

        lastStatsLog = now;
      }

      const queueLength = await getCrawlQueueLength();
      if (queueLength === 0) {
        await new Promise(resolve => setTimeout(resolve, 500));
        continue;
      }

      const job = await popFromCrawlQueue(5);
      if (!job) {
        continue;
      }

      logger.info('Got job from queue', { url: job.url, depth: job.depth, source: job.source });

      try {
        await processCrawlJob(workerId, job);
      } catch (err) {
        logger.error('Process job error', {
          url: job.url,
          depth: job.depth,
          source: job.source,
          error: err instanceof Error ? { message: err.message, stack: err.stack, name: err.name } : err,
        });
      }
    } catch (error) {
      logger.error('Crawler worker error', {
        workerId,
        error: error instanceof Error ? { message: (error as Error).message, stack: (error as Error).stack, name: (error as Error).name } : error,
      });
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  logger.info('Crawler worker stopped', { workerId });
}

async function processCrawlJob(workerId: string, job: CrawlJob): Promise<void> {
  const normalizedUrl = normalizeUrl(job.url);
  if (!normalizedUrl) {
    logger.warn('Invalid URL format, skipping', { url: job.url });
    return;
  }

  if (!isSafeUrl(normalizedUrl)) {
    logger.warn('Unsafe URL detected, skipping', { url: normalizedUrl });
    return;
  }

  const domain = getDomain(normalizedUrl);
  if (!domain) {
    logger.warn('Invalid domain, skipping', { url: normalizedUrl });
    return;
  }

  await checkGlobalRateLimit();
  
  if (CONFIG.domainDelayMs > 0) {
    await checkDomainRateLimit(normalizedUrl);
  }

  // Atomic check-and-mark to prevent duplicate processing
  const markResult = await tryMarkUrlIndexed(normalizedUrl);
  if (markResult.alreadyIndexed) {
    logger.debug('Already indexed or being processed, skipping', { url: normalizedUrl });
    return;
  }

const fetchResult = await withRetry(
    () => fetchUrl(normalizedUrl),
    { maxRetries: 3, baseDelay: 1000 }
  );

  logger.debug('Fetch result', { url: normalizedUrl, contentType: fetchResult.contentType, htmlLength: fetchResult.html.length });

  if (fetchResult.contentType === 'javascript') {
    // Extract links from static HTML immediately (don't wait for Playwright)
    const { links } = extractAll(fetchResult.html, normalizedUrl);
    
    // Queue links for crawling
    if (job.depth < CONFIG.maxDepth && links.length > 0) {
      const batchResult = await batchPushToCrawlQueue(
        links.map(link => ({
          url: link,
          depth: job.depth + 1,
          source: 'link',
          enqueuedAt: Date.now(),
        }))
      );
      logger.info('Queued links from SPA page (static HTML)', {
        attempted: links.length,
        queued: batchResult.queued,
        skipped: batchResult.skipped,
        depth: job.depth + 1,
      });
    }
    
    // Remove from indexed set - Playwright worker will mark it after indexing
    await removeFromIndexed(normalizedUrl);
    
    const success = await pushToPlaywrightQueue({
      url: normalizedUrl,
      depth: job.depth,
      source: job.source,
      enqueuedAt: Date.now(),
    });

    if (!success) {
      logger.warn('Playwright queue full, dropping page', { url: normalizedUrl });
    }
    return;
  }

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
    contentType: fetchResult.contentType,
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

  logger.info('Indexed page', { url: normalizedUrl, wordCount: content.wordCount, linksCount: links.length });

  if (job.depth < CONFIG.maxDepth && links.length > 0) {
    const batchResult = await batchPushToCrawlQueue(
      links.map(link => ({
        url: link,
        depth: job.depth + 1,
        source: 'link',
        enqueuedAt: Date.now(),
      }))
    );
    logger.info('Queued links', {
      attempted: links.length,
      queued: batchResult.queued,
      skipped: batchResult.skipped,
      depth: job.depth + 1,
    });
  }
}