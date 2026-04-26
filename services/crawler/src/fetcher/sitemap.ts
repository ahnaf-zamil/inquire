import { CONFIG } from '../config';
import { logger } from '../utils/logger';
import { getDomain } from '../utils/url';

const COMMON_SITEMAP_PATHS = [
  '/sitemap.xml',
  '/sitemap-index.xml',
  '/sitemap-news.xml',
  '/sitemap-products.xml',
  '/sitemap-images.xml',
  '/sitemap-video.xml',
];

export async function discoverSitemaps(domain: string): Promise<string[]> {
  const sitemapUrls = new Set<string>();
  const baseUrl = `https://${domain}`;

  try {
    const robotsTxt = await fetchRobotsTxt(domain);
    if (robotsTxt) {
      const sitemapDirectives = parseSitemapFromRobots(robotsTxt);
      for (const url of sitemapDirectives) {
        if (isSameDomain(url, domain)) {
          sitemapUrls.add(url);
        }
      }
    }

    for (const path of COMMON_SITEMAP_PATHS) {
      sitemapUrls.add(`${baseUrl}${path}`);
    }
  } catch (error) {
    logger.warn('Error discovering sitemaps', { domain, error });
  }

  return Array.from(sitemapUrls);
}

export async function fetchSitemapUrls(domain: string): Promise<string[]> {
  if (!CONFIG.sitemapEnabled) {
    return [];
  }

  const visited = new Set<string>();
  const urls: string[] = [];
  const domainLower = domain.toLowerCase();

  const sitemapUrls = await discoverSitemaps(domain);

  const concurrencyLimit = CONFIG.sitemapMaxConcurrent;
  const queue = sitemapUrls.slice(0, concurrencyLimit);
  const pending = new Set(sitemapUrls.slice(concurrencyLimit));

  let depth = 0;
  const maxDepth = CONFIG.sitemapMaxDepth;
  const maxUrls = CONFIG.sitemapMaxUrlsPerDomain;

  while (queue.length > 0 && urls.length < maxUrls && depth < maxDepth) {
    const currentQueue = queue.splice(0);
    const results = await Promise.all(
      currentQueue.map(url => fetchAndParseSitemap(url, visited, depth, domainLower))
    );

    for (const result of results) {
      for (const url of result.urls) {
        if (urls.length >= maxUrls) break;
        urls.push(url);
      }

      for (const childUrl of result.childSitemaps) {
        if (!visited.has(childUrl) && urls.length < maxUrls && pending.size < 100) {
          pending.add(childUrl);
        }
      }
    }

    while (queue.length < concurrencyLimit && pending.size > 0 && urls.length < maxUrls) {
      const next = pending.values().next().value;
      if (next) {
        pending.delete(next);
        queue.push(next);
      } else {
        break;
      }
    }

    depth++;
  }

  logger.info('Sitemap discovery complete', { domain, urlCount: urls.length });
  return urls;
}

async function fetchAndParseSitemap(
  url: string,
  visited: Set<string>,
  depth: number,
  targetDomain: string
): Promise<{ urls: string[]; childSitemaps: string[] }> {
  if (visited.has(url) || depth >= CONFIG.sitemapMaxDepth) {
    return { urls: [], childSitemaps: [] };
  }
  visited.add(url);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONFIG.sitemapTimeout);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SearchEngineCrawler/1.0)',
      },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return { urls: [], childSitemaps: [] };
    }

    const text = await response.text();
    const parsedUrls = parseSitemapXml(text);

    const pageUrls: string[] = [];
    const childSitemaps: string[] = [];

    for (const parsedUrl of parsedUrls) {
      if (isSitemapIndex(parsedUrl)) {
        if (isSameDomain(parsedUrl, targetDomain)) {
          childSitemaps.push(parsedUrl);
        }
      } else if (isSameDomain(parsedUrl, targetDomain)) {
        pageUrls.push(parsedUrl);
      }
    }

    return { urls: pageUrls, childSitemaps };
  } catch (error) {
    return { urls: [], childSitemaps: [] };
  }
}

async function fetchRobotsTxt(domain: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONFIG.sitemapTimeout);

    const response = await fetch(`https://${domain}/robots.txt`, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SearchEngineCrawler/1.0)',
      },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return null;
    }

    return await response.text();
  } catch {
    return null;
  }
}

function parseSitemapFromRobots(robotsTxt: string): string[] {
  const urls: string[] = [];
  const lines = robotsTxt.split('\n');

  for (const line of lines) {
    const trimmed = line.trim().toLowerCase();
    if (trimmed.startsWith('sitemap:')) {
      const url = trimmed.substring('sitemap:'.length).trim();
      if (url && url.startsWith('http')) {
        urls.push(url);
      }
    }
  }

  return urls;
}

function parseSitemapXml(xml: string): string[] {
  const urls: string[] = [];

  const locRegex = /<loc>([^<]+)<\/loc>/gi;
  let match;
  while ((match = locRegex.exec(xml)) !== null) {
    const url = match[1].trim();
    if (url) {
      urls.push(url);
    }
  }

  if (urls.length === 0) {
    const urlsetRegex = /<urlset[^>]*>([\s\S]*)<\/urlset>/i;
    const urlsetMatch = urlsetRegex.exec(xml);
    if (urlsetMatch) {
      const locs = urlsetMatch[1].match(/<loc>[^<]+<\/loc>/gi) || [];
      for (const loc of locs) {
        const url = loc.replace(/<\/?loc>/gi, '').trim();
        if (url) {
          urls.push(url);
        }
      }
    }
  }

  return urls;
}

function isSitemapIndex(url: string): boolean {
  const lower = url.toLowerCase();
  return lower.includes('sitemap-index') || lower.includes('sitemap.xml');
}

function isSameDomain(url: string, domain: string): boolean {
  try {
    const urlDomain = getDomain(url);
    return urlDomain !== null && urlDomain.toLowerCase() === domain.toLowerCase();
  } catch {
    return false;
  }
}