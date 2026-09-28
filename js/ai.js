// The computer player. findMoves() lists every legal play for a rack using the
// Appel–Jacobson method: for each anchor (an empty square touching a tile, or
// the centre on an empty board) it grows a left part out of rack tiles, then
// extends right through the trie, checking each square's cross-word letters.
// Down plays are found by the same code reading columns as lines.
import { SIZE, CENTER, RACK_SIZE, BINGO_BONUS, POINTS, ACROSS, DOWN,
  letterMultiplier, wordMultiplier } from './rules.js';

const ALL = (1 << 26) - 1;
const BLANK = 26;
const VALUE = Array.from({ length: 26 }, (_, c) => POINTS[String.fromCharCode(65 + c)]);

/**
 * Every legal play of `rack` (letters, '?' for a blank) on `board`, as
 * { placements: [{ idx, letter, blank }], score, dir }.
 */
export function findMoves(board, rack, dict) {
  const counts = new Int8Array(27);
  for (const l of rack) counts[l === '?' ? BLANK : l.charCodeAt(0) - 65]++;
  const grid = board.map((t) => (t ? t.letter.charCodeAt(0) - 65 : -1));
  const vals = board.map((t) => (t && !t.blank ? POINTS[t.letter] : 0));
  const empty = grid.every((c) => c < 0);
  const { first, next, letter, end } = dict;

  const moves = [];
  const singles = new Set();
  const check = new Int32Array(SIZE); // letters allowed by the cross word
  const crossSum = new Int32Array(SIZE); // points of the cross word's existing tiles
  const hasCross = new Uint8Array(SIZE);
  const anchor = new Uint8Array(SIZE);
  const pc = new Int8Array(SIZE); // placed letter per position on this line
  const pb = new Uint8Array(SIZE); // …and whether it's a blank
  const left = []; // left-part tiles as [code, blank], positions fixed on record

  for (const dir of [ACROSS, DOWN]) {
    const at = dir === ACROSS ? (line, pos) => line * SIZE + pos : (line, pos) => pos * SIZE + line;

    for (let line = 0; line < SIZE; line++) {
      for (let pos = 0; pos < SIZE; pos++) {
        const i = at(line, pos);
        anchor[pos] = 0;
        if (grid[i] >= 0) continue;
        if (empty) anchor[pos] = i === CENTER ? 1 : 0;
        else {
          anchor[pos] =
            (pos > 0 && grid[at(line, pos - 1)] >= 0) || (pos < SIZE - 1 && grid[at(line, pos + 1)] >= 0) ||
            (line > 0 && grid[at(line - 1, pos)] >= 0) || (line < SIZE - 1 && grid[at(line + 1, pos)] >= 0)
              ? 1 : 0;
        }
        crossCheck(line, pos);
      }

      for (let pos = 0; pos < SIZE; pos++) {
        if (!anchor[pos]) continue;
        if (pos > 0 && grid[at(line, pos - 1)] >= 0) {
          // Tiles already on the board to the left are a fixed prefix.
          let s = pos - 1;
          while (s > 0 && grid[at(line, s - 1)] >= 0) s--;
          let node = 0;
          for (let p = s; p < pos && node !== -1; p++) node = dict.child(node, grid[at(line, p)]);
          if (node !== -1) extendRight(node, pos, pos);
        } else {
          let limit = 0;
          while (pos - limit - 1 >= 0 && !anchor[pos - limit - 1] && grid[at(line, pos - limit - 1)] < 0) limit++;
          leftPart(0, pos, limit);
        }
      }

      function crossCheck(ln, pos) {
        let a = ln;
        while (a > 0 && grid[at(a - 1, pos)] >= 0) a--;
        let b = ln;
        while (b < SIZE - 1 && grid[at(b + 1, pos)] >= 0) b++;
        if (a === ln && b === ln) {
          check[pos] = ALL;
          hasCross[pos] = 0;
          crossSum[pos] = 0;
          return;
        }
        let sum = 0;
        for (let l = a; l <= b; l++) if (l !== ln) sum += vals[at(l, pos)];
        hasCross[pos] = 1;
        crossSum[pos] = sum;
        let node = 0;
        for (let l = a; l < ln && node !== -1; l++) node = dict.child(node, grid[at(l, pos)]);
        let mask = 0;
        if (node !== -1) {
          for (let n = first[node]; n !== -1; n = next[n]) {
            let m = n;
            for (let l = ln + 1; l <= b && m !== -1; l++) m = dict.child(m, grid[at(l, pos)]);
            if (m !== -1 && end[m]) mask |= 1 << letter[n];
          }
        }
        check[pos] = mask;
      }

      function leftPart(node, anchorPos, limit) {
        extendRight(node, anchorPos, anchorPos);
        if (!limit) return;
        for (let n = first[node]; n !== -1; n = next[n]) {
          const c = letter[n];
          if (counts[c]) {
            counts[c]--;
            left.push([c, 0]);
            leftPart(n, anchorPos, limit - 1);
            left.pop();
            counts[c]++;
          }
          if (counts[BLANK]) {
            counts[BLANK]--;
            left.push([c, 1]);
            leftPart(n, anchorPos, limit - 1);
            left.pop();
            counts[BLANK]++;
          }
        }
      }

      function extendRight(node, pos, anchorPos) {
        if (pos < SIZE && grid[at(line, pos)] >= 0) {
          const n = dict.child(node, grid[at(line, pos)]);
          if (n !== -1) extendRight(n, pos + 1, anchorPos);
          return;
        }
        if (pos > anchorPos && end[node]) record(pos, anchorPos);
        if (pos >= SIZE) return;
        const mask = check[pos];
        if (!mask) return;
        for (let n = first[node]; n !== -1; n = next[n]) {
          const c = letter[n];
          if (!(mask & (1 << c))) continue;
          pc[pos] = c;
          if (counts[c]) {
            counts[c]--;
            pb[pos] = 0;
            extendRight(n, pos + 1, anchorPos);
            counts[c]++;
          }
          if (counts[BLANK]) {
            counts[BLANK]--;
            pb[pos] = 1;
            extendRight(n, pos + 1, anchorPos);
            counts[BLANK]++;
          }
        }
      }

      // The word ends just before `stop`; score it and every cross word.
      function record(stop, anchorPos) {
        const k = left.length;
        for (let j = 0; j < k; j++) {
          pc[anchorPos - k + j] = left[j][0];
          pb[anchorPos - k + j] = left[j][1];
        }
        let start = anchorPos - k;
        while (start > 0 && grid[at(line, start - 1)] >= 0) start--;

        let main = 0;
        let mult = 1;
        let cross = 0;
        const placements = [];
        for (let p = start; p < stop; p++) {
          const i = at(line, p);
          if (grid[i] >= 0) {
            main += vals[i];
            continue;
          }
          const v = pb[p] ? 0 : VALUE[pc[p]] * letterMultiplier(i);
          const wm = wordMultiplier(i);
          main += v;
          mult *= wm;
          if (hasCross[p]) cross += (crossSum[p] + v) * wm;
          placements.push({ idx: i, letter: String.fromCharCode(65 + pc[p]), blank: pb[p] === 1 });
        }
        if (placements.length === 1) {
          const key = `${placements[0].idx}${placements[0].letter}${placements[0].blank}`;
          if (singles.has(key)) return;
          singles.add(key);
        }
        const bingo = placements.length === RACK_SIZE ? BINGO_BONUS : 0;
        moves.push({ placements, score: main * mult + cross + bingo, dir });
      }
    }
  }
  return moves;
}

