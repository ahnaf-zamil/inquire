import { fetchHtml } from './http';
import { fetchWithPlaywright } from './playwright-client';
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

    // Tier 1: Definitive framework markers (cheap, precise)
    let strongSpaSignal = result.needsPlaywright;

    if (!strongSpaSignal) {
      // Tier 2: Statistical heuristics with high thresholds
      const scriptTagCount = (result.html.match(/<script[^>]+src=/gi) || []).length;
      const textLength = result.html.replace(/<[^>]+>/g, '').trim().length;
      const textHtmlRatio = result.html.length > 0 ? textLength / result.html.length : 0;
      const hasNoscriptFallback = /<noscript[^>]*>.*?(javascript|enable|enable javascript).*?<\/noscript>/i.test(result.html);

      strongSpaSignal = 
        scriptTagCount >= 30 ||
        textHtmlRatio < 0.05 ||
        hasNoscriptFallback;
    }

    logger.debug('Fetched URL', { url, scriptTagCount: (result.html.match(/<script[^>]+src=/gi) || []).length, htmlLength: result.html.length, strongSpaSignal, textHtmlRatio: result.html.length > 0 ? result.html.replace(/<[^>]+>/g, '').trim().length / result.html.length : 0 });

    if (strongSpaSignal) {
      logger.info('Using Playwright', { url, needsPlaywright: strongSpaSignal });
      return fetchWithPlaywright(url);
    }

    return { html: result.html, contentType: 'static' };
  } catch (error) {
    logger.warn('HTTP fetch failed, trying Playwright', { url, error });
    return fetchWithPlaywright(url);
  }
}

export { fetchHtml, fetchWithPlaywright };