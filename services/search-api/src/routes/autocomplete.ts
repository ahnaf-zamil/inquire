import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { esClient, ES_INDEX } from '../lib/elastic'
import type { AutocompleteQuery, Suggestion, CrawledPage } from '../lib/types'

export async function autocompleteRoutes(fastify: FastifyInstance) {
  fastify.get<{ Querystring: AutocompleteQuery }>('/autocomplete', async (req: FastifyRequest<{ Querystring: AutocompleteQuery }>, reply: FastifyReply) => {
    const { q, limit = 5 } = req.query

    if (!q) {
      return reply.status(400).send({ error: 'Query parameter "q" is required' })
    }

    try {
      const response = await esClient.search({
        index: ES_INDEX,
        query: {
          match_phrase_prefix: {
            title_autocomplete: {
              query: q,
              max_expansions: 50,
            },
          },
        },
        size: limit,
        _source: ['url', 'title'],
      })

      const suggestions: Suggestion[] = response.hits.hits.map(hit => {
        const source = hit._source as Pick<CrawledPage, 'url' | 'title'>
        return {
          text: source.title,
          url: source.url,
        }
      })

      return { suggestions }
    } catch (error) {
      console.error('Autocomplete error:', error)
      return reply.status(500).send({ error: 'Autocomplete failed' })
    }
  })
}