import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findMoves, chooseMove, toTilePlacements, tilesToExchange, leaveValue } from '../js/ai.js';
import { validate, newGame, play, exchange, pass, CENTER, RACK_SIZE } from '../js/rules.js';
import { loadDictionary, boardWith, seeded } from './helpers.js';

const dict = loadDictionary();

/** Every generated move is legal and scored exactly as the rules score it. */
function assertAllLegal(board, rack) {
  const moves = findMoves(board, rack, dict);
  for (const m of moves) {
    const r = validate(board, m.placements, dict);
    assert.equal(r.error, undefined, `${JSON.stringify(m.placements)}: ${r.error}`);
    assert.equal(m.score, r.score, `score of ${r.words.map((w) => w.word)}`);
  }
  return moves;
}

test('opening moves all cover the centre', () => {
  const moves = assertAllLegal(boardWith(), [...'RETAINS']);
  assert.ok(moves.length > 100);
  assert.ok(moves.every((m) => m.placements.some((p) => p.idx === CENTER)));
  // RETAINS has several seven-letter anagrams, so the best play is a bingo.
  const best = moves.reduce((a, b) => (b.score > a.score ? b : a));
  assert.equal(best.placements.length, 7);
  assert.ok(best.score >= 50 + 14);
});

test('moves around existing tiles are legal, including blanks', () => {
  const board = boardWith(['QUIZ', 7, 5, 'across'], ['ZEBRA', 7, 8, 'down'], ['bRAVE', 11, 6, 'across']);
  const moves = assertAllLegal(board, [...'AE?STLN']);
  assert.ok(moves.some((m) => m.placements.some((p) => p.blank)));
});

test('the same single-tile play is not listed twice', () => {
  const moves = findMoves(boardWith(['AT', 7, 7, 'across']), ['S'], dict);
  const keys = moves.map((m) => m.placements.map((p) => p.idx + p.letter).join());
  assert.equal(new Set(keys).size, keys.length);
});

test('no tiles that fit means no moves', () => {
  assert.deepEqual(findMoves(boardWith(), [...'QQQ'], dict), []);
});

test('leave value prefers blanks and balance over duplicates', () => {
  assert.ok(leaveValue(['?', 'S']) > leaveValue(['U', 'U']));
  assert.ok(leaveValue(['E', 'R', 'T']) > leaveValue(['I', 'I', 'I']));
});

test('exchange keeps blanks and an S', () => {
  const rack = [...'?SSEQVV'].map((letter, id) => ({ id, letter }));
  const out = tilesToExchange(rack);
  assert.deepEqual(out.sort(), [2, 4, 5, 6]);
});

test('computer games play out legally at every level', () => {
  for (const [seed, level] of [[11, 'easy'], [12, 'normal'], [13, 'hard']]) {
    const rng = seeded(seed);
    const game = newGame([
      { name: 'A', kind: 'computer', level },
      { name: 'B', kind: 'computer', level: 'hard' },
    ], rng);
    let turns = 0;
    let slowest = 0;
    while (!game.over && turns < 60) {
      const p = game.players[game.turn];
      const t0 = performance.now();
      const move = chooseMove(game.board, p.rack.map((t) => t.letter), dict, {
        level: p.level, bagCount: game.bag.length, rng,
      });
      slowest = Math.max(slowest, performance.now() - t0);
      if (move) {
        const r = play(game, toTilePlacements(p.rack, move), dict);
        assert.equal(r.error, undefined);
        assert.equal(r.score, move.score);
      } else if (game.bag.length >= RACK_SIZE) {
        assert.ok(exchange(game, tilesToExchange(p.rack), rng).ok);
      } else {
        pass(game);
      }
      turns++;
    }
    assert.ok(game.over, `${level} game finished`);
    assert.ok(slowest < 2000, `slowest turn took ${slowest.toFixed(0)}ms`);
  }
});
