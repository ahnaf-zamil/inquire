# Crawler v1.6 Implementation Plan

## Features

1. Robots.txt Compliance (Tier B)
2. Retry Queue with Exponential Backoff
3. Circuit Breaker (ES + Redis)
4. Dead Link Tracking

---

## 1. Robots.txt Compliance

### Overview
Fetch and honor robots.txt for each domain - respect crawl-delay and skip disallowed paths.

### Files

#### New: `src/fetcher/robots.ts`
```typescript
interface RobotsCache {
  rules: string[];
  crawlDelay: number;
  fetchedAt: number;
}

const robotsCache = new Map<string, RobotsCache>();
const ROBOTS_CACHE_TTL = parseInt(process.env.ROBOTS_CACHE_TTL || '3600000');

export async function fetchRobotsTxt(domain: string): Promise<string | null>

export function parseRobotsTxt(content: string): { rules: string[], crawlDelay: number }

export function isUrlAllowed(url: string, domain: string): boolean

export async function getCrawlDelay(domain: string): Promise<number>
```

### Integration
- Modify `src/workers/crawler.ts`:
  - Before processing URL, call `isUrlAllowed(url, domain)`
  - If disallowed, skip URL (don't fetch, don't add links)
  - Apply crawl-delay if present (max of configured `domainDelayMs`)

### Config (env)
```
ROBOTS_CACHE_TTL=3600000  # 1 hour in ms
```

---

## 2. Retry Queue

### Overview
Failed pages re-queued with exponential backoff (5m → 10m → 20m), max 3 retries.

### Redis Keys
- `retry:queue` - List of `{url, domain, attempt, enqueuedAt}`
- `retry:attempt:{urlHash}` - Integer counter

### Files

#### New: `src/queue/retry.ts`
```typescript
interface RetryJob {
  url: string;
  domain: string;
  attempt: number;
  enqueuedAt: number;
}

const RETRY_DELAYS = [5 * 60 * 1000, 10 * 60 * 1000, 20 * 60 * 1000]; // 5m, 10m, 20m
const MAX_RETRIES = 3;

export async function pushToRetryQueue(job: RetryJob): Promise<void>

export async function popFromRetryQueue(timeout: number): Promise<RetryJob | null>

export async function getRetryAttempt(url: string): Promise<number>

export async function incrementRetryAttempt(url: string): Promise<number>

export async function clearRetryAttempt(url: string): Promise<void>
```

#### New: `src/workers/retry-processor.ts`
```typescript
export async function startRetryProcessor(): Promise<void>

async function processRetries(): Promise<void>
```

### Integration
- Modify `src/workers/crawler.ts`:
  - On fetch error (not 404): call `pushToRetryQueue()`
  - Add retry-processor worker in `src/workers/index.ts`

### Config (env)
```
RETRY_DELAYS=300000,600000,1200000  # comma-separated ms
MAX_RETRIES=3
```

---

## 3. Circuit Breaker

### Overview
Simple failure counter per service (ES, Redis). Opens after 5 failures, resets after 30s.

### Files

#### New: `src/utils/circuit-breaker.ts`
```typescript
type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitBreaker {
  failures: number;
  lastFailure: number;
  state: CircuitState;
}

class CircuitBreakerManager {
  private breakers = new Map<string, CircuitBreaker>();
  private config = {
    failureThreshold: 5,
    resetTimeout: 30000,
  };

  recordSuccess(service: string): void
  recordFailure(service: string): void
  isAvailable(service: string): boolean
}
```

### Usage
```typescript
const esBreaker = CircuitBreakerManager.get('elasticsearch');
const redisBreaker = CircuitBreakerManager.get('redis');

async function safeEsCall<T>(fn: () => Promise<T>): Promise<T> {
  if (!esBreaker.isAvailable()) throw new Error('ES circuit open');
  try {
    const result = await fn();
    esBreaker.recordSuccess();
    return result;
  } catch (e) {
    esBreaker.recordFailure();
    throw e;
  }
}
```

### Integration
- Wrap ES calls in `src/indexer/operations.ts`
- Wrap Redis calls in critical paths (queue operations)

### Config (env)
```
CIRCUIT_FAILURE_THRESHOLD=5
CIRCUIT_RESET_TIMEOUT=30000
```

---

## 4. Dead Link Tracking

### Overview
On 404/410/503, remove URL from `indexed:urls` set so it can be re-crawled later.

### Integration

#### Modify: `src/workers/crawler.ts`
```typescript
async function handleFetchError(url: string, error: Error, isRetry: boolean): Promise<void> {
  if (is404Or410(error) || is503(error)) {
    await removeFromIndexed(url);
    logger.warn('Dead link removed', { url, error: error.message });
    return;
  }

  // Non-retryable error → retry queue
  if (!isRetry) {
    await pushToRetryQueue({ url, domain, attempt: 0, enqueuedAt: Date.now() });
  }
}
```

---

## File Changes Summary

| File | Action |
|------|--------|
| `src/fetcher/robots.ts` | NEW |
| `src/queue/retry.ts` | NEW |
| `src/workers/retry-processor.ts` | NEW |
| `src/utils/circuit-breaker.ts` | NEW |
| `src/workers/crawler.ts` | MODIFY - robots check, dead link handling, retry push |
| `src/workers/index.ts` | MODIFY - add retry processor worker |
| `src/indexer/operations.ts` | MODIFY - wrap with circuit breaker |
| `src/config.ts` | MODIFY - add configs |

---

## Implementation Order

1. Config additions (env vars)
2. Circuit breaker (depends on nothing)
3. Robots.txt (depends on config)
4. Retry queue + processor (depends on config)
5. Dead link tracking (depends on crawler)
6. Integration + testing