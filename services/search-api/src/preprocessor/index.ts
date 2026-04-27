import { expandWithSynonyms } from './synonyms';

export function preprocessQuery(query: string): string[] {
  return expandWithSynonyms(query);
}

export function buildExpandedQuery(original: string, expanded: string[]): string {
  if (expanded.length <= 1) return original;
  return expanded.join(' OR ');
}