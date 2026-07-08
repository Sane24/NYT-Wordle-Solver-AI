// Compare Solvers - run every strategy on the same target word and show the
// full reasoning trace side by side.
import { ANSWERS, ALL_WORDS } from '../core/words.js';
import { dailyWord } from '../core/daily.js';
import { CHAMPION } from '../core/champion.js';
import { createBoard, fmt, fmtInt } from './board.js';
import { solverCall } from './worker-rpc.js';

const VALID = new Set(ALL_WORDS);
let els = {};

const SOLVERS = [
  {
    key: 'entropy',
    name: '🧮 Entropy AI',
    sub: 'information theory: maximizes expected bits per guess',
    run: (answer, firstGuess) => solverCall('entropyTrace', { answer, firstGuess }),
    note: (t) => {
      const gained = Math.log2(Math.max(1, t.candidatesBefore)) - Math.log2(Math.max(1, t.candidatesAfter));
      return `<b>${t.guess.toUpperCase()}</b> - expected <span class="bits">${fmt(t.entropy ?? 0)} bits</span>, ` +
        `got <span class="bits">${fmt(gained)}</span>: ${fmtInt(t.candidatesBefore)} → ${fmtInt(t.candidatesAfter)} candidates`;
    },
  },
  {
    key: 'ga',
    name: `🧬 Evolved GA champion`,
    sub: `genetic algorithm: ${CHAMPION.traits} (gen ${CHAMPION.generation})`,
    run: (answer, firstGuess) => solverCall('gaTrace', { answer, firstGuess }),
    note: (t) =>
      `<b>${t.guess.toUpperCase()}</b> - ${t.committed ? 'committed to a possible answer' : 'probe guess (info-gathering)'}: ` +
      `${fmtInt(t.candidatesBefore)} → ${fmtInt(t.candidatesAfter)} candidates`,
  },
  {
    key: 'random',
    name: '🎲 Random baseline',
    sub: 'guesses any word consistent with the clues',
    run: (answer, firstGuess) => solverCall('randomTrace', { answer, firstGuess, seed: (Math.random() * 1e9) | 0 }),
    note: (t) =>
      `<b>${t.guess.toUpperCase()}</b> - random pick: ${fmtInt(t.candidatesBefore)} → ${fmtInt(t.candidatesAfter)} candidates`,
  },
];

async function runComparison() {
  const word = els.word.value.trim().toLowerCase();
  if (!/^[a-z]{5}$/.test(word)) {
    els.banner.className = 'banner lose';
    els.banner.classList.remove('hidden');
    els.banner.textContent = 'Enter a 5-letter target word first (or use Random / Daily).';
    return;
  }
  let opener = els.opener.value.trim().toLowerCase() || null;
  if (opener && !VALID.has(opener)) {
    els.banner.className = 'banner lose';
    els.banner.classList.remove('hidden');
    els.banner.textContent = `Opener "${opener.toUpperCase()}" isn't a legal Wordle guess.`;
    return;
  }

  els.run.disabled = true;
  els.banner.className = 'banner';
  els.banner.classList.remove('hidden');
  els.banner.innerHTML = `<span class="spinner"></span> Solvers racing to find ${word.toUpperCase()}…`;
  els.results.innerHTML = '';

  const cards = SOLVERS.map((s) => {
    const card = document.createElement('div');
    card.className = 'card cmp-card';
    card.innerHTML = `<h3>${s.name}<span class="winner-slot"></span></h3>
      <div class="cmp-meta">${s.sub}</div>
      <div class="cmp-board"></div>
      <div class="cmp-notes"><span class="spinner"></span></div>`;
    els.results.appendChild(card);
    return card;
  });

  const runs = await Promise.all(
    SOLVERS.map(async (s, i) => {
      try {
        return await s.run(word, opener);
      } catch (err) {
        cards[i].querySelector('.cmp-notes').textContent = 'Error: ' + err.message;
        return null;
      }
    })
  );

  runs.forEach((r, i) => {
    if (!r) return;
    const s = SOLVERS[i];
    const card = cards[i];
    const board = createBoard(card.querySelector('.cmp-board'), { rows: Math.max(1, Math.min(6, r.trace.length)) });
    r.trace.slice(0, 6).forEach((t, row) => {
      setTimeout(() => board.setRow(row, t.guess, t.pattern), row * 280);
    });
    card.querySelector('.cmp-notes').innerHTML = r.trace
      .map((t, k) => `<div class="turn-note">${k + 1}. ${s.note(t)}</div>`)
      .join('');
  });

  const outcome = runs.map((r, i) => ({
    name: SOLVERS[i].name,
    turns: r && r.solved ? r.turns : null,
    i,
  }));
  const solvedTurns = outcome.filter((o) => o.turns).map((o) => o.turns);
  const best = solvedTurns.length ? Math.min(...solvedTurns) : null;
  outcome.forEach((o) => {
    if (o.turns && o.turns === best) {
      cards[o.i].querySelector('.winner-slot').innerHTML = '<span class="winner-tag">fastest ✓</span>';
    }
  });
  els.banner.className = 'banner win';
  els.banner.textContent =
    `Target: ${word.toUpperCase()}  ·  ` +
    outcome.map((o) => `${o.name}: ${o.turns ? o.turns + '/6' : 'failed'}`).join('  ·  ');
  els.run.disabled = false;
}

export function initCompare() {
  els.word = document.getElementById('cmp-word');
  els.opener = document.getElementById('cmp-opener');
  els.run = document.getElementById('cmp-run');
  els.banner = document.getElementById('cmp-banner');
  els.results = document.getElementById('cmp-results');

  document.getElementById('cmp-random').addEventListener('click', () => {
    els.word.value = ANSWERS[Math.floor(Math.random() * ANSWERS.length)];
  });
  document.getElementById('cmp-daily').addEventListener('click', () => {
    els.word.value = dailyWord();
  });
  els.run.addEventListener('click', runComparison);
  els.word.addEventListener('keydown', (e) => { if (e.key === 'Enter') runComparison(); });
}
