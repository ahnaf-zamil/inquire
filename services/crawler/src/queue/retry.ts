import { CONFIG } from '../config';
import { redis } from './index';
import { logger } from '../utils/logger';

export interface RetryJob {
  url: string;
  domain: string;
  attempt: number;
  maxAttempts?: number;
  enqueuedAt: number;
}

const RETRY_QUEUE_KEY = 'retry:queue';

export async function pushToRetryQueue(job: RetryJob): Promise<void> {
  const delay = CONFIG.retryDelays[job.attempt] || CONFIG.retryDelays[CONFIG.retryDelays.length - 1];
  const retryAt = Date.now() + delay;

  await redis.zadd(RETRY_QUEUE_KEY, retryAt, JSON.stringify(job));

  logger.info('Pushed to retry queue', { url: job.url, attempt: job.attempt, retryAt: new Date(retryAt).toISOString() });
}

export async function popFromRetryQueue(timeout: number): Promise<RetryJob | null> {
  const now = Date.now();
  const min = 0;
  const max = now;

  const results = await redis.zrangebyscore(RETRY_QUEUE_KEY, min, max, 'LIMIT', 0, 1);

  if (results.length === 0) {
    return null;
  }

  const jobData = results[0];
  await redis.zrem(RETRY_QUEUE_KEY, jobData);

  return JSON.parse(jobData) as RetryJob;
}

export async function getRetryJobCount(): Promise<number> {
  return redis.zcard(RETRY_QUEUE_KEY);
}

export async function getRetryJobsReady(): Promise<RetryJob[]> {
  const now = Date.now();
  const results = await redis.zrangebyscore(RETRY_QUEUE_KEY, 0, now);

  return results.map(r => JSON.parse(r) as RetryJob);
}