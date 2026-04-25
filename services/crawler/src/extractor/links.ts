import { CheerioAPI } from 'cheerio';
import { CONFIG } from '../config';
import { normalizeUrl, isValidUrl, resolveUrl, getDomain } from '../utils/url';

const URL_FILTER_PATTERNS = [
  /_____tmd_____/,
  /x5secdata=/,
  /\/redirect\//,
  /click_id=/,
  /utm_source/,
  /utm_medium/,
  /utm_campaign/,
  /scm=/,
  /icms-zebra-/,
];

function shouldFilterUrl(url: string): boolean {
  const lowerUrl = url.toLowerCase();
  return URL_FILTER_PATTERNS.some(pattern => pattern.test(lowerUrl));
}

export function extractLinks($: CheerioAPI, baseUrl: string): string[] {
  const links: string[] = [];
  const seen = new Set<string>();
  const baseDomain = getDomain(baseUrl);

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;

    const resolved = resolveUrl(baseUrl, href);
    if (!resolved || !isValidUrl(resolved)) return;

    if (shouldFilterUrl(resolved)) return;

    const normalized = normalizeUrl(resolved);
    if (!normalized) return;
    if (shouldFilterUrl(normalized)) return;
    if (seen.has(normalized)) return;
    
    seen.add(normalized);

    const linkDomain = getDomain(resolved);
    if (linkDomain === baseDomain) {
      links.unshift(normalized);
    } else {
      links.push(normalized);
    }
  });

  return links.slice(0, CONFIG.maxLinksPerPage);
}