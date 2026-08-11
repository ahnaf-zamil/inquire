import { expandWithSynonyms } from './synonyms';

export function preprocessQuery(query: string): string[] {
  return expandWithSynonyms(query);
}

export function buildExpandedQuery(original: string, _expanded: string[]): string {
  return original;
}