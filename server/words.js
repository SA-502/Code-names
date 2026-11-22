import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_WORDS = JSON.parse(readFileSync(join(here, '..', 'data', 'words-ar.json'), 'utf8'));

// تحويل نص ملصوق (أسطر أو فواصل) إلى قائمة كلمات
export function parseCustomWords(text) {
  return String(text ?? '')
    .split(/[\n,،;؛]+/)
    .map((w) => w.trim().replace(/\s+/g, ' '))
    .filter((w) => w.length > 0 && w.length <= 24)
    .slice(0, 1000);
}

export function wordPool(settings) {
  const custom = settings.customWords || [];
  if (settings.wordMode === 'custom') return custom;
  if (settings.wordMode === 'mixed') return [...DEFAULT_WORDS, ...custom];
  return DEFAULT_WORDS;
}
