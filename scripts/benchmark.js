// Benchmarks the entropy solver vs the evolved GA champion on a sample of
// answers (or all of them with --full). Run: npm run benchmark
import { solveWord } from '../core/entropy.js';
import { playGame, makeRng } from '../core/genetic.js';
import { ANSWERS } from '../core/words.js';
import { OPENERS } from '../core/openers.js';
import { CHAMPION } from '../core/champion.js';
import { ALL_GREEN } from '../core/feedback.js';

const full = process.argv.includes('--full');
let sample;
if (full) {
  sample = ANSWERS;
} else {
  const rng = makeRng(7);
  const set = new Set();
  while (set.size < 300) set.add(ANSWERS[Math.floor(rng() * ANSWERS.length)]);
  sample = [...set];
}

function stats(name, results) {
  const solved = results.filter((r) => r.solved);
  const avg = solved.reduce((s, r) => s + r.turns, 0) / solved.length;
  const dist = [0, 0, 0, 0, 0, 0];
  for (const r of solved) dist[r.turns - 1]++;
  console.log(`\n${name}`);
  console.log(`  solve rate : ${((solved.length / results.length) * 100).toFixed(1)}%`);
  console.log(`  avg guesses: ${avg.toFixed(3)}`);
  console.log(`  distribution: ${dist.map((d, i) => `${i + 1}:${d}`).join('  ')}`);
  return avg;
}

console.log(`Benchmarking on ${sample.length} answers...`);

let t0 = Date.now();
const entropyResults = sample.map((answer) => {
  const trace = solveWord(answer, { openers: OPENERS });
  const solved = trace.length > 0 && trace[trace.length - 1].pattern === ALL_GREEN && trace.length <= 6;
  return { solved, turns: trace.length };
});
stats(`Entropy solver (${((Date.now() - t0) / 1000).toFixed(1)}s)`, entropyResults);

t0 = Date.now();
const gaResults = sample.map((answer) =>
  playGame(CHAMPION.genome, answer, { firstGuess: CHAMPION.opener })
);
stats(`GA champion "${CHAMPION.opener}" gen ${CHAMPION.generation} (${((Date.now() - t0) / 1000).toFixed(1)}s)`, gaResults);
