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
      const primaryResponse = await esClient.search({
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

      const suggestions: Suggestion[] = primaryResponse.hits.hits.map(hit => {
        const source = hit._source as Pick<CrawledPage, 'url' | 'title'>
        return {
          text: source.title,
          url: source.url,
        }
      })

      const shouldFallback = q.length >= 5 ? suggestions.length < 3 : suggestions.length < limit

      if (shouldFallback) {
        const fallbackResponse = await esClient.search({
          index: ES_INDEX,
          query: {
            match_bool_prefix: {
              all_text: {
                query: q,
                minimum_should_match: '50%',
              },
            },
          },
          size: limit - suggestions.length,
          _source: ['url', 'title'],
        })

        const existingUrls = new Set(suggestions.map(s => s.url))
        for (const hit of fallbackResponse.hits.hits) {
          const source = hit._source as Pick<CrawledPage, 'url' | 'title'>
          if (!existingUrls.has(source.url)) {
            suggestions.push({ text: source.title, url: source.url })
          }
        }
      }

      return { suggestions }
    } catch (error) {
      console.error('Autocomplete error:', error)
      return reply.status(500).send({ error: 'Autocomplete failed' })
    }
  })
}