// Deterministic daily puzzle - no NYT scraping. The word is derived from the
// calendar date with a seeded hash, so the website and the Discord bot agree
// on the same word everywhere, but it is NOT the official NYT word.

import { ANSWERS } from './words.js';

/** FNV-1a hash of a string. */
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** YYYY-MM-DD in the local timezone for a Date (default: now). */
export function dateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** The daily word for a given YYYY-MM-DD key. */
export function dailyWord(key = dateKey()) {
  // Double-hash to decorrelate consecutive dates.
  const h = fnv1a('wordle-ai:' + key);
  const h2 = fnv1a(String(h) + key);
  return ANSWERS[(h ^ (h2 >>> 3)) % ANSWERS.length >>> 0];
}

/** Puzzle number: days since 2026-01-01 (just for display). */
export function dailyNumber(key = dateKey()) {
  const [y, m, d] = key.split('-').map(Number);
  const epoch = Date.UTC(2026, 0, 1);
  const day = Date.UTC(y, m - 1, d);
  return Math.max(1, Math.round((day - epoch) / 86400000) + 1);
}
