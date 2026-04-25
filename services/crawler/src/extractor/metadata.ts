import { CheerioAPI } from 'cheerio';

export function extractMetadata($: CheerioAPI) {
  const description = $('meta[name="description"]').attr('content') ||
                      $('meta[property="og:description"]').attr('content');

  const keywordsStr = $('meta[name="keywords"]').attr('content');
  const keywords = keywordsStr ? keywordsStr.split(',').map(k => k.trim()).filter(Boolean) : undefined;

  const ogTitle = $('meta[property="og:title"]').attr('content');
  const ogDescription = $('meta[property="og:description"]').attr('content');
  const ogImage = $('meta[property="og:image"]').attr('content');

  return {
    description: description?.trim(),
    keywords,
    ogTitle: ogTitle?.trim(),
    ogDescription: ogDescription?.trim(),
    ogImage,
  };
}