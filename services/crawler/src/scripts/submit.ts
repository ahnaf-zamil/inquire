import { config } from 'dotenv';
import Redis from 'ioredis';
import { normalizeUrl, isSafeUrl, getDomain } from '../utils/url';

config();

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
});

const CRAWL_QUEUE_KEY = 'crawl:queue';

interface CrawlJob {
  url: string;
  depth: number;
  source: 'seed' | 'link' | 'reindex' | 'manual';
  enqueuedAt: number;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: bun run submit <url> [--depth N]');
    console.log('  <url>       URL to submit (required)');
    console.log('  --depth N   Crawl depth (default: 0)');
    process.exit(1);
  }

  let url = '';
  let depth = 0;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--depth') {
      depth = parseInt(args[++i], 10) || 0;
    } else if (!url) {
      url = args[i];
    }
  }

  const normalized = normalizeUrl(url);
  if (!normalized) {
    console.error(`Invalid URL: ${url}`);
    process.exit(1);
  }

  if (!isSafeUrl(normalized)) {
    console.error(`Unsafe URL rejected: ${normalized}`);
    process.exit(1);
  }

  const domain = getDomain(normalized);
  if (!domain) {
    console.error(`Could not extract domain from: ${normalized}`);
    process.exit(1);
  }

  const job: CrawlJob = {
    url: normalized,
    depth,
    source: 'manual',
    enqueuedAt: Date.now(),
  };

  await redis.lpush(CRAWL_QUEUE_KEY, JSON.stringify(job));

  console.log(`Submitted to front of crawl queue:`);
  console.log(`  URL:   ${normalized}`);
  console.log(`  Depth: ${depth}`);
  console.log(`  Domain: ${domain}`);

  redis.disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});