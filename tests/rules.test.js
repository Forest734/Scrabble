import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PREMIUM, TILES, CENTER, analyze, validate, newGame, play, exchange, pass, unseen,
} from '../js/rules.js';
import { loadDictionary, boardWith, sq, seeded } from './helpers.js';

const dict = loadDictionary();
const tiles = (word, row, col, dir = 'across') =>
  [...word].map((ch, i) => ({
    idx: dir === 'down' ? sq(row + i, col) : sq(row, col + i),
    letter: ch.toUpperCase(),
    blank: ch !== ch.toUpperCase(),
  }));

test('the board has the standard premium squares', () => {
  const count = (code) => PREMIUM.filter((p) => p === code).length;
  assert.equal(count('TW'), 8);
  assert.equal(count('DW'), 16);
  assert.equal(count('TL'), 12);
  assert.equal(count('DL'), 24);
  assert.equal(PREMIUM[CENTER], 'ST');
});

test('the bag holds 100 tiles, two of them blank', () => {
  const total = Object.values(TILES).reduce((s, [n]) => s + n, 0);
  assert.equal(total, 100);
  const game = newGame([{ name: 'A', kind: 'human' }, { name: 'B', kind: 'human' }], seeded(1));
  assert.equal(game.bag.length, 86);
  assert.equal(game.players[0].rack.length, 7);
});

test('the dictionary knows real words and rejects others', () => {
  assert.ok(dict.has('quixotic'));
  assert.ok(dict.has('QI'));
  assert.ok(dict.has('za'));
  assert.ok(!dict.has('qzx'));
  assert.ok(!dict.has('a'));
});

test('first move doubles on the star', () => {
  // C(3) A(1) T(1) across the centre: (3+1+1) × 2
  const r = analyze(boardWith(), tiles('CAT', 7, 6));
  assert.equal(r.score, 10);
  assert.deepEqual(r.words.map((w) => w.word), ['CAT']);
});

test('first move must cover the centre and be two letters', () => {
  assert.match(analyze(boardWith(), tiles('CAT', 0, 0)).error, /centre/);
  assert.match(analyze(boardWith(), tiles('A', 7, 7)).error, /two letters/);
});

test('tiles must be in a line, unbroken, and connected', () => {
  const board = boardWith(['CAT', 7, 6, 'across']);
  assert.match(analyze(board, [...tiles('A', 6, 6), ...tiles('B', 8, 9)]).error, /single row/);
  assert.match(analyze(board, tiles('DOG', 0, 0)).error, /join/);
  assert.match(analyze(board, [...tiles('S', 6, 7), ...tiles('S', 9, 7)]).error, /unbroken/);
});

test('cross words are scored and premiums only count for new tiles', () => {
  // Hooking S onto CAT: (7,9) is a plain square and the star is already used.
  const board = boardWith(['CAT', 7, 6, 'across']);
  const r = analyze(board, tiles('S', 7, 9));
  assert.deepEqual(r.words.map((w) => w.word), ['CATS']);
  assert.equal(r.score, 6);
});

test('a parallel play scores every word it forms', () => {
  // HE at row 7 cols 7–8; AX underneath makes AX, plus HA and EX down.
  const board = boardWith(['HE', 7, 7, 'across']);
  const r = validate(board, tiles('AX', 8, 7), dict);
  assert.equal(r.error, undefined);
  const words = r.words.map((w) => w.word).sort();
  assert.deepEqual(words, ['AX', 'EX', 'HA']);
  // (8,8) is a DL, so the X is worth 16 in both AX and EX.
  assert.equal(r.score, 17 + 5 + 17);
});

test('blanks score zero and bingos add 50', () => {
  // analyze() doesn't consult the dictionary, so any seven letters will do.
  const r = analyze(boardWith(), tiles('quIXOTI', 7, 1));
  assert.ok(r.bingo);
  assert.equal(r.words[0].word, 'QUIXOTI');
  // Q,U blank = 0; I(1) X(8) O(1) T(1) I(1); (7,3) is DL → I doubled, (7,7) star ×2
  assert.equal(r.score, (0 + 0 + 2 + 8 + 1 + 1 + 1) * 2 + 50);
});

test('validate reports words missing from the list', () => {
  const r = validate(boardWith(), tiles('QZX', 7, 6), dict);
  assert.match(r.error, /QZX/);
});

test('play moves tiles, scores, refills the rack and passes the turn', () => {
  const game = newGame([{ name: 'A', kind: 'human' }, { name: 'B', kind: 'human' }], seeded(7));
  const rack = game.players[0].rack;
  rack.splice(0, 3, { id: 900, letter: 'C' }, { id: 901, letter: 'A' }, { id: 902, letter: 'T' });
  const r = play(game, [
    { idx: sq(7, 6), tileId: 900 }, { idx: sq(7, 7), tileId: 901 }, { idx: sq(7, 8), tileId: 902 },
  ], dict);
  assert.equal(r.score, 10);
  assert.equal(game.players[0].score, 10);
  assert.equal(game.players[0].rack.length, 7);
  assert.equal(game.turn, 1);
  assert.equal(game.board[sq(7, 7)].letter, 'A');
});

test('a rejected play leaves the game untouched', () => {
  const game = newGame([{ name: 'A', kind: 'human' }, { name: 'B', kind: 'human' }], seeded(7));
  const before = JSON.stringify(game);
  const [t1, t2] = game.players[0].rack;
  play(game, [{ idx: 0, tileId: t1.id }, { idx: 1, tileId: t2.id }], dict);
  assert.equal(JSON.stringify(game), before);
});

test('exchange swaps tiles and needs seven in the bag', () => {
  const game = newGame([{ name: 'A', kind: 'human' }, { name: 'B', kind: 'human' }], seeded(3));
  const ids = game.players[0].rack.slice(0, 3).map((t) => t.id);
  assert.ok(exchange(game, ids, seeded(4)).ok);
  assert.equal(game.players[0].rack.length, 7);
  assert.equal(game.bag.length, 86);
  game.bag.length = 6;
  assert.match(exchange(game, [game.players[1].rack[0].id]).error, /at least 7/);
});

test('six scoreless turns end the game and subtract racks', () => {
  const game = newGame([{ name: 'A', kind: 'human' }, { name: 'B', kind: 'human' }], seeded(5));
  for (let i = 0; i < 6; i++) pass(game);
  assert.ok(game.over);
  const [a, b] = game.players;
  assert.equal(a.score, -game.result.leftovers[0]);
  assert.equal(b.score, -game.result.leftovers[1]);
});

test('going out collects the other racks', () => {
  const game = newGame([{ name: 'A', kind: 'human' }, { name: 'B', kind: 'human' }], seeded(5));
  game.bag.length = 0;
  game.players[0].rack = [{ id: 900, letter: 'Q' }, { id: 901, letter: 'I' }];
  game.players[1].rack = [{ id: 902, letter: 'Z' }, { id: 903, letter: 'E' }];
  play(game, [{ idx: sq(7, 7), tileId: 900 }, { idx: sq(7, 8), tileId: 901 }], dict);
  assert.ok(game.over);
  assert.equal(game.result.out, 0);
  assert.equal(game.players[0].score, 22 + 11); // QI on the star, plus Z+E
  assert.equal(game.players[1].score, -11);
  assert.deepEqual(game.result.winners, [0]);
});

test('unseen counts the tiles a player cannot see', () => {
  const game = newGame([{ name: 'A', kind: 'human' }, { name: 'B', kind: 'human' }], seeded(9));
  const left = unseen(game, 0);
  assert.equal(Object.values(left).reduce((a, b) => a + b, 0), 93);
});
