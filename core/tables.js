// Shared fast-lookup infrastructure for the solvers.
//
// The hot operation everywhere is "feedback of guess G vs every answer".
// We cache one Uint8Array row per guess word (243 fits in a byte), computed
// on demand. Candidate sets are represented as Int32Array indices into
// ANSWERS so filtering is a table lookup instead of a string comparison.

import { ANSWERS, ALL_WORDS } from './words.js';
import { computeFeedback } from './feedback.js';

export const ANSWER_INDEX = new Map(ANSWERS.map((w, i) => [w, i]));
export const WORD_INDEX = new Map(ALL_WORDS.map((w, i) => [w, i]));

const rowCache = new Map();

/** Uint8Array of feedback patterns: row[i] = feedback(guess, ANSWERS[i]). */
export function getPatternRow(guess) {
  let row = rowCache.get(guess);
  if (row) return row;
  row = new Uint8Array(ANSWERS.length);
  for (let i = 0; i < ANSWERS.length; i++) {
    row[i] = computeFeedback(guess, ANSWERS[i]);
  }
  rowCache.set(guess, row);
  return row;
}

export function clearRowCache() {
  rowCache.clear();
}

/** All answer indices, as the starting candidate set. */
export function allCandidateIndices() {
  const idx = new Int32Array(ANSWERS.length);
  for (let i = 0; i < idx.length; i++) idx[i] = i;
  return idx;
}

/** Filter candidate indices with a cached row lookup. */
export function filterCandidates(candidates, guess, pattern) {
  const row = getPatternRow(guess);
  const out = [];
  for (let k = 0; k < candidates.length; k++) {
    const i = candidates[k];
    if (row[i] === pattern) out.push(i);
  }
  return Int32Array.from(out);
}

export function candidateWords(candidates, limit = Infinity) {
  const n = Math.min(candidates.length, limit);
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = ANSWERS[candidates[i]];
  return out;
}
