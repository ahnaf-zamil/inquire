import { CONFIG } from '../config';
import { CrawlJob, PageDocument } from '../types';
import { logger } from '../utils/logger';
import { popFromCrawlQueue, batchPushToCrawlQueue, getCrawlQueueLength } from '../queue/crawl';
import { tryMarkUrlIndexed, getIndexedUrlCount, removeFromIndexed } from '../queue/visited';
import { checkDomainRateLimit, checkGlobalRateLimit } from '../queue/rate-limit';
import { fetchUrl } from '../fetcher';
import { extractAll } from '../extractor';
import { indexPage, getPage, touchPage } from '../indexer';
import { normalizeUrl, getDomain, isSafeUrl } from '../utils/url';
import { checkMemoryUsage } from '../utils/memory';
import { withRetry } from '../utils/retry';
import { pushToPlaywrightQueue } from './playwright-manager';
import { redis } from '../queue';
import { fetchSitemapUrls } from '../fetcher/sitemap';
import { ensureRobotsFetched, isUrlAllowed } from '../fetcher/robots';
import { pushToRetryQueue, RetryJob } from '../queue/retry';

let crawlerWorkers: Promise<void>[] = [];
let stopping = false;
let lastStatsLog = 0;

async function discoverAndQueueSitemaps(domain: string): Promise<void> {
  try {
    const sitemapUrls = await fetchSitemapUrls(domain);
    if (sitemapUrls.length > 0) {
      const jobs: CrawlJob[] = sitemapUrls.map(url => ({
        url,
        depth: 1,
        source: 'link',
        enqueuedAt: Date.now(),
      }));
      const result = await batchPushToCrawlQueue(jobs);
      logger.info('Inline sitemap discovery', { domain, urlCount: sitemapUrls.length, queued: result.queued });
    }
  } catch (error) {
    logger.warn('Inline sitemap discovery failed', { domain, error });
  }
}

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

async function handleFetchError(url: string, domain: string, error: Error, isRetry: boolean): Promise<void> {
  const message = error.message || '';
  const is404 = message.includes('404') || message.includes('Not Found');
  const is410 = message.includes('410') || message.includes('Gone');
  const is503 = message.includes('503') || message.includes('Service Unavailable');

  if (is404 || is410 || is503) {
    await removeFromIndexed(url);
    logger.warn('Dead link removed', { url, error: error.message });
    return;
  }

  if (!isRetry) {
    const job: RetryJob = {
      url,
      domain,
      attempt: 0,
      enqueuedAt: Date.now() + CONFIG.retryDelays[0],
    };
    await pushToRetryQueue(job);
    logger.warn('Fetch failed, queued for retry', { url, error: error.message });
  }
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

  if (CONFIG.robotsEnabled) {
    await ensureRobotsFetched(domain);
    if (!isUrlAllowed(normalizedUrl, domain)) {
      logger.debug('URL disallowed by robots.txt, skipping', { url: normalizedUrl });
      return;
    }
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

  let fetchResult;
  try {
    fetchResult = await withRetry(
      () => fetchUrl(normalizedUrl),
      { maxRetries: 3, baseDelay: 1000 }
    );
  } catch (fetchError) {
    await handleFetchError(normalizedUrl, domain, fetchError as Error, job.source === 'reindex');
    return;
  }

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
    title_autocomplete: content.title,
    content: content.content,
    metaDescription: content.metadata.description,
    metaKeywords: content.metadata.keywords,
    ogTitle: content.metadata.ogTitle,
    ogDescription: content.metadata.ogDescription,
    ogImage: content.metadata.ogImage,
    depth: job.depth,
    contentType: fetchResult.contentType,
    wordCount: content.wordCount,
    language: content.language,
    firstIndexed: existingDoc?.firstIndexed || now,
    lastIndexed: now,
    updatedAt: now,
    contentHash: content.contentHash,
  };

  const isReindex = job.source === 'reindex';
  const contentUnchanged = isReindex && existingDoc && existingDoc.contentHash === content.contentHash;

  if (contentUnchanged) {
    await withRetry(
      () => touchPage(normalizedUrl),
      { maxRetries: 3, baseDelay: 2000 }
    );
    logger.info('Content unchanged, touched page', { url: normalizedUrl });
  } else {
    await withRetry(
      () => indexPage(document),
      { maxRetries: 3, baseDelay: 2000 }
    );
    logger.info('Indexed page', { url: normalizedUrl, wordCount: content.wordCount, linksCount: links.length });
  }

  if (CONFIG.sitemapEnabled) {
    const sitemapsDiscoveredKey = 'sitemaps:discovered';
    const alreadyDiscovered = await redis.sismember(sitemapsDiscoveredKey, domain);
    if (!alreadyDiscovered) {
      await redis.sadd(sitemapsDiscoveredKey, domain);
      discoverAndQueueSitemaps(domain);
    }
  }

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