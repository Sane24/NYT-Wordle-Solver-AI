// Evolution Lab - a live visualization of the genetic algorithm.
// Top: a 10x10 arena where the current population plays real games against a
// rotating target word. Below: each dot is an agent; the cloud drifts toward
// fewer guesses / higher solve rate as selection does its work.
import { GENE_DEFS, AgentSolver, randomGenome, makeRng } from '../core/genetic.js';
import { ANSWERS } from '../core/words.js';
import { computeFeedback, patternToTiles, ALL_GREEN } from '../core/feedback.js';
import { fmt, fmtInt } from './board.js';

const W = 820, H = 460, PAD = 46;

// Piecewise axes so the converged cluster stays spread out:
// most of the plot is devoted to the interesting range, the rest is compressed.
const X_MIN = 2.8, X_BREAK = 4.6, X_MAX = 8.3, X_FRAC = 0.75; // avg guesses
const Y_BREAK = 0.75, Y_FRAC = 0.78;                          // solve rate: 75-100% zoomed

let worker = null;
let dots = new Map();                // id -> dot
let running = false;
let stepPending = false;
let stepTimer = null;
let generation = 0;
let history = [];
let els = {};
let ctx, chartCtx;
let lastReport = null;

function xOf(avg) {
  const a = Math.min(Math.max(avg, X_MIN), X_MAX);
  const inner = W - PAD * 2;
  if (a <= X_BREAK) return PAD + ((a - X_MIN) / (X_BREAK - X_MIN)) * inner * X_FRAC;
  return PAD + inner * X_FRAC + ((a - X_BREAK) / (X_MAX - X_BREAK)) * inner * (1 - X_FRAC);
}

function yOf(rate) {
  const r = Math.min(Math.max(rate, 0), 1);
  const inner = H - PAD * 2;
  if (r >= Y_BREAK) return PAD + ((1 - r) / (1 - Y_BREAK)) * inner * Y_FRAC;
  return PAD + inner * Y_FRAC + ((Y_BREAK - r) / Y_BREAK) * inner * (1 - Y_FRAC);
}

function speedScale() {
  return 5 / Number(els.speed.value); // speed 10 => 0.5x duration
}

function jitter(id, k, amp = 14) {
  // deterministic per-agent jitter so dots don't stack perfectly
  const h = Math.imul(id + 1, 2654435761) >>> 0;
  return (((h >> k) & 255) / 255 - 0.5) * amp;
}

