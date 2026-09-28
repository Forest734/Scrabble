import { readFileSync } from 'node:fs';
import { Dictionary } from '../js/dictionary.js';
import { SIZE, CELLS } from '../js/rules.js';

let dict;
export function loadDictionary() {
  dict ??= Dictionary.fromText(readFileSync(new URL('../data/words.txt', import.meta.url), 'utf8'));
  return dict;
}

/** A board with `word` written from row/col in `dir`. Lowercase letters are blanks. */
export function boardWith(...words) {
  const board = Array(CELLS).fill(null);
  let id = 1000;
  for (const [word, row, col, dir] of words) {
    [...word].forEach((ch, i) => {
      const idx = dir === 'down' ? (row + i) * SIZE + col : row * SIZE + col + i;
      board[idx] = { id: id++, letter: ch.toUpperCase(), blank: ch !== ch.toUpperCase() };
    });
  }
  return board;
}

export const sq = (row, col) => row * SIZE + col;

/** Deterministic PRNG (mulberry32) for repeatable shuffles. */
export function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
