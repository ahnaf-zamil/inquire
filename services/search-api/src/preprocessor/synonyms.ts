import * as fs from 'fs';
import * as path from 'path';

interface SynonymMap {
  [term: string]: string[];
}

let synonymMap: SynonymMap = {};
let loaded = false;

export function loadSynonyms(): void {
  if (loaded) return;

  const synonymsPath = path.join(__dirname, '../../data/core-synonyms.txt');
  const content = fs.readFileSync(synonymsPath, 'utf-8');
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const terms = trimmed.split(',').map(t => t.trim().toLowerCase()).filter(t => t);

    for (const term of terms) {
      const otherTerms = terms.filter(t => t !== term);
      if (otherTerms.length > 0) {
        if (!synonymMap[term]) {
          synonymMap[term] = [];
        }
        synonymMap[term].push(...otherTerms);
      }
    }
  }

  loaded = true;
  console.log(`Loaded ${Object.keys(synonymMap).length} synonyms`);
}

export function expandWithSynonyms(query: string): string[] {
  if (!loaded) loadSynonyms();

  const words = query.toLowerCase().split(/\s+/);
  const expansions = new Set<string>([query.toLowerCase()]);

  for (const word of words) {
    const cleaned = word.replace(/[^a-z0-9-]/g, '');
    if (synonymMap[cleaned]) {
      for (const syn of synonymMap[cleaned]) {
        expansions.add(syn);
      }
    }
  }

  return Array.from(expansions);
}