import { redis } from './index';
import { CrawlJob } from '../types';
import { CONFIG } from '../config';

const CRAWL_QUEUE_KEY = 'crawl:queue';

const LUA_BATCH_PUSH = `
local key = KEYS[1]
local maxSize = tonumber(ARGV[1])
local currentSize = redis.call('LLEN', key)
local jobs = {}

for i = 2, #ARGV do
  table.insert(jobs, ARGV[i])
end

local allowed = math.min(#jobs, maxSize - currentSize)

if allowed > 0 then
  for i = 1, allowed do
    redis.call('RPUSH', key, jobs[i])
  end
end

return allowed
`;

export async function batchPushToCrawlQueue(jobs: CrawlJob[]): Promise<{ queued: number; skipped: number }> {
  if (jobs.length === 0) {
    return { queued: 0, skipped: 0 };
  }

  const args: (string | number)[] = [CONFIG.maxQueueSize];
  for (const job of jobs) {
    args.push(JSON.stringify(job));
  }

  const queued = await redis.eval(
    LUA_BATCH_PUSH,
    1,
    CRAWL_QUEUE_KEY,
    ...args
  ) as number;

  return {
    queued,
    skipped: jobs.length - queued,
  };
}

export async function pushToCrawlQueue(job: CrawlJob): Promise<boolean> {
  const queueLen = await redis.llen(CRAWL_QUEUE_KEY);
  if (queueLen >= CONFIG.maxQueueSize) {
    return false;
  }

  await redis.rpush(CRAWL_QUEUE_KEY, JSON.stringify(job));
  return true;
}

export async function popFromCrawlQueue(timeout = 5): Promise<CrawlJob | null> {
  const result = await redis.lpop(CRAWL_QUEUE_KEY);
  if (!result) {
    await new Promise(resolve => setTimeout(resolve, timeout * 1000));
    return null;
  }

  try {
    return JSON.parse(result) as CrawlJob;
  } catch {
    return null;
  }
}

export async function getCrawlQueueLength(): Promise<number> {
  return redis.llen(CRAWL_QUEUE_KEY);
}