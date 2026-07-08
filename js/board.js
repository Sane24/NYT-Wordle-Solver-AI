// Reusable Wordle board + on-screen keyboard components.
import { patternToTiles } from '../core/feedback.js';

const CLS = ['b', 'y', 'g'];

export function createBoard(container, { rows = 6, tileClickable = false } = {}) {
  container.innerHTML = '';
  const boardEl = document.createElement('div');
  boardEl.className = 'board';
  const tiles = [];
  for (let r = 0; r < rows; r++) {
    const rowEl = document.createElement('div');
    rowEl.className = 'row';
    const rowTiles = [];
    for (let c = 0; c < 5; c++) {
      const t = document.createElement('div');
      t.className = 'tile';
      rowEl.appendChild(t);
      rowTiles.push(t);
    }
    boardEl.appendChild(rowEl);
    tiles.push(rowTiles);
  }
  container.appendChild(boardEl);

  const api = {
    el: boardEl,
    rows,
    /** Show letters in a row without colors (typing in progress). */
    setPending(r, word) {
      for (let c = 0; c < 5; c++) {
        const t = tiles[r][c];
        t.textContent = word[c] ? word[c].toUpperCase() : '';
        t.className = 'tile' + (word[c] ? ' filled' : '');
      }
    },
    /** Reveal a completed row with colors and a staggered flip. */
    setRow(r, word, pattern, { hideLetters = false, animate = true } = {}) {
      const tv = patternToTiles(pattern);
      for (let c = 0; c < 5; c++) {
        const t = tiles[r][c];
        const apply = () => {
          t.textContent = hideLetters ? '•' : word[c].toUpperCase();
          t.className = `tile filled ${CLS[tv[c]]}`;
        };
        if (animate) {
          t.classList.add('flip');
          t.style.animationDelay = `${c * 90}ms`;
          setTimeout(apply, c * 90 + 250);
        } else {
          apply();
        }
      }
    },
    /** Paint a row's colors directly (used by the assistant color editor). */
    paintRow(r, word, tileValues, { clickable = false, onTileClick = null } = {}) {
      for (let c = 0; c < 5; c++) {
        const t = tiles[r][c];
        t.textContent = word[c] ? word[c].toUpperCase() : '';
        t.className = `tile filled ${CLS[tileValues[c]]}` + (clickable ? ' clickable' : '');
        t.onclick = clickable && onTileClick ? () => onTileClick(c) : null;
      }
    },
    revealLetters(r, word) {
      for (let c = 0; c < 5; c++) tiles[r][c].textContent = word[c].toUpperCase();
    },
    shake(r) {
      const rowEl = tiles[r][0].parentElement;
      rowEl.classList.add('shake');
      setTimeout(() => rowEl.classList.remove('shake'), 450);
    },
    clearRow(r) {
      for (let c = 0; c < 5; c++) {
        const t = tiles[r][c];
        t.textContent = '';
        t.className = 'tile';
        t.onclick = null;
      }
    },
    reset() {
      for (let r = 0; r < rows; r++) api.clearRow(r);
    },
  };
  return api;
}

const KB_ROWS = ['qwertyuiop', 'asdfghjkl', '#zxcvbnm<'];

export function createKeyboard(container, onKey) {
  container.innerHTML = '';
  const kb = document.createElement('div');
  kb.className = 'kb';
  const keyEls = new Map();
  for (const rowStr of KB_ROWS) {
    const rowEl = document.createElement('div');
    rowEl.className = 'kb-row';
    for (const ch of rowStr) {
      const key = document.createElement('button');
      if (ch === '#') { key.textContent = 'ENTER'; key.className = 'key wide'; key.dataset.k = 'Enter'; }
      else if (ch === '<') { key.textContent = '⌫'; key.className = 'key wide'; key.dataset.k = 'Backspace'; }
      else { key.textContent = ch; key.className = 'key'; key.dataset.k = ch; keyEls.set(ch, key); }
      key.addEventListener('click', () => onKey(key.dataset.k));
      rowEl.appendChild(key);
    }
    kb.appendChild(rowEl);
  }
  container.appendChild(kb);

  return {
    el: kb,
    /** states: Map letter -> 0/1/2 (best seen). */
    setStates(states) {
      for (const [ch, el] of keyEls) {
        el.classList.remove('b', 'y', 'g');
        if (states.has(ch)) el.classList.add(CLS[states.get(ch)]);
      }
    },
    reset() {
      for (const el of keyEls.values()) el.classList.remove('b', 'y', 'g');
    },
  };
}

/** Track best-known state per letter across guesses, for keyboard coloring. */
export function updateKeyStates(states, guess, pattern) {
  const tv = patternToTiles(pattern);
  for (let i = 0; i < 5; i++) {
    const ch = guess[i];
    const prev = states.has(ch) ? states.get(ch) : -1;
    if (tv[i] > prev) states.set(ch, tv[i]);
  }
  return states;
}

export function fmt(n, digits = 2) {
  return Number(n).toFixed(digits);
}

export function fmtInt(n) {
  return n.toLocaleString('en-US');
}
