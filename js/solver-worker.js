// Web worker for anything entropy-heavy, so the UI thread never janks.
// Handles: assistant analysis, entropy AI moves, and full solve traces for
// the compare tab (entropy, GA champion, random baseline).
import { EntropySolver, guessEntropy, solveWord } from '../core/entropy.js';
import { OPENERS } from '../core/openers.js';
import { CHAMPION } from '../core/champion.js';
import { AgentSolver, playGame, makeRng } from '../core/genetic.js';
import { computeFeedback, filterWords, ALL_GREEN } from '../core/feedback.js';
import { ALL_WORDS } from '../core/words.js';

function buildSolver(history) {
  const solver = new EntropySolver({ openers: OPENERS });
  for (const h of history) solver.observe(h.guess, h.pattern);
  return solver;
}

/** Assistant payload: candidates + ranked suggestions for a given history. */
function analyze(history, topN = 10) {
  const solver = buildSolver(history);
  const suggestions = solver.rank(topN);
  return {
    candidateCount: solver.candidateCount,
    topCandidates: solver.topCandidates(40),
    offList: solver.offList,
    suggestions,
  };
}

/** One entropy-AI move for the play tab, with explanation numbers. */
function entropyMove(history, forcedGuess = null) {
  const solver = buildSolver(history);
  const before = solver.candidateCount;
  let move;
  if (forcedGuess) {
    move = {
      word: forcedGuess,
      entropy: solver.offList ? 0 : guessEntropy(forcedGuess, solver.candidates),
      isCandidate: solver.topCandidates(1e9).includes(forcedGuess),
    };
  } else {
    move = solver.best();
  }
  return { word: move.word, entropy: move.entropy ?? 0, isCandidate: !!move.isCandidate, candidatesBefore: before };
}

/** Random-consistent-guesser baseline for the compare tab. */
function randomTrace(answer, { firstGuess = null, seed = 1, maxTurns = 6 } = {}) {
  const rng = makeRng(seed);
  let words = ALL_WORDS;
  const trace = [];
  for (let t = 0; t < maxTurns; t++) {
    let guess;
    if (t === 0 && firstGuess) guess = firstGuess;
    else guess = words[Math.floor(rng() * words.length)] || answer;
    const before = words.length;
    const pattern = computeFeedback(guess, answer);
    words = filterWords(words, guess, pattern);
    trace.push({ guess, pattern, candidatesBefore: before, candidatesAfter: words.length });
    if (pattern === ALL_GREEN) return { solved: true, turns: t + 1, trace };
  }
  return { solved: false, turns: maxTurns, trace };
}

self.onmessage = (e) => {
  const { id, type, payload } = e.data;
  let result;
  try {
    switch (type) {
      case 'analyze':
        result = analyze(payload.history, payload.topN || 10);
        break;
      case 'entropyMove':
        result = entropyMove(payload.history, payload.forcedGuess || null);
        break;
      case 'entropyTrace': {
        const trace = solveWord(payload.answer, { openers: OPENERS, firstGuess: payload.firstGuess || null });
        const last = trace[trace.length - 1];
        result = { trace, solved: last && last.pattern === ALL_GREEN && trace.length <= 6, turns: trace.length };
        break;
      }
      case 'gaTrace': {
        const genome = payload.genome || CHAMPION.genome;
        const firstGuess = payload.firstGuess || (payload.genome ? null : CHAMPION.opener);
        result = playGame(genome, payload.answer, { firstGuess, withTrace: true });
        break;
      }
      case 'gaMove': {
        const genome = payload.genome || CHAMPION.genome;
        const solver = new AgentSolver(genome, {
          firstGuess: payload.forcedGuess || (payload.history.length === 0 && !payload.genome ? CHAMPION.opener : null),
        });
        for (const h of payload.history) solver.observe(h.guess, h.pattern);
        const before = solver.candidateCount;
        const move = payload.forcedGuess
          ? { word: payload.forcedGuess, committed: false }
          : solver.nextGuess();
        result = { word: move.word, committed: !!move.committed, candidatesBefore: before };
        break;
      }
      case 'randomTrace':
        result = randomTrace(payload.answer, payload);
        break;
      default:
        throw new Error('unknown message type ' + type);
    }
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.stack || err) });
  }
};
