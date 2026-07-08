// Genetic-algorithm solver.
//
// Each agent's "brain" is a genome of numeric weights over cheap word
// features (positional letter frequency, letter presence, split-information,
// unique letters, candidate membership) plus two behavioural genes that
// control when the agent stops probing and commits to guessing candidates.
//
// A population of agents is evaluated on real Wordle games each generation;
// the fittest survive, crossbreed and mutate. Nothing about entropy is
// hard-coded - but evolution tends to discover entropy-like behaviour
// (favour letters that split the field ~50/50, probe first, commit late).

import { ANSWERS, ALL_WORDS } from './words.js';
import { computeFeedback, filterWords, ALL_GREEN } from './feedback.js';
import { allCandidateIndices, filterCandidates } from './tables.js';

// ---------------------------------------------------------------- genome ---

export const GENE_DEFS = [
  { key: 'wPos',    min: 0,    max: 2, label: 'Positional frequency', desc: 'prefers letters common in each slot' },
  { key: 'wFreq',   min: 0,    max: 2, label: 'Letter frequency',     desc: 'prefers letters common anywhere in remaining words' },
  { key: 'wInfo',   min: 0,    max: 2, label: 'Split seeking',        desc: 'prefers letters that split remaining words ~50/50' },
  { key: 'wUnique', min: 0,    max: 1.5, label: 'Unique letters',     desc: 'avoids repeated letters' },
  { key: 'wCand',   min: -0.6, max: 1.5, label: 'Answer bias',        desc: 'prefers guessing words that could be the answer' },
  { key: 'commitCount', min: 1, max: 60, int: true, label: 'Commit threshold', desc: 'guesses only possible answers once this few remain' },
  { key: 'commitTurn',  min: 1, max: 6,  int: true, label: 'Commit turn',      desc: 'stops probing from this turn onward' },
];

export function randomGenome(rng) {
  const g = {};
  for (const d of GENE_DEFS) {
    let v = d.min + rng() * (d.max - d.min);
    if (d.int) v = Math.round(v);
    g[d.key] = v;
  }
  return g;
}

export function describeGenome(genome) {
  const traits = [];
  if (genome.wInfo >= 1.2) traits.push('strong split-seeker');
  else if (genome.wInfo >= 0.6) traits.push('mild split-seeker');
  if (genome.wPos >= 1.2) traits.push('position-driven');
  if (genome.wFreq >= 1.2) traits.push('frequency-driven');
  if (genome.wUnique >= 0.8) traits.push('no-repeat purist');
  if (genome.wCand >= 0.8) traits.push('go-for-the-win');
  else if (genome.wCand <= 0) traits.push('pure prober');
  if (genome.commitTurn <= 2) traits.push('commits early');
  else if (genome.commitTurn >= 4) traits.push('probes long');
  if (genome.commitCount >= 30) traits.push('impatient closer');
  return traits.length ? traits.join(', ') : 'balanced generalist';
}

// ------------------------------------------------------------- probe pool ---

// Static pool of information-rich words agents may probe with (computed once).
let PROBE_POOL = null;

export function getProbePool() {
  if (PROBE_POOL) return PROBE_POOL;
  const pres = new Float64Array(26);
  for (const w of ANSWERS) {
    let seen = 0;
    for (let i = 0; i < 5; i++) {
      const c = w.charCodeAt(i) - 97;
      const bit = 1 << c;
      if (!(seen & bit)) { pres[c]++; seen |= bit; }
    }
  }
  const scored = ALL_WORDS.map((w) => {
    let seen = 0, score = 0, distinct = 0;
    for (let i = 0; i < 5; i++) {
      const c = w.charCodeAt(i) - 97;
      const bit = 1 << c;
      if (!(seen & bit)) { seen |= bit; distinct++; score += pres[c]; }
    }
    return { w, key: distinct * 10000 + score / ANSWERS.length * 100 };
  });
  scored.sort((a, b) => b.key - a.key);
  PROBE_POOL = scored.slice(0, 600).map((s) => s.w);
  return PROBE_POOL;
}

