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
          refresh_interval: '1s',
          analysis: {
            analyzer: {
              search_analyzer: {
                type: 'custom',
                tokenizer: 'standard',
                filter: ['lowercase', 'stemmer', 'stop']
              },
              autocomplete: {
                type: 'custom',
                tokenizer: 'edge_ngram_tokenizer',
                filter: ['lowercase']
              }
            },
            tokenizer: {
              edge_ngram_tokenizer: {
                type: 'edge_ngram',
                min_gram: 2,
                max_gram: 10,
                token_chars: ['letter', 'digit']
              }
            },
            filter: {
              stemmer: {
                type: 'stemmer',
                language: 'english'
              }
            }
          }
        },
        mappings: {
          properties: {
            url: { type: 'keyword' },
            domain: { type: 'keyword' },

            all_text: {
              type: 'text',
              analyzer: 'standard',
              search_analyzer: 'search_analyzer'
            },

            title: {
              type: 'text',
              analyzer: 'search_analyzer',
              copy_to: 'all_text',
              fields: { keyword: { type: 'keyword' } }
            },

            title_autocomplete: {
              type: 'text',
              analyzer: 'autocomplete'
            },

            content: {
              properties: {
                h1: { type: 'text', analyzer: 'search_analyzer', copy_to: 'all_text' },
                h2: { type: 'text', analyzer: 'search_analyzer', copy_to: 'all_text' },
                h3: { type: 'text', analyzer: 'search_analyzer', copy_to: 'all_text' },
                h4: { type: 'text', analyzer: 'search_analyzer', copy_to: 'all_text' },
                h5: { type: 'text', analyzer: 'search_analyzer', copy_to: 'all_text' },
                h6: { type: 'text', analyzer: 'search_analyzer', copy_to: 'all_text' },
                paragraphs: { type: 'text', analyzer: 'search_analyzer', copy_to: 'all_text' },
                fullText: { type: 'text', analyzer: 'search_analyzer', copy_to: 'all_text' }
              }
            },

            metaDescription: { type: 'text', analyzer: 'search_analyzer', copy_to: 'all_text' },
            metaKeywords: { type: 'keyword' },
            ogTitle: { type: 'text', analyzer: 'search_analyzer', copy_to: 'all_text' },
            ogDescription: { type: 'text', analyzer: 'search_analyzer', copy_to: 'all_text' },
            ogImage: { type: 'keyword' },

            depth: { type: 'integer' },
            contentType: { type: 'keyword' },
            wordCount: { type: 'integer' },
            language: { type: 'keyword' },

            firstIndexed: { type: 'date' },
            lastIndexed: { type: 'date' },
            updatedAt: { type: 'date' },

            contentHash: { type: 'keyword' }
          }
        }
      }
    });
    logger.info('Created Elasticsearch index', { index: CONFIG.esIndex });
  }
}

export * from './operations';