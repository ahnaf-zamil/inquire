import { fetchHtml } from './http';
import { fetchWithPlaywright } from './playwright-client';
import { CONFIG } from '../config';
import { logger } from '../utils/logger';

export interface FetchResult {
  html: string;
  contentType: 'static' | 'javascript';
}

export async function fetchUrl(url: string, usePlaywright = false): Promise<FetchResult> {
  if (usePlaywright) {
    return fetchWithPlaywright(url);
  }

  try {
    const result = await fetchHtml(url);
    
    // Count script tags - strong indicator of modern SPA
    const scriptTagCount = (result.html.match(/<script[^>]+src=/gi) || []).length;
    const likelySpa = scriptTagCount >= 10;
    
    logger.debug('Fetched URL', { url, scriptTagCount, htmlLength: result.html.length });

    // SPA sites always need Playwright
    if (result.needsPlaywright || likelySpa) {
      logger.info('Using Playwright', { url, scriptTagCount, likelySpa, needsPlaywright: result.needsPlaywright });
      return fetchWithPlaywright(url);
    }

    const wordCount = result.html.split(/\s+/).length;

    // Static sites with good content
    if (wordCount >= CONFIG.minContentWords) {
      return { html: result.html, contentType: 'static' };
    }

    // Thin content - try Playwright
    return fetchWithPlaywright(url);
  } catch (error) {
    logger.warn('HTTP fetch failed, trying Playwright', { url, error });
    return fetchWithPlaywright(url);
  }
}

export { fetchHtml, fetchWithPlaywright };