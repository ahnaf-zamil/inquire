import { CONFIG } from '../config';
import { getDomain } from '../utils/url';

interface RobotsCache {
  rules: string[];
  allowRules: string[];
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

export function parseRobotsTxt(content: string): { rules: string[]; allowRules: string[]; crawlDelay: number } {
  const lines = content.split('\n');
  const rules: string[] = [];
  const allowRules: string[] = [];
  let crawlDelay = 0;
  let inStarGroup = false;

  for (const line of lines) {
    const trimmed = line.trim().toLowerCase();

    if (trimmed.startsWith('user-agent:')) {
      const ua = trimmed.substring('user-agent:'.length).trim();
      inStarGroup = ua === '*';
      continue;
    }

    if (!inStarGroup) continue;

    if (trimmed.startsWith('allow:')) {
      const path = trimmed.substring('allow:'.length).trim();
      if (path) {
        allowRules.push(path);
      }
      continue;
    }

    if (trimmed.startsWith('disallow:')) {
      const path = trimmed.substring('disallow:'.length).trim();
      if (path) {
        rules.push(path);
      }
      continue;
    }

    if (trimmed.startsWith('crawl-delay:')) {
      const delay = parseFloat(trimmed.substring('crawl-delay:'.length).trim());
      if (!isNaN(delay)) {
        crawlDelay = delay * 1000;
      }
    }
  }

  return { rules, allowRules, crawlDelay };
}

export function isUrlAllowed(url: string, domain: string): boolean {
  const cached = robotsCache.get(domain);

  if (!cached || (cached.rules.length === 0 && cached.allowRules.length === 0)) {
    return true;
  }

  try {
    const urlObj = new URL(url);
    const path = urlObj.pathname.toLowerCase();

    for (const rule of cached.allowRules) {
      const isExact = rule.endsWith('$');
      const cleanRule = isExact ? rule.slice(0, -1) : rule.replace(/[?*]$/, '');
      if (isExact ? path === cleanRule : path.startsWith(cleanRule)) {
        return true;
      }
    }

    for (const rule of cached.rules) {
      if (rule === '*') continue;
      const isExact = rule.endsWith('$');
      const cleanRule = isExact ? rule.slice(0, -1) : rule.replace(/[?*]$/, '');

      if (cleanRule === '/' && !isExact) {
        return false;
      }
      if (isExact ? path === cleanRule : path.startsWith(cleanRule)) {
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