import { redis } from './index';
import { CrawlJob } from '../types';

const PROCESSING_PREFIX = 'processing:';

export function getProcessingKey(workerId: string): string {
  return `${PROCESSING_PREFIX}${workerId}`;
}

export async function moveToProcessingQueue(workerId: string, job: CrawlJob): Promise<void> {
  const key = getProcessingKey(workerId);
  await redis.lpush(key, JSON.stringify(job));
}

export async function moveFromProcessingQueue(workerId: string): Promise<CrawlJob | null> {
  const key = getProcessingKey(workerId);
  const result = await redis.rpop(key);

  if (!result) return null;

  try {
    return JSON.parse(result) as CrawlJob;
  } catch {
    return null;
  }
}

export async function getProcessingQueueLength(workerId: string): Promise<number> {
  const key = getProcessingKey(workerId);
  return redis.llen(key);
}

export async function clearProcessingQueue(workerId: string): Promise<void> {
  const key = getProcessingKey(workerId);
  await redis.del(key);
}