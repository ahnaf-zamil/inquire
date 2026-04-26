import { Client } from '@elastic/elasticsearch';
import Redis from 'ioredis';
import { config } from 'dotenv';

config();

const esClient = new Client({
  node: process.env.ES_HOST || 'http://localhost:9200',
});

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
});

const ES_INDEX = process.env.ES_INDEX || 'crawled_pages';

async function getIndexedCount(): Promise<number> {
  try {
    const result = await esClient.count({ index: ES_INDEX });
    return result.count;
  } catch {
    return 0;
  }
}

async function getQueueStats() {
  const crawlQueue = await redis.llen('crawl:queue');
  const playwrightQueue = await redis.llen('playwright:queue');
  const indexedUrls = await redis.zcard('indexed:urls');
  return { crawlQueue, playwrightQueue, indexedUrls };
}

async function getDomainStats() {
  const result = await esClient.search({
    index: ES_INDEX,
    size: 0,
    aggs: {
      domains: {
        terms: { field: 'domain', size: 20 }
      }
    }
  });

  const buckets = (result.aggregations?.domains as any)?.buckets || [];
  return buckets.map((b: any) => ({ domain: b.key, count: b.doc_count }));
}

async function getRecentPages(limit = 10) {
  const result = await esClient.search({
    index: ES_INDEX,
    size: limit,
    sort: [{ lastIndexed: 'desc' }],
    _source: ['url', 'domain', 'title', 'wordCount', 'lastIndexed', 'contentType']
  });

  return result.hits.hits.map((hit: any) => ({
    url: hit._source?.url,
    domain: hit._source?.domain,
    title: hit._source?.title,
    wordCount: hit._source?.wordCount,
    contentType: hit._source?.contentType,
    lastIndexed: new Date(hit._source?.lastIndexed).toISOString()
  }));
}

async function getCrawlSpeed() {
  const result = await esClient.search({
    index: ES_INDEX,
    size: 1000,
    sort: [{ lastIndexed: 'asc' }],
    _source: ['lastIndexed']
  });

  const hits = result.hits.hits as any[];
  if (hits.length < 2) {
    return { pagesPerMinute: 0, pagesPerHour: 0, totalPages: hits.length };
  }

  const firstTime = hits[0]._source?.lastIndexed;
  const lastTime = hits[hits.length - 1]._source?.lastIndexed;

  if (!firstTime || !lastTime) {
    return { pagesPerMinute: 0, pagesPerHour: 0, totalPages: hits.length };
  }

  const timeDiffMs = lastTime - firstTime;
  const timeDiffMinutes = timeDiffMs / (1000 * 60);
  const timeDiffHours = timeDiffMs / (1000 * 60 * 60);

  const pagesPerMinute = timeDiffMinutes > 0 ? hits.length / timeDiffMinutes : 0;
  const pagesPerHour = timeDiffHours > 0 ? hits.length / timeDiffHours : 0;

  return {
    pagesPerMinute: Math.round(pagesPerMinute * 100) / 100,
    pagesPerHour: Math.round(pagesPerHour * 100) / 100,
    totalPages: hits.length,
    timeRangeMinutes: Math.round(timeDiffMinutes)
  };
}

async function getContentTypeStats() {
  const result = await esClient.search({
    index: ES_INDEX,
    size: 0,
    aggs: {
      contentTypes: {
        terms: { field: 'contentType' }
      }
    }
  });

  const buckets = (result.aggregations?.contentTypes as any)?.buckets || [];
  return buckets.map((b: any) => ({ type: b.key, count: b.doc_count }));
}

async function getIndexSize() {
  try {
    const result = await esClient.indices.stats({ index: ES_INDEX });
    const stats = result.indices?.[ES_INDEX]?.total as any;
    const sizeBytes = stats?.store?.size_in_bytes || 0;
    
    const mb = sizeBytes / (1024 * 1024);
    const gb = mb / 1024;
    
    return {
      bytes: sizeBytes,
      mb: Math.round(mb * 100) / 100,
      gb: Math.round(gb * 100) / 100,
      docs: stats?.doc_count || 0
    };
  } catch {
    return { bytes: 0, mb: 0, gb: 0, docs: 0 };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'all';

  console.log('\n=== Crawler Statistics ===\n');

  if (command === 'all' || command === 'indexed') {
    const count = await getIndexedCount();
    console.log(`📄 Pages Indexed: ${count.toLocaleString()}`);
  }

  if (command === 'all' || command === 'queues') {
    const queues = await getQueueStats();
    console.log(`\n📭 Queues:`);
    console.log(`   Crawl Queue: ${queues.crawlQueue.toLocaleString()}`);
    console.log(`   Playwright Queue: ${queues.playwrightQueue.toLocaleString()}`);
    console.log(`   Indexed URLs (tracked): ${queues.indexedUrls.toLocaleString()}`);
  }

  if (command === 'all' || command === 'domains') {
    const domains = await getDomainStats();
    console.log(`\n🌐 Top Domains:`);
    domains.forEach((d: { domain: string; count: number }, i: number) => {
      console.log(`   ${i + 1}. ${d.domain}: ${d.count.toLocaleString()}`);
    });
  }

  if (command === 'all' || command === 'recent') {
    const recent = await getRecentPages(10);
    console.log(`\n🆕 Recent Pages:`);
    recent.forEach((p: { url?: string; title?: string; wordCount?: number; contentType?: string }, i: number) => {
      console.log(`   ${i + 1}. ${p.title?.substring(0, 50) || p.url?.substring(0, 50)}`);
      console.log(`      ${p.url?.substring(0, 60)}...`);
      console.log(`      Words: ${p.wordCount} | Type: ${p.contentType}`);
    });
  }

  if (command === 'all' || command === 'speed') {
    const speed = await getCrawlSpeed();
    console.log(`\n⚡ Crawl Speed:`);
    console.log(`   Pages/Minute: ${speed.pagesPerMinute}`);
    console.log(`   Pages/Hour: ${speed.pagesPerHour}`);
    console.log(`   Total Pages: ${speed.totalPages}`);
    console.log(`   Time Range: ${speed.timeRangeMinutes} minutes`);
  }

  if (command === 'all' || command === 'content-type') {
    const contentTypes = await getContentTypeStats();
    console.log(`\n📝 Content Types:`);
    contentTypes.forEach((ct: { type: string; count: number }) => {
      console.log(`   ${ct.type}: ${ct.count.toLocaleString()}`);
    });
  }

  if (command === 'all' || command === 'size') {
    const size = await getIndexSize();
    console.log(`\n💾 Index Size:`);
    console.log(`   ${size.mb} MB (${size.gb} GB)`);
    console.log(`   Documents: ${size.docs.toLocaleString()}`);
  }

  console.log('\n');
}

main()
  .then(() => {
    redis.disconnect();
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    redis.disconnect();
    process.exit(1);
  });