// ------------------------------------------------------------ agent logic ---

/** Letter statistics over a list of words (the current candidate set). */
function computeStats(words) {
  const pos = new Float64Array(5 * 26);
  const pres = new Float64Array(26);
  for (const w of words) {
    let seen = 0;
    for (let i = 0; i < 5; i++) {
      const c = w.charCodeAt(i) - 97;
      pos[i * 26 + c]++;
      const bit = 1 << c;
      if (!(seen & bit)) { seen |= bit; pres[c]++; }
    }
  }
  const n = words.length || 1;
  for (let i = 0; i < pos.length; i++) pos[i] /= n;
  for (let i = 0; i < 26; i++) pres[i] /= n;
  return { pos, pres, n };
}

// Turn-1 stats are identical for every game and agent; cache them.
let FULL_STATS = null;
function fullStats() {
  if (!FULL_STATS) FULL_STATS = computeStats(ANSWERS);
  return FULL_STATS;
}

/** Score one word for a genome, given candidate-set letter stats. */
export function scoreWord(word, genome, stats, isCandidate) {
  let posScore = 0, freqScore = 0, infoScore = 0;
  let seen = 0, distinct = 0;
  for (let i = 0; i < 5; i++) {
    const c = word.charCodeAt(i) - 97;
    posScore += stats.pos[i * 26 + c];
    const bit = 1 << c;
    if (!(seen & bit)) {
      seen |= bit;
      distinct++;
      const p = stats.pres[c];
      freqScore += p;
      infoScore += 4 * p * (1 - p); // maximal when the letter splits 50/50
    }
  }
  return (
    genome.wPos * (posScore / 5) +
    genome.wFreq * (freqScore / 5) +
    genome.wInfo * (infoScore / 5) +
    genome.wUnique * (distinct / 5) +
    genome.wCand * (isCandidate ? 1 : 0)
  );
}

/**
 * Stateful solver driven by a genome. Same interface shape as EntropySolver:
 * nextGuess() -> word, observe(guess, pattern).
 */
export class AgentSolver {
  constructor(genome, { firstGuess = null } = {}) {
    this.genome = genome;
    this.candidates = allCandidateIndices();
    this.turn = 0;
    this.firstGuess = firstGuess;
    this.offList = false;
    this.offListWords = null;
  }

  get candidateCount() {
    return this.offList ? this.offListWords.length : this.candidates.length;
  }

  candidateWordList(limit = Infinity) {
    if (this.offList) return this.offListWords.slice(0, Math.min(limit, this.offListWords.length));
    const n = Math.min(this.candidates.length, limit);
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = ANSWERS[this.candidates[i]];
    return out;
  }

  /** Choose the next guess. Returns { word, committed, score }. */
  nextGuess() {
    if (this.turn === 0 && this.firstGuess) {
      return { word: this.firstGuess, committed: false, score: 0 };
    }
    const g = this.genome;
    const candWords = this.candidateWordList(400);
    const n = this.candidateCount;
    const stats = this.turn === 0 ? fullStats() : computeStats(candWords);
    const committed =
      n <= g.commitCount || this.turn + 1 >= g.commitTurn || n <= 2 || this.turn >= 5;

    const candSet = new Set(candWords);
    let pool;
    if (committed) {
      pool = candWords;
    } else {
      pool = getProbePool();
    }

    let bestWord = candWords[0] || 'crane';
    let bestScore = -Infinity;
    for (const w of pool) {
      const s = scoreWord(w, g, stats, candSet.has(w));
      if (s > bestScore) { bestScore = s; bestWord = w; }
    }
    if (!committed) {
      // Also consider a handful of candidates so probing agents can still win.
      const cap = Math.min(candWords.length, 60);
      for (let i = 0; i < cap; i++) {
        const w = candWords[i];
        const s = scoreWord(w, g, stats, true);
        if (s > bestScore) { bestScore = s; bestWord = w; }
      }
    }
    return { word: bestWord, committed, score: bestScore };
  }

