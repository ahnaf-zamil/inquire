import { Client } from '@elastic/elasticsearch';
import { CONFIG } from '../config';
import { logger } from '../utils/logger';

export const esClient = new Client({
  node: CONFIG.esHost,
  maxRetries: 3,
  requestTimeout: CONFIG.httpFetchTimeout,
  sniffOnStart: false,
  sniffOnConnectionFault: true,
});

export async function checkEsHealth(): Promise<boolean> {
  try {
    await esClient.cluster.health({ timeout: '5s' });
    return true;
  } catch (error) {
    logger.error('Elasticsearch health check failed', { error });
    return false;
  }
}

export async function ensureIndex(): Promise<void> {
  const indexExists = await esClient.indices.exists({ index: CONFIG.esIndex });

  if (!indexExists) {
    await esClient.indices.create({
      index: CONFIG.esIndex,
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
            title: {
              type: 'text',
              analyzer: 'standard',
              fields: { keyword: { type: 'keyword' } },
            },
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
    logger.info('Created Elasticsearch index', { index: CONFIG.esIndex });
  }
}

export * from './operations';