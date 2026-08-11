import { Client } from '@elastic/elasticsearch'
import { HttpConnection } from '@elastic/transport/lib/connection'

export const esClient = new Client({
  node: process.env.ES_HOST || 'http://localhost:9200',
  Connection: HttpConnection,
})

export const ES_INDEX = process.env.ES_INDEX || 'crawled_pages'