  observe(guess, pattern) {
    this.turn++;
    if (this.offList) {
      this.offListWords = filterWords(this.offListWords, guess, pattern);
      return;
    }
    this.candidates = filterCandidates(this.candidates, guess, pattern);
    if (this.candidates.length === 0) {
      this.offList = true;
      this.offListWords = filterWords(ALL_WORDS, guess, pattern);
    }
  }
}

/** Play one full game. Returns { solved, turns, trace }. */
export function playGame(genome, answer, { firstGuess = null, maxTurns = 6, withTrace = false } = {}) {
  const solver = new AgentSolver(genome, { firstGuess });
  const trace = withTrace ? [] : null;
  for (let t = 0; t < maxTurns; t++) {
    const before = solver.candidateCount;
    const move = solver.nextGuess();
    const pattern = computeFeedback(move.word, answer);
    solver.observe(move.word, pattern);
    if (trace) {
      trace.push({
        guess: move.word,
        pattern,
        committed: move.committed,
        candidatesBefore: before,
        candidatesAfter: solver.candidateCount,
      });
    }
    if (pattern === ALL_GREEN) return { solved: true, turns: t + 1, trace };
  }
  return { solved: false, turns: maxTurns, trace };
}

/** Evaluate a genome over a set of answers. */
export function evaluateGenome(genome, answers, { maxTurns = 6 } = {}) {
  // The opener depends only on the genome - compute it once for the batch.
  const opener = new AgentSolver(genome).nextGuess().word;
  let totalPenalty = 0, solvedTurns = 0, solved = 0;
  const secondCounts = new Map(); // the agent's most common follow-up guess
  for (const answer of answers) {
    const r = playGame(genome, answer, { firstGuess: opener, maxTurns, withTrace: true });
    const g2 = r.trace[1] && r.trace[1].guess;
    if (g2) secondCounts.set(g2, (secondCounts.get(g2) || 0) + 1);
    if (r.solved) { solved++; solvedTurns += r.turns; totalPenalty += r.turns; }
    else totalPenalty += maxTurns + 2; // failing costs more than any solve
  }
  let secondGuess = null, secondBest = 0;
  for (const [w, c] of secondCounts) {
    if (c > secondBest) { secondBest = c; secondGuess = w; }
  }
  const games = answers.length;
  return {
    fitness: -(totalPenalty / games),
    avgGuesses: solved ? solvedTurns / solved : maxTurns + 2,
    solveRate: solved / games,
    opener,
    secondGuess,
  };
}

// -------------------------------------------------------------- evolution ---

/** Deterministic PRNG (mulberry32). */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clampGene(def, v) {
  v = Math.min(def.max, Math.max(def.min, v));
  return def.int ? Math.round(v) : v;
}

function crossover(a, b, rng) {
  const child = {};
  for (const d of GENE_DEFS) {
    const r = rng();
    if (r < 0.4) child[d.key] = a[d.key];
    else if (r < 0.8) child[d.key] = b[d.key];
    else child[d.key] = clampGene(d, (a[d.key] + b[d.key]) / 2); // blend
  }
  return child;
}

function mutate(genome, rng, rate, strength) {
  const g = { ...genome };
  for (const d of GENE_DEFS) {
    if (rng() < rate) {
      const span = d.max - d.min;
      const noise = (rng() * 2 - 1) * span * strength;
      g[d.key] = clampGene(d, g[d.key] + noise);
    }
  }
  return g;
}

/**
 * The evolution engine. Call step() once per generation; it returns full
 * per-agent stats so a UI can animate selection, death and reproduction.
 */
