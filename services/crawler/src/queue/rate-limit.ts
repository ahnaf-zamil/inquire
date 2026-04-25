import { redis } from './index';
import { CONFIG } from '../config';
import { getDomain } from '../utils/url';
import { logger } from '../utils/logger';

const DOMAIN_LAST_PREFIX = 'domain:last:';
const GLOBAL_RATE_KEY = 'global:rate';

let tokenBucket = {
  tokens: CONFIG.globalRps,
  lastRefill: Date.now(),
};

export async function checkGlobalRateLimit(): Promise<void> {
  if (CONFIG.globalRps <= 0) return;
  
  const now = Date.now();
  const elapsed = (now - tokenBucket.lastRefill) / 1000;
  tokenBucket.tokens = Math.min(CONFIG.globalRps, tokenBucket.tokens + elapsed * CONFIG.globalRps);
  tokenBucket.lastRefill = now;
  
  if (tokenBucket.tokens < 1) {
    const waitTime = 1000 / CONFIG.globalRps;
    logger.debug('Global rate limit waiting', { waitTime: Math.round(waitTime) });
    await new Promise(resolve => setTimeout(resolve, waitTime));
    return checkGlobalRateLimit();
  }
  
  tokenBucket.tokens--;
}

export async function checkDomainRateLimit(url: string): Promise<boolean> {
  if (CONFIG.domainDelayMs <= 0) return true;
  
  const domain = getDomain(url);
  if (!domain) return false;

  const key = `${DOMAIN_LAST_PREFIX}${domain}`;
  const lockKey = `${DOMAIN_LAST_PREFIX}lock:${domain}`;
  const now = Date.now();
  const delay = CONFIG.domainDelayMs;

  let lastRequest: string | null;
  let attempts = 0;
  const maxAttempts = 10;

  while (attempts < maxAttempts) {
    lastRequest = await redis.get(key);
    
    if (lastRequest) {
      const lastTime = parseInt(lastRequest, 10);
      const elapsed = now - lastTime;
      
      if (elapsed < delay) {
        const waitTime = delay - elapsed;
        logger.debug('Domain rate limit waiting', { domain, waitTime: Math.round(waitTime) });
        await new Promise(resolve => setTimeout(resolve, waitTime));
        attempts++;
        continue;
      }
    }

    const setResult = await redis.set(lockKey, now.toString(), 'EX', 5, 'NX');
    if (setResult === 'OK') {
      await redis.set(key, Date.now().toString(), 'EX', 10);
      await redis.del(lockKey);
      return true;
    }

    await new Promise(resolve => setTimeout(resolve, 10));
    attempts++;
  }

  return true;
}

export async function getLastRequestTime(domain: string): Promise<number | null> {
  const key = `${DOMAIN_LAST_PREFIX}${domain}`;
  const lastRequest = await redis.get(key);
  return lastRequest ? parseInt(lastRequest, 10) : null;
}