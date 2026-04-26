import { Client } from '@elastic/elasticsearch';
import Redis from 'ioredis';
import { config } from 'dotenv';
import readline from 'readline';

config();

const esClient = new Client({
  node: process.env.ES_HOST || 'http://localhost:9200',
});

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
});

const ES_INDEX = process.env.ES_INDEX || 'crawled_pages';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function ask(question: string): Promise<string> {
  return new Promise(resolve => rl.question(question, resolve));
}

async function main() {
  console.log('\n⚠️  WARNING: This will DELETE all indexed pages and clear all queues!\n');

  const answer = await ask('Type "RESET" to confirm: ');
  
  if (answer.trim() !== 'RESET') {
    console.log('\n❌ Cancelled.\n');
    rl.close();
    return;
  }

  console.log('\n🧹 Clearing Redis queues...');
  await redis.del('crawl:queue');
  await redis.del('playwright:queue');
  await redis.del('indexed:urls');
  await redis.del('domain:lastRequest');
  await redis.del('crawl:semaphore');
  await redis.del('seed:loaded:seeds.txt');

  console.log('🗑️  Deleting ES index...');
  try {
    await esClient.indices.delete({ index: ES_INDEX });
  } catch (e: any) {
    if (e.meta?.statusCode === 404) {
      console.log('   Index did not exist, skipping.');
    } else {
      throw e;
    }
  }

  console.log('📦 Recreating ES index...');
  await esClient.indices.create({
    index: ES_INDEX,
    body: {
      settings: {
        number_of_shards: 1,
        number_of_replicas: 0,
        refresh_interval: '5s',
      },
      mappings: {
        properties: {
          url: { type: 'keyword' },
          domain: { type: 'keyword' },
          title: { type: 'text', analyzer: 'standard', fields: { keyword: { type: 'keyword' } } },
          content: {
            properties: {
              h1: { type: 'text', analyzer: 'standard' },
              h2: { type: 'text', analyzer: 'standard' },
              h3: { type: 'text', analyzer: 'standard' },
              h4: { type: 'text', analyzer: 'standard' },
              h5: { type: 'text', analyzer: 'standard' },
              h6: { type: 'text', analyzer: 'standard' },
              paragraphs: { type: 'text', analyzer: 'standard' },
              fullText: { type: 'text', analyzer: 'standard' },
            },
          },
          metaDescription: { type: 'text' },
          metaKeywords: { type: 'keyword' },
          ogTitle: { type: 'text' },
          ogDescription: { type: 'text' },
          ogImage: { type: 'keyword' },
          depth: { type: 'integer' },
          contentType: { type: 'keyword' },
          wordCount: { type: 'integer' },
          language: { type: 'keyword' },
          firstIndexed: { type: 'date' },
          lastIndexed: { type: 'date' },
          updatedAt: { type: 'date' },
          contentHash: { type: 'keyword' },
        },
      },
    },
  });

  console.log('\n✅ Reset complete!\n');
  rl.close();
  redis.disconnect();
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('\n❌ Error:', err.message);
    rl.close();
    redis.disconnect();
    process.exit(1);
  });