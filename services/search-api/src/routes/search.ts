import { Client } from '@elastic/elasticsearch';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { preprocessQuery, buildExpandedQuery } from '../preprocessor';

const esClient = new Client({
  node: process.env.ES_HOST || 'http://localhost:9200',
});

const ES_INDEX = process.env.ES_INDEX || 'crawled_pages';

interface SearchQuery {
  q: string;
  page?: number;
  limit?: number;
  domain?: string;
  language?: string;
  contentType?: string;
  sort?: string;
  order?: string;
}

interface SearchResult {
  results: Array<{
    url: string;
    title: string;
    domain: string;
    description: string;
    highlights: string[];
    contentType: string;
    wordCount: number;
    lastIndexed: string;
  }>;
  total: number;
  page: number;
  totalPages: number;
}

export async function searchRoutes(fastify: FastifyInstance) {
  fastify.get<{ Querystring: SearchQuery }>('/search', async (req: FastifyRequest<{ Querystring: SearchQuery }>, reply: FastifyReply) => {
    const { q, page = 1, limit = 10, domain, language, contentType, sort = 'relevance', order = 'desc' } = req.query;

    if (!q) {
      return reply.status(400).send({ error: 'Query parameter "q" is required' });
    }

    const expanded = preprocessQuery(q);
    const expandedQuery = buildExpandedQuery(q, expanded);
    const isPhrase = q.match(/"([^"]+)"/);
    const phraseQuery = isPhrase ? isPhrase[1] : null;

    const must: any[] = [
      {
        multi_match: {
          query: expandedQuery,
          fields: ['title^10', 'all_text', 'metaDescription^3', 'ogTitle^5'],
          fuzziness: 'AUTO',
          prefix_length: 2,
          analyzer: 'search_analyzer',
          minimum_should_match: '2<75%'
        }
      }
    ];

    if (phraseQuery) {
      must.push({
        match_phrase: {
          title: { query: phraseQuery, boost: 5 }
        }
      });
      must.push({
        match_phrase: {
          all_text: { query: phraseQuery, boost: 3 }
        }
      });
    }

    const filter = [];
    if (domain) filter.push({ term: { domain } });
    if (language) filter.push({ term: { language } });
    if (contentType) filter.push({ term: { contentType } });

    const from = (page - 1) * limit;

    let sortOption: any;
    if (sort === 'date') {
      sortOption = [{ lastIndexed: { order: order === 'asc' ? 'asc' : 'desc' } }];
    } else {
      sortOption = [{ _score: 'desc' }];
    }

    try {
      const response = await esClient.search({
        index: ES_INDEX,
        query: {
          bool: {
            must,
            filter: filter.length > 0 ? filter : undefined
          }
        },
        highlight: {
          fields: {
            'all_text.highlight': { fragment_size: 150, number_of_fragments: 3 }
          },
          pre_tags: ['<em>'],
          post_tags: ['</em>']
        },
        from,
        size: limit,
        sort: sortOption
      });

      const total = typeof response.hits.total === 'number' ? response.hits.total : response.hits.total?.value || 0;
      const totalPages = Math.ceil(total / limit);

      const results = response.hits.hits.map(hit => {
        const source = hit._source as any;
        const highlights = hit.highlight;
        return {
          url: source.url,
          title: source.title,
          domain: source.domain,
          description: highlights?.['all_text.highlight']?.join('...') || source.metaDescription || source.ogDescription || source.content?.fullText?.substring(0, 200) || '',
          highlights: highlights?.['all_text.highlight'] || [],
          contentType: source.contentType,
          wordCount: source.wordCount,
          lastIndexed: source.lastIndexed
        };
      });

      const result: SearchResult = {
        results,
        total,
        page,
        totalPages
      };

      return result;
    } catch (error) {
      console.error('Search error:', error);
      return reply.status(500).send({ error: 'Search failed' });
    }
  });
}