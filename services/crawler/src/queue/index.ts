import Redis from 'ioredis';
import { CONFIG } from '../config';

export const redis = new Redis({
  host: CONFIG.redisHost,
  port: CONFIG.redisPort,
  maxRetriesPerRequest: 5,
  connectTimeout: 10000,
  retryStrategy: (times: number) => {
    const delay = Math.min(times * 100, 3000);
    return delay;
  },
});

export * from './crawl';
export * from './reindex';
export * from './processing';
export * from './visited';
export * from './rate-limit';