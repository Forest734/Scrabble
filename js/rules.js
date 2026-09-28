// Board geometry, tiles, scoring and turn flow. Plain data and no DOM, so the
// page and the tests share it. A game is a JSON-safe object: it goes into
// localStorage as-is.

export const SIZE = 15;
export const CELLS = SIZE * SIZE;
export const CENTER = 7 * SIZE + 7;
export const RACK_SIZE = 7;
export const BINGO_BONUS = 50;
export const ACROSS = 'across';
export const DOWN = 'down';

// T triple word, D double word, t triple letter, d double letter, * start.
const LAYOUT = [
  'T..d...T...d..T',
  '.D...t...t...D.',
  '..D...d.d...D..',
  'd..D...d...D..d',
  '....D.....D....',
  '.t...t...t...t.',
  '..d...d.d...d..',
  'T..d...*...d..T',
  '..d...d.d...d..',
  '.t...t...t...t.',
  '....D.....D....',
  'd..D...d...D..d',
  '..D...d.d...D..',
  '.D...t...t...D.',
  'T..d...T...d..T',
];
const CODES = { T: 'TW', D: 'DW', t: 'TL', d: 'DL', '*': 'ST' };
export const PREMIUM = LAYOUT.join('').split('').map((ch) => CODES[ch] ?? null);

// letter: [count, points]. '?' is the blank.
export const TILES = {
  A: [9, 1], B: [2, 3], C: [2, 3], D: [4, 2], E: [12, 1], F: [2, 4], G: [3, 2],
  H: [2, 4], I: [9, 1], J: [1, 8], K: [1, 5], L: [4, 1], M: [2, 3], N: [6, 1],
  O: [8, 1], P: [2, 3], Q: [1, 10], R: [6, 1], S: [4, 1], T: [6, 1], U: [4, 1],
  V: [2, 4], W: [2, 4], X: [1, 8], Y: [2, 4], Z: [1, 10], '?': [2, 0],
};
export const POINTS = Object.fromEntries(Object.entries(TILES).map(([l, [, p]]) => [l, p]));

export const rowOf = (idx) => Math.floor(idx / SIZE);
export const colOf = (idx) => idx % SIZE;
const inside = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;

export const letterMultiplier = (idx) => (PREMIUM[idx] === 'TL' ? 3 : PREMIUM[idx] === 'DL' ? 2 : 1);
export const wordMultiplier = (idx) =>
  PREMIUM[idx] === 'TW' ? 3 : PREMIUM[idx] === 'DW' || PREMIUM[idx] === 'ST' ? 2 : 1;

/** Points for a tile: a blank on the board, or '?' on a rack, is worth 0. */
export const tileValue = (t) => (t.blank ? 0 : POINTS[t.letter]);

export function neighbors(idx) {
  const r = rowOf(idx);
  const c = colOf(idx);
  return [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]
    .filter(([rr, cc]) => inside(rr, cc))
    .map(([rr, cc]) => rr * SIZE + cc);
}

/** Cells of the unbroken run of tiles through `idx` along `dir`. */
function span(at, idx, dir) {
  const [dr, dc] = dir === ACROSS ? [0, 1] : [1, 0];
  let r = rowOf(idx);
  let c = colOf(idx);
  while (inside(r - dr, c - dc) && at((r - dr) * SIZE + c - dc)) {
    r -= dr;
    c -= dc;
  }
  const cells = [];
  while (inside(r, c) && at(r * SIZE + c)) {
    cells.push(r * SIZE + c);
    r += dr;
    c += dc;
  }
  return cells;
}

/**
 * Checks where new tiles sit and scores every word they make, without asking
 * the dictionary. `placements` is [{ idx, letter, blank }]. Returns
 * { error } or { dir, words: [{ word, cells, score }], score, bingo }.
 */
