import { CONFIG } from '../config';
import { CrawlJob } from '../types';
import { logger } from '../utils/logger';
import { getRetryJobsReady, RetryJob } from '../queue/retry';
import { pushToCrawlQueue } from '../queue/crawl';

let retryProcessorRunning = false;

export async function startRetryProcessor(): Promise<void> {
  retryProcessorRunning = true;
  logger.info('Retry processor started');

  while (retryProcessorRunning) {
    try {
      await processRetries();
    } catch (error) {
      logger.error('Retry processor error', { error });
    }

    await new Promise(resolve => setTimeout(resolve, 30000));
  }
}

export async function stopRetryProcessor(): Promise<void> {
  retryProcessorRunning = false;
}

async function processRetries(): Promise<void> {
  const jobs = await getRetryJobsReady();

  if (jobs.length === 0) {
    return;
  }

  logger.info('Processing retries', { count: jobs.length });

  for (const job of jobs) {
    try {
      const crawlJob: CrawlJob = {
        url: job.url,
        depth: 0,
        source: 'retry',
        enqueuedAt: Date.now(),
        attempt: job.attempt,
        maxAttempts: job.maxAttempts || CONFIG.maxRetries,
      };

      await pushToCrawlQueue(crawlJob);

      logger.info('Retrying URL', { url: job.url, attempt: job.attempt + 1 });
    } catch (error) {
      logger.error('Failed to requeue retry job', { url: job.url, error });
    }
  }
}