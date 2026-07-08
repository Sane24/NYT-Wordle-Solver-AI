// Solver Assistant - manual puzzle input. The user mirrors any Wordle-like
// game (including the real NYT one): type a guess, click the tiles to set the
// colors the game showed, confirm, and the entropy engine narrows the field.
import { ALL_WORDS } from '../core/words.js';
import { tilesToPattern } from '../core/feedback.js';
import { createBoard, createKeyboard, fmt, fmtInt } from './board.js';
import { solverCall } from './worker-rpc.js';

const VALID = new Set(ALL_WORDS);

let board, keyboard;
let history = [];         // confirmed {guess, pattern}
let typing = '';
let editing = null;       // { word, tiles[] } while user sets colors
let els = {};

function mode() {
  return editing ? 'colors' : 'typing';
}

function startColorEdit() {
  editing = { word: typing, tiles: [0, 0, 0, 0, 0] };
  typing = '';
  paintEditingRow();
  els.explain.innerHTML =
    `Now click the tiles of <b>${editing.word.toUpperCase()}</b> to match the colors the game showed, then press <b>Enter</b> or ✓.`;
}

function paintEditingRow() {
  board.paintRow(history.length, editing.word, editing.tiles, {
    clickable: true,
    onTileClick: (c) => {
      editing.tiles[c] = (editing.tiles[c] + 1) % 3;
      paintEditingRow();
    },
  });
}

async function confirmRow() {
  if (!editing) return;
  const pattern = tilesToPattern(editing.tiles);
  history.push({ guess: editing.word, pattern });
  board.paintRow(history.length - 1, editing.word, editing.tiles, { clickable: false });
  editing = null;
  await refresh();
}

function undoRow() {
  if (editing) {
    board.clearRow(history.length);
    editing = null;
    typing = '';
    refresh({ skipQuery: history.length === 0 });
    return;
  }
  if (history.length === 0) return;
  history.pop();
  board.clearRow(history.length);
  refresh();
}

function resetAll() {
  history = [];
  typing = '';
  editing = null;
  board.reset();
  refresh();
}

function suggestionRow(s, i) {
  return `<tr>
    <td class="word-cell" data-w="${s.word}" title="Click to use this word">${s.word}</td>
    <td class="num">${fmt(s.entropy)} bits</td>
    <td class="num">~${fmt(s.expectedRemaining, 1)}</td>
    <td class="num">${s.isCandidate ? fmt(s.winChance * 100, 1) + '%' : '-'}</td>
    <td>${i === 0 ? '<span class="gold">★ best</span>' : ''}</td>
  </tr>`;
}

async function refresh({ skipQuery = false } = {}) {
  if (skipQuery) return;
  els.suggestions.innerHTML = '<tr><td><span class="spinner"></span> analyzing…</td></tr>';
  const r = await solverCall('analyze', { history, topN: 10 });

  els.count.textContent = `${fmtInt(r.candidateCount)} candidate${r.candidateCount === 1 ? '' : 's'}`;

  if (r.candidateCount === 0) {
    els.explain.innerHTML = '⚠️ No word matches that feedback. Double-check the colors you entered.';
    els.suggestions.innerHTML = '';
    els.candidates.innerHTML = '';
    return;
  }

  const best = r.suggestions[0];
  const bitsLeft = Math.log2(Math.max(1, r.candidateCount));
  if (history.length === 0) {
    els.explain.innerHTML =
      `The field starts at <b>${fmtInt(r.candidateCount)}</b> possible answers ` +
      `(<span class="bits">${fmt(bitsLeft)} bits</span> of uncertainty). ` +
      `<b>${best.word.toUpperCase()}</b> is the highest-entropy opener: expected ` +
      `<span class="bits">${fmt(best.entropy)} bits</span>, cutting the field to ~${fmt(best.expectedRemaining, 0)} words on average.`;
  } else if (r.candidateCount === 1) {
    els.explain.innerHTML =
      `🎯 Only one word fits: <b>${r.topCandidates[0].toUpperCase()}</b>. Play it!`;
  } else {
    els.explain.innerHTML =
      `${fmtInt(r.candidateCount)} answers remain (<span class="bits">${fmt(bitsLeft)} bits</span> of uncertainty). ` +
      `Best next guess: <b>${best.word.toUpperCase()}</b> - expected <span class="bits">${fmt(best.entropy)} bits</span>` +
      `${best.isCandidate ? `, and it has a ${fmt(best.winChance * 100, 1)}% chance of being the answer itself` : ' (an information probe, not a possible answer)'}.` +
      (r.offList ? ' <em>(Target seems to be outside the official answer list, searching the full dictionary.)</em>' : '');
  }

  els.suggestions.innerHTML =
    `<tr><th>Guess</th><th>Expected info</th><th>Exp. remaining</th><th>Win now</th><th></th></tr>` +
    r.suggestions.map(suggestionRow).join('');
  els.suggestions.querySelectorAll('.word-cell').forEach((td) => {
    td.addEventListener('click', () => {
      if (mode() !== 'typing') return;
      typing = td.dataset.w;
      board.setPending(history.length, typing);
    });
  });

  const chips = r.topCandidates.map((w) => `<span class="chip">${w}</span>`).join('');
  const more = r.candidateCount > r.topCandidates.length
    ? `<span class="chip more">+ ${fmtInt(r.candidateCount - r.topCandidates.length)} more…</span>` : '';
  els.candidates.innerHTML = chips + more;
}

function onKey(k) {
  if (history.length >= 6) return;
  if (k === 'Enter') {
    if (mode() === 'colors') return void confirmRow();
    const w = typing.toLowerCase();
    if (w.length !== 5) return board.shake(history.length);
    if (!VALID.has(w)) {
      // Allow unknown words (user may play house-rule games) but warn.
      els.explain.innerHTML = `<em>"${w.toUpperCase()}" isn't in the standard word list, using it anyway.</em>`;
    }
    return void startColorEdit();
  }
  if (mode() === 'colors') return;
  if (k === 'Backspace') typing = typing.slice(0, -1);
  else if (/^[a-zA-Z]$/.test(k) && typing.length < 5) typing += k.toLowerCase();
  else return;
  board.setPending(history.length, typing);
}

export function initAssistant() {
  els.count = document.getElementById('assist-count');
  els.explain = document.getElementById('assist-explain');
  els.suggestions = document.getElementById('assist-suggestions');
  els.candidates = document.getElementById('assist-candidates');

  board = createBoard(document.getElementById('assist-board'));
  keyboard = createKeyboard(document.getElementById('assist-keyboard'), onKey);

  document.getElementById('assist-confirm').addEventListener('click', confirmRow);
  document.getElementById('assist-undo').addEventListener('click', undoRow);
  document.getElementById('assist-reset').addEventListener('click', resetAll);
  document.addEventListener('keydown', (e) => {
    if (document.getElementById('panel-assistant').classList.contains('hidden')) return;
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'Enter' || e.key === 'Backspace' || /^[a-zA-Z]$/.test(e.key)) onKey(e.key);
  });

  refresh();
}
