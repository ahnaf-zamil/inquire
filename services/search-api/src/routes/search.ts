import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { esClient, ES_INDEX } from '../lib/elastic'
import type { SearchQuery, SearchResult, SearchResultHit, CrawledPage } from '../lib/types'
import { getCached, setCache, cacheKey } from '../lib/cache'
import type { Sort } from '@elastic/elasticsearch/lib/api/types'

export async function searchRoutes(fastify: FastifyInstance) {
  fastify.get<{ Querystring: SearchQuery }>('/search', async (req: FastifyRequest<{ Querystring: SearchQuery }>, reply: FastifyReply) => {
    const { q, page = 1, limit = 10, domain, language, contentType, sort = 'relevance', order = 'desc', cursor } = req.query

    if (!q) {
      return reply.status(400).send({ error: 'Query parameter "q" is required' })
    }

    const cKey = cursor ? '' : cacheKey(q, page, limit, { domain, language, contentType, sort, order })
    if (!cursor && cKey) {
      const cached = await getCached(cKey)
      if (cached) {
        return JSON.parse(cached)
      }
    }

    const isPhrase = q.match(/"([^"]+)"/)
    const phraseQuery = isPhrase ? isPhrase[1] : null

    const must: Record<string, unknown>[] = [
      {
        multi_match: {
          query: q,
          fields: ['title^10', 'all_text', 'metaDescription^3', 'ogTitle^5'],
          fuzziness: 'AUTO',
          prefix_length: 2,
          analyzer: 'search_analyzer',
          minimum_should_match: '2<75%',
        },
      },
    ]

    if (phraseQuery) {
      must.push({
        match_phrase: {
          title: { query: phraseQuery, boost: 5 },
        },
      })
      must.push({
        match_phrase: {
          all_text: { query: phraseQuery, boost: 3 },
        },
      })
    }

    const filter: Record<string, unknown>[] = []
    if (domain) filter.push({ term: { domain } })
    if (language) filter.push({ term: { language } })
    if (contentType) filter.push({ term: { contentType } })

    const from = cursor ? undefined : (page - 1) * limit
    const searchAfter = cursor ? JSON.parse(cursor) : undefined

    const sortOption: Sort = sort === 'date'
      ? [{ lastIndexed: { order: order === 'asc' ? 'asc' as const : 'desc' as const } }, { _id: { order: 'asc' as const } }]
      : [{ _score: { order: 'desc' as const } }, { _id: { order: 'asc' as const } }]

    try {
      const response = await esClient.search({
        index: ES_INDEX,
        query: {
          bool: {
            must,
            filter: filter.length > 0 ? filter : undefined,
          },
        },
        highlight: {
          fields: {
            'all_text.highlight': { fragment_size: 150, number_of_fragments: 3 },
          },
          pre_tags: ['<em>'],
          post_tags: ['</em>'],
        },
        from,
        search_after: searchAfter,
        size: cursor ? limit + 1 : limit,
        sort: sortOption,
      })

      const total = typeof response.hits.total === 'number'
        ? response.hits.total
        : response.hits.total?.value ?? 0
      const totalPages = Math.ceil(total / limit)

      let hits = response.hits.hits
      let nextCursor: string | null = null

      if (cursor) {
        const hasMore = hits.length > limit
        if (hasMore) {
          hits = hits.slice(0, limit)
        }
        nextCursor = hasMore && hits.length > 0 ? JSON.stringify(hits[hits.length - 1].sort) : null
      } else {
        const hasMore = page * limit < total
        nextCursor = hasMore && hits.length > 0 ? JSON.stringify(hits[hits.length - 1].sort) : null
      }

      const results: SearchResultHit[] = hits.map(hit => {
        const source = hit._source as CrawledPage
        const highlights = hit.highlight
        return {
          url: source.url,
          title: source.title,
          domain: source.domain,
          description: highlights?.['all_text.highlight']?.join('...')
            || source.metaDescription
            || source.ogDescription
            || '',
          highlights: highlights?.['all_text.highlight'] || [],
          contentType: source.contentType,
          wordCount: source.wordCount,
          lastIndexed: source.lastIndexed,
        }
      })

      const result: SearchResult = {
        results,
        total,
        page: cursor ? 1 : page,
        totalPages: cursor ? 0 : totalPages,
        nextCursor,
      }

      await setCache(cKey, JSON.stringify(result))
      return result
    } catch (error) {
      console.error('Search error:', error)
      return reply.status(500).send({ error: 'Search failed' })
    }
  })
}