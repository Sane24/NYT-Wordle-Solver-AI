// Information-theory solver.
//
// For a guess G and a candidate set C, the feedback pattern partitions C into
// up to 243 buckets. The entropy of that partition is the expected number of
// bits of information the guess yields:
//
//   H(G) = log2(|C|) - (1/|C|) * sum_over_buckets( n_b * log2(n_b) )
//
// The solver picks the guess with the highest H, breaking ties in favor of
// words that could themselves be the answer (they can win outright).

import { ANSWERS, ALL_WORDS } from './words.js';
import { computeFeedback, filterWords, ALL_GREEN } from './feedback.js';
import { getPatternRow, allCandidateIndices, filterCandidates, candidateWords } from './tables.js';

const LOG2 = Math.log(2);
const log2 = (x) => Math.log(x) / LOG2;

/** Entropy (bits) of guessing `guess` against candidate indices `candidates`. */
export function guessEntropy(guess, candidates) {
  const row = getPatternRow(guess);
  const buckets = new Uint16Array(243);
  for (let k = 0; k < candidates.length; k++) buckets[row[candidates[k]]]++;
  const n = candidates.length;
  let sum = 0;
  for (let p = 0; p < 243; p++) {
    const c = buckets[p];
    if (c > 0) sum += c * log2(c);
  }
  return log2(n) - sum / n;
}

/**
 * Rank guesses by entropy. Returns the top `topN` as
 * { word, entropy, isCandidate, expectedRemaining, winChance }.
 *
 * guessPool defaults to ALL_WORDS, but shrinks to the candidates themselves
 * once few remain (a non-candidate guess can no longer be worth a turn).
 */
export function rankGuesses(candidates, { topN = 10, guessPool = null, candidateBonus = 0.001 } = {}) {
  const n = candidates.length;
  const candSet = new Set();
  for (let k = 0; k < n; k++) candSet.add(ANSWERS[candidates[k]]);

  let pool = guessPool;
  if (!pool) pool = n <= 2 ? [...candSet] : ALL_WORDS;

  const results = [];
  for (const word of pool) {
    const H = guessEntropy(word, candidates);
    const isCandidate = candSet.has(word);
    // Tie-break: a candidate guess has a 1/n chance of ending the game now.
    const score = H + (isCandidate ? candidateBonus + 1 / n : 0);
    results.push({
      word,
      entropy: H,
      isCandidate,
      winChance: isCandidate ? 1 / n : 0,
      expectedRemaining: n / Math.pow(2, H),
      score,
    });
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topN);
}

/**
 * Stateful entropy solver for a single game.
 * Feed it feedback with observe(); ask for the next move with best().
 */
export class EntropySolver {
  constructor({ openers = null } = {}) {
    this.candidates = allCandidateIndices();
    this.history = [];
    this.openers = openers; // precomputed first-move table (optional)
    this.offList = false;   // true when the answer isn't in ANSWERS
    this.offListWords = null;
  }

  get candidateCount() {
    return this.offList ? this.offListWords.length : this.candidates.length;
  }

  topCandidates(limit = 12) {
    return this.offList
      ? this.offListWords.slice(0, limit)
      : candidateWords(this.candidates, limit);
  }

  /** Top guesses with entropy details, for UI explanation panels. */
  rank(topN = 10) {
    if (this.history.length === 0 && this.openers) {
      return this.openers.slice(0, topN);
    }
    if (this.offList) return this.rankOffList(topN);
    return rankGuesses(this.candidates, { topN });
  }

  best() {
    return this.rank(1)[0];
  }

  /** Record a played guess and its observed pattern. */
  observe(guess, pattern) {
    this.history.push({ guess, pattern });
    if (this.offList) {
      this.offListWords = filterWords(this.offListWords, guess, pattern);
      return;
    }
    this.candidates = filterCandidates(this.candidates, guess, pattern);
    if (this.candidates.length === 0) {
      // The target isn't an official answer (manual/custom puzzles).
      // Fall back to the full guessable dictionary re-filtered by history.
      this.offList = true;
      let words = ALL_WORDS;
      for (const h of this.history) words = filterWords(words, h.guess, h.pattern);
      this.offListWords = words;
    }
  }

  rankOffList(topN) {
    const words = this.offListWords;
    const n = words.length;
    const pool = n <= 2 ? words : ALL_WORDS;
    const results = [];
    const candSet = new Set(words);
    for (const g of pool) {
      const buckets = new Map();
      for (const w of words) {
        const p = computeFeedback(g, w);
        buckets.set(p, (buckets.get(p) || 0) + 1);
      }
      let sum = 0;
      for (const c of buckets.values()) sum += c * log2(c);
      const H = n > 0 ? log2(n) - sum / n : 0;
      const isCandidate = candSet.has(g);
      results.push({
        word: g,
        entropy: H,
        isCandidate,
        winChance: isCandidate ? 1 / n : 0,
        expectedRemaining: n / Math.pow(2, H),
        score: H + (isCandidate ? 0.001 + 1 / n : 0),
      });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topN);
  }
}

/**
 * Play a full game against `answer`. Returns the trace:
 * [{ guess, pattern, entropy, candidatesBefore, candidatesAfter }...]
 */
export function solveWord(answer, { openers = null, firstGuess = null, maxTurns = 10 } = {}) {
  const solver = new EntropySolver({ openers });
  const trace = [];
  for (let turn = 0; turn < maxTurns; turn++) {
    let move;
    if (turn === 0 && firstGuess) {
      move = { word: firstGuess, entropy: guessEntropy(firstGuess, solver.candidates) };
    } else {
      move = solver.best();
    }
    const before = solver.candidateCount;
    const pattern = computeFeedback(move.word, answer);
    solver.observe(move.word, pattern);
    trace.push({
      guess: move.word,
      pattern,
      entropy: move.entropy,
      candidatesBefore: before,
      candidatesAfter: solver.candidateCount,
    });
    if (pattern === ALL_GREEN) break;
  }
  return trace;
}
