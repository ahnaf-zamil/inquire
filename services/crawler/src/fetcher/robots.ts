import { CONFIG } from '../config';
import { getDomain } from '../utils/url';

interface RobotsCache {
  rules: string[];
  crawlDelay: number;
  fetchedAt: number;
}

const robotsCache = new Map<string, RobotsCache>();

export async function fetchRobotsTxt(domain: string): Promise<string | null> {
  const cached = robotsCache.get(domain);
  if (cached && Date.now() - cached.fetchedAt < CONFIG.robotsCacheTtl) {
    return null;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

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

    const text = await response.text();

    const parsed = parseRobotsTxt(text);
    robotsCache.set(domain, {
      ...parsed,
      fetchedAt: Date.now(),
    });

    return text;
  } catch {
    return null;
  }
}

export function parseRobotsTxt(content: string): { rules: string[]; crawlDelay: number } {
  const lines = content.split('\n');
  const rules: string[] = [];
  let crawlDelay = 0;

  for (const line of lines) {
    const trimmed = line.trim().toLowerCase();

    if (trimmed.startsWith('disallow:')) {
      const path = trimmed.substring('disallow:'.length).trim();
      if (path) {
        rules.push(path);
      }
    }

    if (trimmed.startsWith('crawl-delay:')) {
      const delay = parseFloat(trimmed.substring('crawl-delay:'.length).trim());
      if (!isNaN(delay)) {
        crawlDelay = delay * 1000;
      }
    }
  }

  return { rules, crawlDelay };
}

export function isUrlAllowed(url: string, domain: string): boolean {
  const cached = robotsCache.get(domain);

  if (!cached || cached.rules.length === 0) {
    return true;
  }

  try {
    const urlObj = new URL(url);
    const path = urlObj.pathname || '/';
    const fullUrl = urlObj.href;

    for (const rule of cached.rules) {
      if (rule === '*') {
        continue;
      }

      if (rule.endsWith('$')) {
        const exactRule = rule.slice(0, -1);
        if (path === exactRule || fullUrl === exactRule) {
          return false;
        }
      } else if (rule === '/') {
        return false;
      } else if (path.startsWith(rule) || fullUrl.includes(rule)) {
        return false;
      }
    }
  } catch {
    return true;
  }

  return true;
}

export async function getCrawlDelay(domain: string): Promise<number> {
  const cached = robotsCache.get(domain);

  if (!cached) {
    await fetchRobotsTxt(domain);
    return CONFIG.domainDelayMs;
  }

  return Math.max(cached.crawlDelay, CONFIG.domainDelayMs);
}

export async function ensureRobotsFetched(domain: string): Promise<void> {
  const cached = robotsCache.get(domain);
  if (!cached) {
    await fetchRobotsTxt(domain);
  }
}