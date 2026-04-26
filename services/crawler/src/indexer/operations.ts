import { esClient } from './index';
import { CONFIG } from '../config';
import { PageDocument } from '../types';
import { logger } from '../utils/logger';

export async function indexPage(document: PageDocument): Promise<void> {
  const now = Date.now();

  await esClient.update({
    index: CONFIG.esIndex,
    id: document.url,
    doc: {
      ...document,
      firstIndexed: document.firstIndexed || now,
      lastIndexed: now,
      updatedAt: now,
    },
    doc_as_upsert: true,
  });
}

export async function deletePage(url: string): Promise<void> {
  try {
    await esClient.delete({
      index: CONFIG.esIndex,
      id: url,
    });
  } catch (error) {
    logger.warn('Failed to delete page', { url, error });
  }
}

export async function getPage(url: string): Promise<PageDocument | null> {
  try {
    const result = await esClient.get<PageDocument>({
      index: CONFIG.esIndex,
      id: url,
    });
    return result._source || null;
  } catch {
    return null;
  }
}

export async function getPagesOlderThan(hours: number, size = 10000): Promise<string[]> {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  const result = await esClient.search<{ url: string }>({
    index: CONFIG.esIndex,
    query: {
      range: {
        lastIndexed: {
          lte: cutoff,
        },
      },
    },
    _source: ['url'],
    size,
  });

  const urls: string[] = [];
  for (const hit of result.hits.hits) {
    if (hit._source?.url) {
      urls.push(hit._source.url);
    }
  }
  return urls;
}

export async function getTotalPages(): Promise<number> {
  const result = await esClient.count({
    index: CONFIG.esIndex,
  });
  return result.count;
}

export async function touchPage(url: string): Promise<void> {
  const now = Date.now();
  await esClient.update({
    index: CONFIG.esIndex,
    id: url,
    doc: {
      lastIndexed: now,
      updatedAt: now,
    },
  });
}