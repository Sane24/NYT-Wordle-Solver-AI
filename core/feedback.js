// Wordle feedback logic. A pattern is encoded as a base-3 integer (0..242):
// digit i (least significant first) is the tile for letter position i.
// 0 = gray (absent), 1 = yellow (present, wrong spot), 2 = green (correct).

export const GRAY = 0;
export const YELLOW = 1;
export const GREEN = 2;
export const ALL_GREEN = 242; // 2+2*3+2*9+2*27+2*81

const POW3 = [1, 3, 9, 27, 81];

/**
 * Compute the Wordle feedback pattern for `guess` against `answer`.
 * Handles duplicate letters the same way the real game does:
 * greens are marked first, then yellows consume remaining letter counts.
 */
export function computeFeedback(guess, answer) {
  const counts = new Uint8Array(26);
  const tiles = [0, 0, 0, 0, 0];
  for (let i = 0; i < 5; i++) {
    if (guess.charCodeAt(i) === answer.charCodeAt(i)) {
      tiles[i] = GREEN;
    } else {
      counts[answer.charCodeAt(i) - 97]++;
    }
  }
  for (let i = 0; i < 5; i++) {
    if (tiles[i] === GREEN) continue;
    const c = guess.charCodeAt(i) - 97;
    if (counts[c] > 0) {
      tiles[i] = YELLOW;
      counts[c]--;
    }
  }
  return tiles[0] + tiles[1] * 3 + tiles[2] * 9 + tiles[3] * 27 + tiles[4] * 81;
}

/** Decode a pattern integer into an array of 5 tile values. */
export function patternToTiles(pattern) {
  const tiles = new Array(5);
  for (let i = 0; i < 5; i++) {
    tiles[i] = Math.floor(pattern / POW3[i]) % 3;
  }
  return tiles;
}

/** Encode an array of 5 tile values into a pattern integer. */
export function tilesToPattern(tiles) {
  let p = 0;
  for (let i = 0; i < 5; i++) p += tiles[i] * POW3[i];
  return p;
}

/** "GYBBG"-style string (G=green, Y=yellow, B=gray/black) to pattern. */
export function stringToPattern(s) {
  const map = { g: GREEN, y: YELLOW, b: GRAY, x: GRAY, '-': GRAY, '0': GRAY, '1': YELLOW, '2': GREEN };
  const tiles = [];
  for (const ch of s.toLowerCase()) {
    if (ch in map) tiles.push(map[ch]);
  }
  if (tiles.length !== 5) return null;
  return tilesToPattern(tiles);
}

export function patternToString(pattern) {
  const chars = ['B', 'Y', 'G'];
  return patternToTiles(pattern).map((t) => chars[t]).join('');
}

export function patternToEmoji(pattern) {
  const chars = ['⬛', '🟨', '🟩']; // black, yellow, green squares
  return patternToTiles(pattern).map((t) => chars[t]).join('');
}

/** Filter a word list down to the words consistent with (guess, pattern). */
export function filterWords(words, guess, pattern) {
  const out = [];
  for (const w of words) {
    if (computeFeedback(guess, w) === pattern) out.push(w);
  }
  return out;
}
