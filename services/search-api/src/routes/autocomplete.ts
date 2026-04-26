import { Client } from '@elastic/elasticsearch';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

const esClient = new Client({
  node: process.env.ES_HOST || 'http://localhost:9200',
});

const ES_INDEX = process.env.ES_INDEX || 'crawled_pages';

interface AutocompleteQuery {
  q: string;
  limit?: number;
}

interface Suggestion {
  text: string;
  url: string;
}

export async function autocompleteRoutes(fastify: FastifyInstance) {
  fastify.get<{ Querystring: AutocompleteQuery }>('/autocomplete', async (req: FastifyRequest<{ Querystring: AutocompleteQuery }>, reply: FastifyReply) => {
    const { q, limit = 5 } = req.query;

    if (!q) {
      return reply.status(400).send({ error: 'Query parameter "q" is required' });
    }

    try {
      const response = await esClient.search({
        index: ES_INDEX,
        query: {
          match_phrase_prefix: {
            title_autocomplete: {
              query: q,
              max_expansions: 50
            }
          }
        },
        size: limit,
        _source: ['url', 'title']
      });

      const suggestions: Suggestion[] = response.hits.hits.map(hit => {
        const source = hit._source as any;
        return {
          text: source.title,
          url: source.url
        };
      });

      return { suggestions };
    } catch (error) {
      console.error('Autocomplete error:', error);
      return reply.status(500).send({ error: 'Autocomplete failed' });
    }
  });
}