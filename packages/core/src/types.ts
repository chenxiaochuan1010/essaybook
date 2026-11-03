export type ChangeType = 'insert' | 'delete' | 'replace';

export interface TextChange {
  type: ChangeType;
  /** Start offset in the base text (UTF-16 code units). */
  baseStart: number;
  /** End offset in the base text (exclusive). */
  baseEnd: number;
  oldText: string;
  newText: string;
}

export interface IdentifiedChange extends TextChange {
  id: string;
  seq: number;
  status?: 'pending' | 'accepted' | 'rejected' | 'conflict';
  submissionId?: string;
  reviewerId?: string;
}

export interface ConflictPair {
  a: IdentifiedChange;
  b: IdentifiedChange;
}

export interface WordCount {
  /** Chinese characters + Latin words/numbers, punctuation excluded. */
  chars: number;
  /** All non-whitespace characters, punctuation included. */
  charsWithPunctuation: number;
  cjk: number;
  latinWords: number;
}
