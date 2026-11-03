import type { WordCount } from './types';

const CJK_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g;
const LATIN_WORD_PATTERN = /[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g;

/**
 * Count Chinese characters plus Latin words/numbers. Punctuation is excluded
 * from the primary count, matching how Chinese school essays are usually
 * counted. `charsWithPunctuation` is provided as a secondary number.
 */
export function countWords(text: string): WordCount {
  const cjk = text.match(CJK_PATTERN)?.length ?? 0;
  const latinWords = text.match(LATIN_WORD_PATTERN)?.length ?? 0;
  const charsWithPunctuation = Array.from(text.replace(/\s/g, '')).length;

  return {
    chars: cjk + latinWords,
    charsWithPunctuation,
    cjk,
    latinWords,
  };
}
