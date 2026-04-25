import crypto from 'crypto';

export function computeContentHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

export function computeShortHash(content: string, length = 8): string {
  const hash = computeContentHash(content);
  return hash.slice(0, length);
}