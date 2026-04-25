import { redis } from './index';
import { CONFIG } from '../config';

const INDEXED_URLS_KEY = 'indexed:urls';

const LUA_CHECK_AND_MARK = `
  local exists = redis.call('ZSCORE', KEYS[1], ARGV[1])
  if exists then 
    return tonumber(exists)
  end
  redis.call('ZADD', KEYS[1], ARGV[2], ARGV[1])
  return 0
`;

export async function isUrlIndexed(url: string): Promise<{ indexed: boolean; lastIndexed?: number }> {
  const score = await redis.zscore(INDEXED_URLS_KEY, url);
  if (!score) {
    return { indexed: false };
  }
  return { indexed: true, lastIndexed: parseInt(score, 10) };
}

export async function markUrlIndexed(url: string): Promise<void> {
  const now = Date.now();
  await redis.zadd(INDEXED_URLS_KEY, now, url);
}

export async function tryMarkUrlIndexed(url: string): Promise<{ marked: boolean; alreadyIndexed: boolean; lastIndexed?: number }> {
  const now = Date.now();
  const result = await redis.eval(LUA_CHECK_AND_MARK, 1, INDEXED_URLS_KEY, url, now.toString());
  
  const score = Number(result);
  if (score === 0) {
    return { marked: true, alreadyIndexed: false };
  }
  return { marked: false, alreadyIndexed: true, lastIndexed: score };
}

export async function getIndexedUrlCount(): Promise<number> {
  return redis.zcard(INDEXED_URLS_KEY);
}

export async function hasReachedMaxUrls(): Promise<boolean> {
  const count = await getIndexedUrlCount();
  return count >= CONFIG.maxIndexedUrls;
}

export async function getUrlsOlderThanTimestamp(timestamp: number): Promise<string[]> {
  return redis.zrangebyscore(INDEXED_URLS_KEY, 0, timestamp);
}

export async function removeFromIndexed(url: string): Promise<void> {
  await redis.zrem(INDEXED_URLS_KEY, url);
}
