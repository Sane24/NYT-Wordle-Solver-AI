// Play vs AI - the user races one or two AI solvers on the same secret word.
import { ANSWERS, ALL_WORDS } from '../core/words.js';
import { computeFeedback, ALL_GREEN } from '../core/feedback.js';
import { dailyWord, dailyNumber, dateKey } from '../core/daily.js';
import { CHAMPION } from '../core/champion.js';
import { createBoard, createKeyboard, updateKeyStates, fmt, fmtInt } from './board.js';
import { solverCall } from './worker-rpc.js';

const VALID = new Set(ALL_WORDS);

const els = {};
let boardYou, boardAi1, boardAi2, keyboard;
let state = null;

function aiList() {
  const opp = document.querySelector('#play-opponent .on').dataset.v;
  if (opp === 'both') return ['entropy', 'ga'];
  return [opp];
}

const AI_LABELS = { entropy: '🧮 Entropy AI', ga: `🧬 Evolved GA (gen ${CHAMPION.generation})` };

function newGame() {
  const source = document.querySelector('#play-source .on').dataset.v;
  let target, label;
  if (source === 'daily') {
    target = dailyWord();
    label = `Daily puzzle #${dailyNumber()} (${dateKey()})`;
  } else if (source === 'custom') {
    const w = els.customWord.value.trim().toLowerCase();
    if (!/^[a-z]{5}$/.test(w)) {
      els.banner.className = 'banner lose';
      els.banner.textContent = 'Custom word must be exactly 5 letters.';
      return;
    }
    target = w;
    label = 'Custom word';
  } else {
    target = ANSWERS[Math.floor(Math.random() * ANSWERS.length)];
    label = 'Random word';
  }

  const ais = aiList();
  state = {
    target,
    label,
    over: false,
    typing: '',
    row: 0,
    keyStates: new Map(),
    sameOpener: els.sameOpener.checked,
    hideAi: els.hideAi.checked,
    ais: ais.map((kind, i) => ({
      kind,
      history: [],
      row: 0,
      done: false,
      turns: null,
      board: i === 0 ? boardAi1 : boardAi2,
      explainEl: i === 0 ? els.explain1 : els.explain2,
    })),
    busy: false,
  };

  boardYou.reset(); boardAi1.reset(); boardAi2.reset(); keyboard.reset();
  els.aiCol2.classList.toggle('hidden', ais.length < 2);
  els.aiName1.textContent = AI_LABELS[ais[0]];
  if (ais[1]) els.aiName2.textContent = AI_LABELS[ais[1]];
  els.explain1.innerHTML = state.sameOpener
    ? '<em>Waiting for your first word. The AI will open with the same one.</em>'
    : '<em>The AI moves right after you. Its reasoning appears here.</em>';
  els.explain2.innerHTML = els.explain1.innerHTML;
  els.banner.className = 'banner';
  els.banner.classList.remove('hidden');
  els.banner.textContent = `${label} - 6 tries. Beat the AI!`;
}

function explainFor(ai, move, pattern) {
  const after = move.candidatesAfter;
  if (ai.kind === 'entropy') {
    const bits = move.entropy ?? 0;
    return `Guessed <b>${state.hideAi && !state.over ? '•••••' : move.word.toUpperCase()}</b> - ` +
      `expected <span class="bits">${fmt(bits)} bits</span> of information` +
      `${move.isCandidate ? ' (and it could be the answer)' : ''}. ` +
      `Candidates: ${fmtInt(move.candidatesBefore)} → <b>${fmtInt(after)}</b>.`;
  }
  const mode = move.committed
    ? 'committed to a possible answer'
    : 'probed for information (per its evolved genes)';
  return `Guessed <b>${state.hideAi && !state.over ? '•••••' : move.word.toUpperCase()}</b> - ${mode}. ` +
    `Candidates: ${fmtInt(move.candidatesBefore)} → <b>${fmtInt(after)}</b>.`;
}

async function aiTakeTurn(ai, forcedGuess = null) {
  if (ai.done || ai.row >= 6) return;
  const msg = ai.kind === 'entropy' ? 'entropyMove' : 'gaMove';
  const move = await solverCall(msg, { history: ai.history, forcedGuess });
  const pattern = computeFeedback(move.word, state.target);
  ai.history.push({ guess: move.word, pattern });
  // candidatesAfter = candidates once this feedback is applied; ask cheaply next turn,
  // but for the explanation we recompute via another worker round-trip only when needed.
  const analysis = await solverCall('analyze', { history: ai.history, topN: 1 });
  move.candidatesAfter = analysis.candidateCount;
  ai.board.setRow(ai.row, move.word, pattern, { hideLetters: state.hideAi });
  ai.explainEl.innerHTML = `<b>Turn ${ai.row + 1}:</b> ` + explainFor(ai, move, pattern);
  ai.row++;
  if (pattern === ALL_GREEN) {
    ai.done = true;
    ai.turns = ai.row;
  } else if (ai.row >= 6) {
    ai.done = true;
    ai.turns = null;
  }
}

