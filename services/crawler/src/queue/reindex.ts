import { redis } from './index';
import { CONFIG } from '../config';

const REINDEX_QUEUE_KEY = 'reindex:queue';

export async function pushToReindexQueue(url: string, score?: number): Promise<void> {
  const timestamp = score || Date.now();
  await redis.zadd(REINDEX_QUEUE_KEY, timestamp, url);
}

export async function popFromReindexQueue(count: number): Promise<string[]> {
  const results = await redis.zrange(REINDEX_QUEUE_KEY, 0, count - 1);
  if (results.length > 0) {
    await redis.zrem(REINDEX_QUEUE_KEY, ...results);
  }
  return results;
}

export async function getReindexQueueLength(): Promise<number> {
  return redis.zcard(REINDEX_QUEUE_KEY);
}

export async function getUrlsOlderThan(hours: number): Promise<string[]> {
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  return redis.zrangebyscore(REINDEX_QUEUE_KEY, 0, cutoff);
}