export function analyze(board, placements) {
  if (!placements.length) return { error: 'Put some tiles on the board first.' };
  const placed = new Map();
  for (const p of placements) {
    if (!(p.idx >= 0 && p.idx < CELLS) || board[p.idx] || placed.has(p.idx)) {
      return { error: 'That square is already taken.' };
    }
    placed.set(p.idx, p);
  }
  const at = (i) => placed.get(i) ?? board[i];
  const idxs = [...placed.keys()].sort((a, b) => a - b);
  const sameRow = idxs.every((i) => rowOf(i) === rowOf(idxs[0]));
  const sameCol = idxs.every((i) => colOf(i) === colOf(idxs[0]));
  if (!sameRow && !sameCol) return { error: 'Tiles must go in a single row or column.' };

  if (!board.some(Boolean)) {
    if (!placed.has(CENTER)) return { error: 'The first word must cover the centre star.' };
    if (idxs.length < 2) return { error: 'Words need at least two letters.' };
  } else if (!idxs.some((i) => neighbors(i).some((n) => board[n]))) {
    return { error: 'Your word must join onto tiles already on the board.' };
  }

  let dir;
  if (idxs.length > 1) dir = sameRow ? ACROSS : DOWN;
  else dir = span(at, idxs[0], ACROSS).length > 1 ? ACROSS : DOWN;
  const step = dir === ACROSS ? 1 : SIZE;
  for (let i = idxs[0]; i <= idxs.at(-1); i += step) {
    if (!at(i)) return { error: 'Your tiles must make one unbroken word.' };
  }

  const runs = [];
  const main = span(at, idxs[0], dir);
  if (main.length > 1) runs.push(main);
  const cross = dir === ACROSS ? DOWN : ACROSS;
  for (const i of idxs) {
    const run = span(at, i, cross);
    if (run.length > 1) runs.push(run);
  }
  if (!runs.length) return { error: 'Words need at least two letters.' };

  const words = runs.map((cells) => {
    let sum = 0;
    let mult = 1;
    for (const i of cells) {
      let v = tileValue(at(i));
      if (placed.has(i)) {
        v *= letterMultiplier(i);
        mult *= wordMultiplier(i);
      }
      sum += v;
    }
    return { word: cells.map((i) => at(i).letter).join(''), cells, score: sum * mult };
  });
  const bingo = placements.length === RACK_SIZE;
  const score = words.reduce((s, w) => s + w.score, 0) + (bingo ? BINGO_BONUS : 0);
  return { dir, words, score, bingo };
}

/** analyze(), plus every word must be in the dictionary. */
export function validate(board, placements, dict) {
  const result = analyze(board, placements);
  if (result.error) return result;
  const invalid = result.words.filter((w) => !dict.has(w.word)).map((w) => w.word);
  if (invalid.length) return { ...result, error: `Not in the word list: ${invalid.join(', ')}`, invalid };
  return result;
}

// --- Game flow ---------------------------------------------------------------

export function shuffle(list, rng = Math.random) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/** players: [{ name, kind: 'human' | 'computer', level?: 'easy' | 'normal' | 'hard' }] */
export function newGame(players, rng = Math.random) {
  const bag = [];
  let id = 0;
  for (const [letter, [count]] of Object.entries(TILES)) {
    for (let i = 0; i < count; i++) bag.push({ id: id++, letter });
  }
  shuffle(bag, rng);
  const game = {
    board: Array(CELLS).fill(null),
    bag,
    players: players.map((p) => ({
      name: p.name,
      kind: p.kind,
      level: p.level ?? 'normal',
      score: 0,
      rack: [],
    })),
    turn: 0,
    scoreless: 0,
    moves: [],
    over: false,
    result: null,
  };
  for (const p of game.players) draw(game, p);
  return game;
}

function draw(game, player) {
  while (player.rack.length < RACK_SIZE && game.bag.length) player.rack.push(game.bag.pop());
}

const scorelessLimit = (game) => Math.max(6, 2 * game.players.length);

