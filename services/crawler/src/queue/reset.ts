import { redis as appRedis } from './index';
import { logger } from '../utils/logger';
import type Redis from 'ioredis';

const REDIS_QUEUE_KEYS = [
  'crawl:queue',
  'playwright:queue',
  'reindex:queue',
  'retry:queue',
  'seed:loaded:seeds.txt',
  'sitemaps:discovered',
  'indexed:urls',
];

export async function clearRedisQueues(redis?: Redis): Promise<void> {
  const client = redis || appRedis;
  for (const key of REDIS_QUEUE_KEYS) {
    await client.del(key);
  }
  const domainKeys = await client.keys('domain:*');
  if (domainKeys.length > 0) {
    await client.del(...domainKeys);
  }
  logger.info('Redis queues cleared');
}