// --- Choosing a move ---------------------------------------------------------

const VOWELS = new Set(['A', 'E', 'I', 'O', 'U']);

/** Rough worth of the tiles kept for next turn, in points. */
export function leaveValue(leave) {
  let v = 0;
  let vowels = 0;
  const seen = {};
  for (const l of leave) {
    seen[l] = (seen[l] ?? 0) + 1;
    if (l === '?') v += 7;
    else if (l === 'S') v += seen[l] === 1 ? 4 : 1;
    else if (seen[l] > 1) v -= 3;
    if ('ERTNLAID'.includes(l) && seen[l] === 1) v += 0.5;
    if (VOWELS.has(l)) vowels++;
  }
  if (seen.Q && !seen.U) v -= 6;
  const tiles = leave.length - (seen['?'] ?? 0);
  if (tiles) v -= Math.abs(vowels - tiles * 0.4) * 2;
  return v;
}

function leaveOf(rack, move) {
  const left = [...rack];
  for (const p of move.placements) left.splice(left.indexOf(p.blank ? '?' : p.letter), 1);
  return left;
}

/**
 * Picks a play for `rack` (letters) at `level`: easy aims for 35–65% of the
 * best score on offer, normal for 65–90%, hard maximises score plus leave.
 * Returns a findMoves() move, or null when nothing fits.
 */
export function chooseMove(board, rack, dict, { level = 'normal', bagCount = 100, rng = Math.random } = {}) {
  const moves = findMoves(board, rack, dict);
  if (!moves.length) return null;
  if (level === 'hard') {
    let best = null;
    for (const m of moves) {
      const leave = leaveOf(rack, m);
      m.equity = m.score + (bagCount > 0 ? leaveValue(leave) : leave.length ? 0 : 10);
      if (!best || m.equity > best.equity) best = m;
    }
    return best;
  }
  const top = moves.reduce((t, m) => Math.max(t, m.score), 0);
  const [lo, hi] = level === 'easy' ? [0.35, 0.65] : [0.65, 0.9];
  const target = top * (lo + rng() * (hi - lo));
  let gap = Infinity;
  let pool = [];
  for (const m of moves) {
    const d = Math.abs(m.score - target);
    if (d < gap) {
      gap = d;
      pool = [m];
    } else if (d === gap) pool.push(m);
  }
  return pool[Math.floor(rng() * pool.length)];
}

/** Tiles worth throwing back when there's no play: all but blanks, one S, one E. */
export function tilesToExchange(rack) {
  const keep = new Set();
  for (const want of ['?', '?', 'S', 'E']) {
    const t = rack.find((t) => t.letter === want && !keep.has(t.id));
    if (t) keep.add(t.id);
  }
  const out = rack.filter((t) => !keep.has(t.id)).map((t) => t.id);
  return out.length ? out : rack.map((t) => t.id);
}

/** Matches a move's letters to tile ids on `rack` for rules.play(). */
export function toTilePlacements(rack, move) {
  const used = new Set();
  return move.placements.map((p) => {
    const tile = rack.find((t) => !used.has(t.id) && t.letter === (p.blank ? '?' : p.letter));
    used.add(tile.id);
    return { idx: p.idx, tileId: tile.id, letter: p.letter };
  });
}