function revealAiLetters() {
  for (const ai of state.ais) {
    ai.history.forEach((h, r) => ai.board.setRow(r, h.guess, h.pattern, { animate: false }));
  }
}

async function finishGame(youTurns) {
  state.over = true;
  // Let unfinished AIs play out their remaining turns for a fair comparison.
  for (const ai of state.ais) {
    while (!ai.done) await aiTakeTurn(ai);
  }
  revealAiLetters();

  const results = [`You: ${youTurns ? youTurns + '/6' : 'X/6'}`];
  for (const ai of state.ais) {
    results.push(`${AI_LABELS[ai.kind]}: ${ai.turns ? ai.turns + '/6' : 'X/6'}`);
  }
  const aiBest = Math.min(...state.ais.map((a) => a.turns ?? 99));
  const you = youTurns ?? 99;
  let verdict, cls;
  if (you === 99 && aiBest === 99) { verdict = 'Nobody solved it!'; cls = 'lose'; }
  else if (you < aiBest) { verdict = '🏆 You beat the AI!'; cls = 'win'; }
  else if (you === aiBest) { verdict = '🤝 Tie with the AI.'; cls = 'win'; }
  else { verdict = '🤖 The AI wins this one.'; cls = 'lose'; }
  els.banner.className = `banner ${cls}`;
  els.banner.textContent = `${verdict}  The word was ${state.target.toUpperCase()}.  ${results.join('  ·  ')}`;
}

async function submitGuess() {
  const guess = state.typing.toLowerCase();
  if (guess.length !== 5) return boardYou.shake(state.row);
  if (!VALID.has(guess) && guess !== state.target) {
    els.banner.className = 'banner';
    els.banner.textContent = `"${guess.toUpperCase()}" isn't in the word list.`;
    return boardYou.shake(state.row);
  }
  state.busy = true;
  const pattern = computeFeedback(guess, state.target);
  boardYou.setRow(state.row, guess, pattern);
  updateKeyStates(state.keyStates, guess, pattern);
  setTimeout(() => keyboard.setStates(state.keyStates), 700);
  const isFirst = state.row === 0;
  state.row++;
  state.typing = '';

  const youWon = pattern === ALL_GREEN;
  const youOut = state.row >= 6 && !youWon;

  // AI moves after you (optionally copying your first word).
  for (const ai of state.ais) {
    await aiTakeTurn(ai, isFirst && state.sameOpener ? guess : null);
  }

  if (youWon) await finishGame(state.row);
  else if (youOut) await finishGame(null);
  state.busy = false;
}

function onKey(k) {
  if (!state || state.over || state.busy) return;
  if (k === 'Enter') return void submitGuess();
  if (k === 'Backspace') {
    state.typing = state.typing.slice(0, -1);
  } else if (/^[a-zA-Z]$/.test(k) && state.typing.length < 5) {
    state.typing += k.toLowerCase();
  } else return;
  boardYou.setPending(state.row, state.typing);
}

export function initPlay() {
  els.banner = document.getElementById('play-banner');
  els.customWord = document.getElementById('play-custom-word');
  els.sameOpener = document.getElementById('play-same-opener');
  els.hideAi = document.getElementById('play-hide-ai');
  els.aiCol2 = document.getElementById('ai-col-2');
  els.aiName1 = document.getElementById('ai-name-1');
  els.aiName2 = document.getElementById('ai-name-2');
  els.explain1 = document.getElementById('explain-ai-1');
  els.explain2 = document.getElementById('explain-ai-2');

  boardYou = createBoard(document.getElementById('board-you'));
  boardAi1 = createBoard(document.getElementById('board-ai-1'));
  boardAi2 = createBoard(document.getElementById('board-ai-2'));
  keyboard = createKeyboard(document.getElementById('keyboard'), onKey);

  for (const segId of ['play-source', 'play-opponent']) {
    document.getElementById(segId).addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      e.currentTarget.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      if (segId === 'play-source') {
        els.customWord.classList.toggle('hidden', b.dataset.v !== 'custom');
      }
    });
  }
  document.getElementById('play-new').addEventListener('click', newGame);
  document.addEventListener('keydown', (e) => {
    if (document.getElementById('panel-play').classList.contains('hidden')) return;
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'Enter' || e.key === 'Backspace' || /^[a-zA-Z]$/.test(e.key)) onKey(e.key);
  });

  newGame();
}