function ensureWorker() {
  if (worker) worker.terminate();
  worker = new Worker(new URL('./ga-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    if (e.data.type === 'report') onReport(e.data.report);
    else if (e.data.type === 'error') {
      console.error(e.data.error);
      setRunning(false);
    }
  };
  worker.postMessage({
    type: 'init',
    payload: {
      populationSize: Number(document.querySelector('#evo-pop .on').dataset.v),
      gamesPerAgent: Number(document.querySelector('#evo-games .on').dataset.v),
    },
  });
}

function requestStep() {
  if (stepPending || !worker) return;
  stepPending = true;
  worker.postMessage({ type: 'step' });
}

/** Chain the next step off a timer (works even when the tab is hidden). */
function scheduleNextStep() {
  clearTimeout(stepTimer);
  if (!running) return;
  stepTimer = setTimeout(requestStep, 1500 * speedScale());
}

function onReport(report) {
  stepPending = false;
  lastReport = report;
  generation = report.generation;
  history = report.history;
  els.gen.textContent = generation;

  const seen = new Set();
  for (const a of report.agents) {
    seen.add(a.id);
    let d = dots.get(a.id);
    const tx = xOf(a.avgGuesses) + jitter(a.id, 3);
    // solve rate is quantized (k / gamesPerAgent), so spread each row vertically
    const ty = yOf(a.solveRate) + jitter(a.id, 11, 22);
    if (!d) {
      // Newborn: spawn from midpoint of parents (or center for immigrants).
      let sx = W / 2, sy = H / 2;
      const [pa, pb] = a.parents || [];
      const dpa = dots.get(pa), dpb = dots.get(pb);
      if (dpa && dpb) { sx = (dpa.x + dpb.x) / 2; sy = (dpa.y + dpb.y) / 2; }
      else if (dpa) { sx = dpa.x; sy = dpa.y; }
      d = { x: sx, y: sy, alpha: 0, flash: 1 };
      dots.set(a.id, d);
    }
    d.tx = tx; d.ty = ty;
    d.targetAlpha = 1;
    d.status = a.status;
    d.rank = a.rank;
    d.opener = a.opener;
    d.falling = false;
  }
  // Agents not in this report were culled last generation: fade & fall.
  for (const [id, d] of dots) {
    if (!seen.has(id)) {
      d.targetAlpha = 0;
      d.falling = true;
    }
  }

  renderChart();
  renderLeaderboard(report);
  renderChampion(report.champion);
  scheduleNextStep();
}

function setRunning(on) {
  running = on;
  els.start.textContent = on ? '⏸ Pause' : '▶ Start evolution';
  clearTimeout(stepTimer);
  if (on) requestStep();
}

// ------------------------------------------------------------------ arena ---
// A live 10x10 grid of agents from the current population, all playing the
// same target word. Purely illustrative; fitness is computed in the worker.

const ARENA_W = 820, ARENA_H = 350;
const ARENA_COLS = 10, ARENA_MAX = 100;
const CELL_W = ARENA_W / ARENA_COLS, CELL_H = 34, TILE = 12, TILE_GAP = 2;

let arenaCtx = null;
let arenaAgents = [];
let arenaTarget = '';
let arenaTurn = 0;
let arenaRound = 0;
let arenaTimer = null;
const arenaRng = makeRng(97531);
let arenaFallbackGenomes = null; // random population before evolution starts

function arenaGenomes() {
  if (lastReport) return lastReport.agents.slice(0, ARENA_MAX).map((a) => a.genome);
  if (!arenaFallbackGenomes) {
    arenaFallbackGenomes = [];
    for (let i = 0; i < ARENA_MAX; i++) arenaFallbackGenomes.push(randomGenome(arenaRng));
  }
  return arenaFallbackGenomes;
}

function startArenaRound() {
  arenaRound++;
  arenaTurn = 0;
  arenaTarget = ANSWERS[Math.floor(arenaRng() * ANSWERS.length)];
  arenaAgents = arenaGenomes().map((g) => ({
    solver: new AgentSolver(g),
    lastGuess: null,
    lastPattern: null,
    solved: false,
    failed: false,
    flash: 0,
  }));
  els.arenaTarget.textContent = arenaTarget;
  els.arenaRound.textContent = `round ${arenaRound}` + (lastReport ? ` · gen ${generation}` : ' · random start');
  els.arenaTotal.textContent = arenaAgents.length;
  els.arenaTurn.textContent = '0';
  els.arenaSolved.textContent = '0';
}

function arenaStep() {
  clearTimeout(arenaTimer);
  // Skip the work (but keep the loop alive) while the tab is elsewhere.
  if (document.getElementById('panel-evolution').classList.contains('hidden')) {
    arenaTimer = setTimeout(arenaStep, 1000);
    return;
  }

  const done = arenaAgents.every((a) => a.solved || a.failed);
  if (done || arenaTurn >= 6) {
    startArenaRound();
    arenaTimer = setTimeout(arenaStep, 900 * speedScale());
    return;
  }

  for (const a of arenaAgents) {
    if (a.solved || a.failed) continue;
    const move = a.solver.nextGuess();
    const pattern = computeFeedback(move.word, arenaTarget);
    a.solver.observe(move.word, pattern);
    a.lastGuess = move.word;
    a.lastPattern = pattern;
    a.flash = 1;
    if (pattern === ALL_GREEN) a.solved = true;
    else if (arenaTurn + 1 >= 6) a.failed = true;
  }
  arenaTurn++;
  els.arenaTurn.textContent = arenaTurn;
  els.arenaSolved.textContent = arenaAgents.filter((a) => a.solved).length;

  const allDone = arenaAgents.every((a) => a.solved || a.failed);
  arenaTimer = setTimeout(arenaStep, (allDone ? 1800 : 850) * speedScale());
}

const TILE_COLORS = ['#3a3a3c', '#b59f3b', '#538d4e']; // gray, yellow, green

function drawArena(dt) {
  const c = arenaCtx;
  c.clearRect(0, 0, ARENA_W, ARENA_H);
  const rows = Math.ceil(arenaAgents.length / ARENA_COLS);
  const topPad = Math.max(0, (ARENA_H - rows * CELL_H) / 2);
  const rowW = 5 * (TILE + TILE_GAP) - TILE_GAP;

  arenaAgents.forEach((a, i) => {
    const col = i % ARENA_COLS, row = Math.floor(i / ARENA_COLS);
    const x0 = col * CELL_W + (CELL_W - rowW) / 2;
    const y0 = topPad + row * CELL_H + (CELL_H - TILE) / 2;
    a.flash = Math.max(0, a.flash - dt * 2);

    if (!a.lastGuess) {
      c.strokeStyle = '#2c2c2e';
      for (let t = 0; t < 5; t++) {
        c.strokeRect(x0 + t * (TILE + TILE_GAP) + 0.5, y0 + 0.5, TILE - 1, TILE - 1);
      }
      return;
    }

    const tiles = patternToTiles(a.lastPattern);
    const dim = a.failed ? 0.35 : 1;
    for (let t = 0; t < 5; t++) {
      const tx = x0 + t * (TILE + TILE_GAP);
      c.globalAlpha = dim;
      c.fillStyle = TILE_COLORS[tiles[t]];
      c.fillRect(tx, y0, TILE, TILE);
      if (a.flash > 0) {
        c.globalAlpha = a.flash * 0.35 * dim;
        c.fillStyle = '#ffffff';
        c.fillRect(tx, y0, TILE, TILE);
      }
      c.globalAlpha = dim;
      c.fillStyle = '#fff';
      c.font = 'bold 9px sans-serif';
      c.textAlign = 'center';
      c.fillText(a.lastGuess[t].toUpperCase(), tx + TILE / 2, y0 + TILE - 3);
    }
    c.globalAlpha = 1;
    if (a.solved) {
      c.strokeStyle = '#e8c34a';
      c.lineWidth = 1.5;
      c.strokeRect(x0 - 3, y0 - 3, rowW + 6, TILE + 6);
    }
  });
  c.globalAlpha = 1;
}

// ------------------------------------------------------------- rendering ---

function drawAxes() {
  ctx.clearRect(0, 0, W, H);
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  for (const g of [3, 3.5, 4, 4.5, 5, 6, 7, 8]) {
    const x = xOf(g);
    ctx.strokeStyle = g > X_BREAK ? '#202024' : '#26262a';
    ctx.beginPath(); ctx.moveTo(x, PAD - 14); ctx.lineTo(x, H - PAD + 8); ctx.stroke();
    ctx.fillStyle = '#77777d';
    ctx.fillText(g === 8 ? 'fail' : `${g}`, x, H - PAD + 22);
  }
  ctx.fillText('average guesses  (← better)', W / 2, H - 8);
  ctx.textAlign = 'right';
  for (const r of [1, 0.95, 0.9, 0.85, 0.8, 0.75, 0.5, 0.25]) {
    const y = yOf(r);
    ctx.strokeStyle = r < Y_BREAK ? '#202024' : '#26262a';
    ctx.beginPath(); ctx.moveTo(PAD - 6, y); ctx.lineTo(W - PAD + 10, y); ctx.stroke();
    ctx.fillStyle = '#77777d';
    ctx.fillText(`${Math.round(r * 100)}%`, PAD - 10, y + 3);
  }
  // dashed dividers where the axes switch to the compressed scale
  ctx.strokeStyle = '#3a3a3e';
  ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(xOf(X_BREAK), PAD - 14); ctx.lineTo(xOf(X_BREAK), H - PAD + 8); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(PAD - 6, yOf(Y_BREAK)); ctx.lineTo(W - PAD + 10, yOf(Y_BREAK)); ctx.stroke();
  ctx.setLineDash([]);

  ctx.save();
  ctx.translate(12, H / 2); ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#77777d';
  ctx.fillText('solve rate (↑ better, zoomed above 75%)', 0, 0);
  ctx.restore();
}

function drawDots(dt) {
  let bestDot = null;
  for (const [id, d] of dots) {
    // movement
    const k = 1 - Math.pow(0.0015, dt);
    if (d.falling) { d.ty = (d.ty ?? d.y) + 140 * dt; d.tx = d.tx ?? d.x; }
    d.x += ((d.tx ?? d.x) - d.x) * k;
    d.y += ((d.ty ?? d.y) - d.y) * k;
    d.alpha += ((d.targetAlpha ?? 1) - d.alpha) * (1 - Math.pow(0.001, dt));
    d.flash = Math.max(0, (d.flash ?? 0) - dt * 1.5);
    if (d.alpha < 0.02 && d.targetAlpha === 0) { dots.delete(id); continue; }

    let fill, r = 4.5;
    if (d.falling) fill = `rgba(208,86,79,${d.alpha * 0.9})`;
    else if (d.status === 'elite') { fill = `rgba(232,195,74,${d.alpha})`; r = 6; }
    else if (d.status === 'died') fill = `rgba(150,90,90,${d.alpha * 0.75})`;
    else fill = `rgba(106,170,100,${d.alpha * 0.9})`;

    ctx.beginPath();
    ctx.arc(d.x, d.y, r + d.flash * 5, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    if (d.status === 'elite' && !d.falling) {
      ctx.strokeStyle = `rgba(232,195,74,${d.alpha})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(d.x, d.y, r + 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (d.rank === 0 && !d.falling) bestDot = d;
  }
  if (bestDot) {
    ctx.fillStyle = '#e8c34a';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`★ best: ${(bestDot.opener || '').toUpperCase()}`, bestDot.x + 12, bestDot.y - 8);
  }
}

let lastT = 0;
function frame(t) {
  const dt = Math.min(0.05, (t - lastT) / 1000 || 0.016);
  lastT = t;
  drawAxes();
  drawDots(dt);
  drawArena(dt);
  requestAnimationFrame(frame);
}

function renderChart() {
  const c = chartCtx, w = 380, h = 200, pad = 30;
  c.clearRect(0, 0, w, h);
  if (history.length < 1) return;
  const n = history.length;
  const x = (i) => pad + (i / Math.max(1, n - 1)) * (w - pad - 10);
  const gMin = 3, gMax = 8;
  const yG = (v) => (h - pad) - ((Math.min(v, gMax) - gMin) / (gMax - gMin)) * (h - pad - 12);
  const yR = (v) => (h - pad) - v * (h - pad - 12);

  c.strokeStyle = '#26262a';
  c.fillStyle = '#77777d';
  c.font = '10px sans-serif';
  c.textAlign = 'right';
  for (let g = 3; g <= 8; g++) {
    c.beginPath(); c.moveTo(pad, yG(g)); c.lineTo(w - 10, yG(g)); c.stroke();
    c.fillText(String(g), pad - 4, yG(g) + 3);
  }
  c.textAlign = 'center';
  c.fillText('generation', w / 2, h - 4);

  const line = (key, color, yFn) => {
    c.strokeStyle = color;
    c.lineWidth = 2;
    c.beginPath();
    history.forEach((p, i) => {
      const yy = yFn(p[key]);
      i === 0 ? c.moveTo(x(i), yy) : c.lineTo(x(i), yy);
    });
    c.stroke();
  };
  line('meanAvgGuesses', '#5b8dd6', yG);
  line('bestAvgGuesses', '#e8c34a', yG);
  line('bestSolveRate', '#538d4e', yR);
}

function renderLeaderboard(report) {
  const rows = report.agents.slice(0, 8).map((a, i) => `<tr>
    <td class="num">${i + 1}</td>
    <td class="num">#${a.id}</td>
    <td class="word-cell">${a.opener}</td>
    <td class="word-cell">${a.secondGuess || '-'}</td>
    <td class="num">${a.solveRate > 0 ? fmt(a.avgGuesses) : '-'}</td>
    <td class="num">${fmt(a.solveRate * 100, 0)}%</td>
    <td>${a.status === 'elite' ? '<span class="gold">elite</span>' : a.status}</td>
    <td>${a.traits}</td>
  </tr>`).join('');
  els.leaderboard.innerHTML =
    `<tr><th>#</th><th>Agent</th><th>Opener</th><th>Typical 2nd</th><th>Avg guesses</th><th>Solve rate</th><th>Fate</th><th>Strategy traits</th></tr>` + rows;
}

function renderChampion(champ) {
  if (!champ) return;
  const bars = GENE_DEFS.map((d) => {
    const v = champ.genome[d.key];
    const p = ((v - d.min) / (d.max - d.min)) * 100;
    return `<div class="gene-bar">
      <span class="gene-label" title="${d.desc}">${d.label}</span>
      <span class="bar"><i style="width:${p.toFixed(0)}%"></i></span>
      <span class="gene-val">${d.int ? v : fmt(v, 2)}</span>
    </div>`;
  }).join('');
  els.champion.innerHTML = `
    <div class="opener">${champ.opener}</div>
    <div>avg <b>${fmt(champ.avgGuesses)}</b> guesses · <b>${fmt(champ.solveRate * 100, 0)}%</b> solved · found in generation <b>${champ.generation}</b></div>
    <div style="color:var(--muted);margin:4px 0 10px">${champ.traits}</div>
    ${bars}`;
}

function reset() {
  setRunning(false);
  dots.clear();
  history = [];
  lastReport = null;
  generation = 0;
  arenaFallbackGenomes = null;
  arenaRound = 0;
  els.gen.textContent = '0';
  els.leaderboard.innerHTML = '';
  els.champion.innerHTML = '<em>Run evolution to crown a champion.</em>';
  chartCtx.clearRect(0, 0, 380, 200);
  ensureWorker();
  startArenaRound();
}

export function initEvolution() {
  els.gen = document.getElementById('evo-gen');
  els.start = document.getElementById('evo-start');
  els.speed = document.getElementById('evo-speed');
  els.leaderboard = document.getElementById('evo-leaderboard');
  els.champion = document.getElementById('evo-champion');
  els.arenaTarget = document.getElementById('arena-target');
  els.arenaRound = document.getElementById('arena-round');
  els.arenaTurn = document.getElementById('arena-turn');
  els.arenaSolved = document.getElementById('arena-solved');
  els.arenaTotal = document.getElementById('arena-total');

  const canvas = document.getElementById('evo-canvas');
  const chart = document.getElementById('evo-chart');
  const arena = document.getElementById('arena-canvas');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = W * dpr; canvas.height = H * dpr;
  chart.width = 380 * dpr; chart.height = 200 * dpr;
  arena.width = ARENA_W * dpr; arena.height = ARENA_H * dpr;
  ctx = canvas.getContext('2d');
  chartCtx = chart.getContext('2d');
  arenaCtx = arena.getContext('2d');
  ctx.scale(dpr, dpr);
  chartCtx.scale(dpr, dpr);
  arenaCtx.scale(dpr, dpr);

  for (const segId of ['evo-pop', 'evo-games']) {
    document.getElementById(segId).addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      e.currentTarget.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      reset();
    });
  }
  els.start.addEventListener('click', () => setRunning(!running));
  document.getElementById('evo-reset').addEventListener('click', reset);

  ensureWorker();
  startArenaRound();
  arenaTimer = setTimeout(arenaStep, 800);
  requestAnimationFrame(frame);
}