export class GeneticEvolver {
  constructor({
    populationSize = 120,
    gamesPerAgent = 30,
    eliteCount = 8,
    tournamentK = 3,
    mutationRate = 0.35,
    mutationStrength = 0.25,
    immigrantCount = 4,
    seed = 42,
    maxTurns = 6,
  } = {}) {
    this.opts = { populationSize, gamesPerAgent, eliteCount, tournamentK, mutationRate, mutationStrength, immigrantCount, maxTurns };
    this.rng = makeRng(seed);
    this.generation = 0;
    this.nextId = 0;
    this.population = [];
    for (let i = 0; i < populationSize; i++) {
      this.population.push({ id: this.nextId++, genome: randomGenome(this.rng), parents: [] });
    }
    this.history = []; // per-generation summary stats
    this.champion = null;
  }

  sampleAnswers() {
    const { gamesPerAgent } = this.opts;
    const picked = new Set();
    while (picked.size < Math.min(gamesPerAgent, ANSWERS.length)) {
      picked.add(ANSWERS[Math.floor(this.rng() * ANSWERS.length)]);
    }
    return [...picked];
  }

  /** Evaluate current population, breed the next one. Returns generation report. */
  step() {
    const { populationSize, eliteCount, tournamentK, mutationRate, mutationStrength, immigrantCount, maxTurns } = this.opts;
    const answers = this.sampleAnswers();

    for (const agent of this.population) {
      const r = evaluateGenome(agent.genome, answers, { maxTurns });
      Object.assign(agent, r);
    }
    this.population.sort((a, b) => b.fitness - a.fitness);

    const survivors = Math.floor(populationSize / 2);
    this.population.forEach((a, i) => {
      a.rank = i;
      a.status = i < eliteCount ? 'elite' : i < survivors ? 'survived' : 'died';
    });

    const best = this.population[0];
    const mean = (k) => this.population.reduce((s, a) => s + a[k], 0) / this.population.length;
    if (!this.champion || best.fitness > this.champion.fitness) {
      this.champion = { genome: { ...best.genome }, fitness: best.fitness, avgGuesses: best.avgGuesses, solveRate: best.solveRate, opener: best.opener, generation: this.generation };
    }

    const report = {
      generation: this.generation,
      best: { id: best.id, genome: { ...best.genome }, fitness: best.fitness, avgGuesses: best.avgGuesses, solveRate: best.solveRate, opener: best.opener },
      meanFitness: mean('fitness'),
      meanAvgGuesses: mean('avgGuesses'),
      meanSolveRate: mean('solveRate'),
      agents: this.population.map((a) => ({
        id: a.id, rank: a.rank, status: a.status, fitness: a.fitness,
        avgGuesses: a.avgGuesses, solveRate: a.solveRate, opener: a.opener,
        secondGuess: a.secondGuess, genome: { ...a.genome }, parents: a.parents,
      })),
    };
    this.history.push({
      generation: this.generation,
      bestAvgGuesses: best.avgGuesses, bestSolveRate: best.solveRate, bestFitness: best.fitness,
      meanAvgGuesses: report.meanAvgGuesses, meanSolveRate: report.meanSolveRate,
    });

    // ---- breed next generation ----
    const parentsPool = this.population.slice(0, survivors);
    const pick = () => {
      let bestA = null;
      for (let i = 0; i < tournamentK; i++) {
        const c = parentsPool[Math.floor(this.rng() * parentsPool.length)];
        if (!bestA || c.fitness > bestA.fitness) bestA = c;
      }
      return bestA;
    };

    const next = [];
    for (let i = 0; i < eliteCount; i++) {
      const e = this.population[i];
      next.push({ id: e.id, genome: { ...e.genome }, parents: e.parents });
    }
    for (let i = 0; i < immigrantCount; i++) {
      next.push({ id: this.nextId++, genome: randomGenome(this.rng), parents: [] });
    }
    while (next.length < populationSize) {
      const pa = pick(), pb = pick();
      let genome = crossover(pa.genome, pb.genome, this.rng);
      genome = mutate(genome, this.rng, mutationRate, mutationStrength);
      next.push({ id: this.nextId++, genome, parents: [pa.id, pb.id] });
    }
    this.population = next;
    this.generation++;
    return report;
  }
}
