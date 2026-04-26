import dotenv from 'dotenv';

dotenv.config();

function parsePositiveInt(value: string | undefined, defaultVal: number, name: string): number {
  const parsed = parseInt(value || String(defaultVal), 10);
  if (isNaN(parsed) || parsed < 0) {
    console.warn(`Invalid config for ${name}, using default`, { value, default: defaultVal });
    return defaultVal;
  }
  return parsed;
}

function parseNonEmptyString(value: string | undefined, defaultVal: string, name: string): string {
  if (!value || value.trim() === '') {
    return defaultVal;
  }
  return value.trim();
}

export const CONFIG = {
  maxIndexedUrls: 5_000_000,
  maxQueueSize: 50_000,
  maxDepth: 5,

  crawlerWorkers: parsePositiveInt(process.env.CRAWLER_WORKERS, 5, 'CRAWLER_WORKERS'),
  playwrightWorkers: parsePositiveInt(process.env.PLAYWRIGHT_WORKERS, 2, 'PLAYWRIGHT_WORKERS'),
  playwrightConcurrentPages: parsePositiveInt(process.env.PLAYWRIGHT_CONCURRENT_PAGES, 2, 'PLAYWRIGHT_CONCURRENT_PAGES'),

  domainDelayMs: parsePositiveInt(process.env.DOMAIN_DELAY_MS, 200, 'DOMAIN_DELAY_MS'),
  globalRps: parsePositiveInt(process.env.GLOBAL_RPS, 10, 'GLOBAL_RPS'),

  httpFetchTimeout: parsePositiveInt(process.env.HTTP_FETCH_TIMEOUT, 30000, 'HTTP_FETCH_TIMEOUT'),
  playwrightTimeout: parsePositiveInt(process.env.PLAYWRIGHT_TIMEOUT, 30000, 'PLAYWRIGHT_TIMEOUT'),
  playwrightNetworkidleTimeout: parsePositiveInt(process.env.PLAYWRIGHT_NETWORKIDLE_TIMEOUT, 5000, 'PLAYWRIGHT_NETWORKIDLE_TIMEOUT'),
  playwrightBufferMs: parsePositiveInt(process.env.PLAYWRIGHT_BUFFER_MS, 3000, 'PLAYWRIGHT_BUFFER_MS'),
  queueTimeout: parsePositiveInt(process.env.QUEUE_TIMEOUT, 5000, 'QUEUE_TIMEOUT'),
  workerTimeout: parsePositiveInt(process.env.WORKER_TIMEOUT, 120000, 'WORKER_TIMEOUT'),

  maxContentSize: 5 * 1024 * 1024,
  maxLinksPerPage: 50,
  minContentWords: 50,

  memoryLimitBytes: 1.5 * 1024 * 1024 * 1024,
  memoryCheckInterval: 60_000,

  reindexAfterHours: 24,
  reindexBatchSize: 10_000,

  esIndex: parseNonEmptyString(process.env.ES_INDEX, 'pages', 'ES_INDEX'),
  esHost: parseNonEmptyString(process.env.ES_HOST, 'http://localhost:9200', 'ES_HOST'),

  redisHost: parseNonEmptyString(process.env.REDIS_HOST, 'localhost', 'REDIS_HOST'),
  redisPort: parsePositiveInt(process.env.REDIS_PORT, 6379, 'REDIS_PORT'),

  logLevel: parseNonEmptyString(process.env.LOG_LEVEL, 'info', 'LOG_LEVEL'),
  logFile: process.env.LOG_FILE,
  
  playwrightHeadless: process.env.PLAYWRIGHT_HEADLESS !== 'false',
  playwrightProxy: process.env.PLAYWRIGHT_PROXY,
};