function nextTurn(game) {
  if (game.scoreless >= scorelessLimit(game)) finish(game, null);
  else game.turn = (game.turn + 1) % game.players.length;
}

/** Ends the game. `outIdx` is the player who used their last tile, if any. */
function finish(game, outIdx) {
  const leftovers = game.players.map((p) => p.rack.reduce((s, t) => s + tileValue(t), 0));
  game.players.forEach((p, i) => {
    p.score -= leftovers[i];
  });
  if (outIdx !== null) game.players[outIdx].score += leftovers.reduce((a, b) => a + b, 0);
  const top = Math.max(...game.players.map((p) => p.score));
  game.over = true;
  game.result = {
    out: outIdx,
    leftovers,
    winners: game.players.flatMap((p, i) => (p.score === top ? [i] : [])),
  };
}

/**
 * Plays tiles from the current player's rack. `placements` is
 * [{ idx, tileId, letter? }], where `letter` names what a blank stands for.
 * Returns the validate() result; the game only changes if it has no error.
 */
export function play(game, placements, dict) {
  if (game.over) return { error: 'The game is over.' };
  const player = game.players[game.turn];
  const tiles = [];
  for (const p of placements) {
    const tile = player.rack.find((t) => t.id === p.tileId);
    if (!tile || tiles.some((t) => t.id === tile.id)) return { error: 'That tile isn’t on your rack.' };
    const blank = tile.letter === '?';
    const letter = blank ? String(p.letter ?? '').toUpperCase() : tile.letter;
    if (!/^[A-Z]$/.test(letter)) return { error: 'Choose a letter for the blank tile.' };
    tiles.push({ idx: p.idx, id: tile.id, letter, blank });
  }
  const result = validate(game.board, tiles, dict);
  if (result.error) return result;

  for (const t of tiles) game.board[t.idx] = { id: t.id, letter: t.letter, blank: t.blank };
  player.rack = player.rack.filter((t) => !tiles.some((p) => p.id === t.id));
  player.score += result.score;
  draw(game, player);
  game.moves.push({
    player: game.turn,
    type: 'play',
    words: result.words.map((w) => w.word),
    score: result.score,
    bingo: result.bingo,
    cells: tiles.map((t) => t.idx),
  });
  game.scoreless = result.score > 0 ? 0 : game.scoreless + 1;
  // An empty rack after drawing means the bag is empty too.
  if (!player.rack.length) finish(game, game.turn);
  else nextTurn(game);
  return result;
}

export function exchange(game, tileIds, rng = Math.random) {
  if (game.over) return { error: 'The game is over.' };
  if (game.bag.length < RACK_SIZE) {
    return { error: `You can only exchange while the bag holds at least ${RACK_SIZE} tiles.` };
  }
  const player = game.players[game.turn];
  const out = player.rack.filter((t) => tileIds.includes(t.id));
  if (!out.length) return { error: 'Pick at least one tile to exchange.' };
  player.rack = player.rack.filter((t) => !tileIds.includes(t.id));
  draw(game, player);
  game.bag.push(...out);
  shuffle(game.bag, rng);
  game.moves.push({ player: game.turn, type: 'exchange', count: out.length, score: 0 });
  game.scoreless++;
  nextTurn(game);
  return { ok: true };
}

export function pass(game) {
  if (game.over) return { error: 'The game is over.' };
  game.moves.push({ player: game.turn, type: 'pass', score: 0 });
  game.scoreless++;
  nextTurn(game);
  return { ok: true };
}

/** Tiles `viewer` can't see: the full set minus the board and their own rack. */
export function unseen(game, viewer) {
  const left = Object.fromEntries(Object.entries(TILES).map(([l, [n]]) => [l, n]));
  for (const t of game.board) if (t) left[t.blank ? '?' : t.letter]--;
  if (viewer != null) for (const t of game.players[viewer].rack) left[t.letter]--;
  return left;
}
