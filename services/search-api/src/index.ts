import Fastify from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import { config } from 'dotenv'
import { searchRoutes } from './routes/search'
import { autocompleteRoutes } from './routes/autocomplete'

config()

const fastify = Fastify({ logger: true })

const PORT = parseInt(process.env.PORT || '3001')

const start = async () => {
  try {
    await fastify.register(cors, { origin: true })

    await fastify.register(rateLimit, {
      max: parseInt(process.env.RATE_LIMIT_MAX || '100'),
      timeWindow: process.env.RATE_LIMIT_WINDOW || '1 minute',
      errorResponseBuilder: (_req, context) => ({
        statusCode: 429,
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Retry in ${context.after}`,
      }),
    })

    fastify.get('/health', async () => ({ status: 'ok' }))

    fastify.register(searchRoutes)
    fastify.register(autocompleteRoutes)

    await fastify.listen({ port: PORT, host: '0.0.0.0' })
    console.log(`Search API running on http://0.0.0.0:${PORT}`)
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

start()