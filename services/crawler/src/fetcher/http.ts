import { CONFIG } from '../config';
import { logger } from '../utils/logger';
import { isSafeUrl } from '../utils/url';

const SPA_HEADERS = [
  'x-js-render',
  'x-spa',
  'x-nextjs-cached',
];

export interface HttpFetchResult {
  html: string;
  status: number;
  contentType?: string;
  needsPlaywright: boolean;
}

export function detectSpaPatterns(html: string): boolean {
  const htmlLower = html.toLowerCase();

  // Framework-specific markers
  if (htmlLower.includes('__next_data__') ||
      htmlLower.includes('__next_rev') ||
      htmlLower.includes('__next_build_id')) {
    logger.debug('Detected Next.js pattern');
    return true;
  }

  if (htmlLower.includes('data-react') || htmlLower.includes('data-reactroot')) {
    logger.debug('Detected React pattern');
    return true;
  }

  if (htmlLower.includes('ng-app') || htmlLower.includes('data-vue') || htmlLower.includes('v-app')) {
    logger.debug('Detected Vue/Angular pattern');
    return true;
  }

  if (htmlLower.includes('data-svelte') || htmlLower.includes('svelte:')) {
    logger.debug('Detected Svelte pattern');
    return true;
  }

  // Root element patterns (most SPAs have this)
  const idMatch = html.match(/id="(app|mount|root|__next)"[>\s]/i);
  if (idMatch) {
    logger.debug('Detected root id pattern', { pattern: idMatch[1] });
    return true;
  }

  // Check for SPA bundle patterns - if there are multiple JS files from same domain, likely SPA
  const scriptMatches = html.match(/<script[^>]+src="([^"]+)"/gi) || [];
  if (scriptMatches.length >= 3) {
    logger.debug('Detected SPA bundle pattern', { scriptCount: scriptMatches.length });
    return true;
  }

  // Check for common SPA loader patterns
  if (htmlLower.includes('loading...') && htmlLower.includes('window.onload')) {
    logger.debug('Detected SPA loader pattern');
    return true;
  }

  // Check if main content is in data attributes (common in modern SPAs)
  if (html.match(/data-(page|component|props)="/i)) {
    logger.debug('Detected data attribute pattern');
    return true;
  }

  logger.debug('No SPA patterns detected', { htmlLength: html.length });
  return false;
}

function isAntiBotPage(statusCode: number, html: string, headers: Record<string, string>): boolean {
  // Check status codes that indicate blocking (NOT 429 - that's rate limiting, not blocking)
  if (statusCode === 401 || statusCode === 403 || statusCode === 503) {
    logger.warn('Blocked status code', { statusCode });
    return true;
  }

  const htmlLower = html.toLowerCase();

  // Cloudflare challenges
  if (htmlLower.includes('cloudflare') && 
      (htmlLower.includes('checking your browser') || 
       htmlLower.includes('challenge') ||
       htmlLower.includes('ray id') ||
       htmlLower.includes('__cf_'))) {
    logger.warn('Cloudflare challenge detected');
    return true;
  }

  // DataDome protection
  if (headers['x-datadome'] || htmlLower.includes('datadome')) {
    logger.warn('DataDome protection detected');
    return true;
  }

  // Incapsula / Imperva
  if (htmlLower.includes('incapsula') || htmlLower.includes('imperva')) {
    logger.warn('Incapsula protection detected');
    return true;
  }

  // PerimeterX / Arkose
  if (htmlLower.includes('perimeterx') || htmlLower.includes('arkose')) {
    logger.warn('PerimeterX/Arkose detected');
    return true;
  }

  // Generic bot detection messages
  if (htmlLower.includes('access denied') && htmlLower.includes('bot')) {
    logger.warn('Generic bot block detected');
    return true;
  }

  // Very small responses that are likely bot pages
  if (html.length > 0 && html.length < 500 && htmlLower.includes('javascript')) {
    logger.warn('Suspiciously small response', { htmlLength: html.length });
    return true;
  }

  return false;
}

export async function fetchHtml(url: string): Promise<HttpFetchResult> {
  if (!isSafeUrl(url)) {
    throw new Error(`Unsafe URL rejected: ${url}`);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CONFIG.httpFetchTimeout);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Cache-Control': 'max-age=0',
      },
      signal: controller.signal,
      redirect: 'follow',
    });

    clearTimeout(timeoutId);

    const statusCode = response.status;
    const headers: Record<string, string> = {};
    response.headers.forEach((v, k) => headers[k] = v);

    logger.debug('HTTP response', { url, statusCode, contentLength: headers['content-length'], contentEncoding: headers['content-encoding'] });

    clearTimeout(timeoutId);

    const contentType = headers['content-type'] as string || '';
    if (!contentType.includes('text/html')) {
      throw new Error(`Not HTML content: ${contentType}`);
    }

    let needsPlaywright = false;
    const contentTypeLower = contentType.toLowerCase();
    if (contentTypeLower.includes('application/json')) {
      needsPlaywright = true;
    }

    for (const header of SPA_HEADERS) {
      const headerValue = headers[header];
      if (headerValue === 'true' || headerValue === '1') {
        needsPlaywright = true;
        break;
      }
    }

    // Get the HTML text - fetch decompresses automatically with compress: true
    const html = await response.text();
    
    logger.debug('Got HTML', { url, htmlLength: html.length });

    // Handle rate limiting (429) - throw error with statusCode for retry logic
    if (statusCode === 429) {
      const retryAfter = headers['retry-after'];
      const delay = retryAfter ? parseInt(retryAfter) * 1000 : 5000;
      logger.warn('Rate limited', { url, delayMs: delay });
      const err = new Error(`Rate limited: 429`) as Error & { statusCode: number };
      err.statusCode = 429;
      throw err;
    }

    // Anti-bot detection - check status and content
    if (isAntiBotPage(statusCode, html, headers)) {
      const err = new Error(`Anti-bot page detected: ${statusCode}`) as Error & { statusCode: number };
      err.statusCode = statusCode;
      throw err;
    }

    if (!needsPlaywright) {
      needsPlaywright = detectSpaPatterns(html);
    }

    return { html, status: statusCode, contentType, needsPlaywright };
  } catch (error) {
    clearTimeout(timeoutId);
    if ((error as Error).name === 'AbortError') {
      throw new Error(`Request timeout after ${CONFIG.httpFetchTimeout}ms`);
    }
    throw error;
  }
}