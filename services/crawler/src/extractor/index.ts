import * as cheerio from 'cheerio';
import { ExtractedContent } from '../types';
import { extractLinks } from './links';
import { extractStructuredContent } from './content';
import { extractMetadata } from './metadata';
import { computeContentHash } from '../utils/hash';

export function extractAll(html: string, baseUrl: string): {
  content: ExtractedContent;
  links: string[];
} {
  const $ = cheerio.load(html);

  const content = extractStructuredContent($);
  const metadata = extractMetadata($);
  const title = metadata.ogTitle || $('title').text() || content.h1[0] || '';

  const fullText = [
    ...content.h1,
    ...content.h2,
    ...content.h3,
    ...content.h4,
    ...content.h5,
    ...content.h6,
    ...content.paragraphs,
  ].join(' ');

  const wordCount = fullText.split(/\s+/).filter(w => w.length > 0).length;
  const contentHash = computeContentHash(fullText);

  content.fullText = fullText;

  const extractedContent: ExtractedContent = {
    title: title.trim(),
    content,
    metadata,
    wordCount,
    contentHash,
  };

  const links = extractLinks($, baseUrl);

  return { content: extractedContent, links };
}

export { extractLinks } from './links';
export { extractStructuredContent } from './content';
export { extractMetadata } from './metadata';