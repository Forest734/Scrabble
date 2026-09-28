// The page: renders the game, handles dragging, tapping and typing tiles,
// and runs the computer's turns. Rules live in rules.js, the computer in ai.js.
import { Dictionary } from './dictionary.js';
import {
  SIZE, CELLS, PREMIUM, POINTS, RACK_SIZE, ACROSS, DOWN,
  validate, newGame, play, exchange, pass, unseen, shuffle,
} from './rules.js';
import { chooseMove, toTilePlacements, tilesToExchange } from './ai.js';

const SAVE_KEY = 'scrabble:game:v1';
const PREMIUM_LABEL = { TW: 'TW', DW: 'DW', TL: 'TL', DL: 'DL', ST: '★' };
const LEVEL_NAME = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };
const COMPUTER_DELAY = 700;

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

let dict = null;
let game = null;
const pending = new Map(); // board idx → { tileId, letter } (letter only matters for a blank)
let selected = null; // rack tile id picked by tapping
let cursor = null; // { idx, dir } for typing
let typed = []; // squares filled by typing, for Backspace
let thinking = false;
let message = null; // { text, error } shown instead of the move preview
let fresh = new Set(); // squares to animate on the next render
let passArmed = null; // timer while Pass waits for a second click

const cells = [];

// --- Helpers -------------------------------------------------------------

const human = () => game.players.find((p) => p.kind === 'human');
const humanIdx = () => game.players.findIndex((p) => p.kind === 'human');
const myTurn = () => game && !game.over && !thinking && game.turn === humanIdx();
const rackTile = (id) => human().rack.find((t) => t.id === id);
const isPending = (id) => [...pending.values()].some((p) => p.tileId === id);

function step(idx, dir) {
  if (dir === ACROSS) return idx % SIZE < SIZE - 1 ? idx + 1 : null;
  return idx + SIZE < CELLS ? idx + SIZE : null;
}

function save() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(game));
  } catch {
    // Private mode or storage full: the game just won't survive a reload.
  }
}

function load() {
  try {
    const g = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (g && Array.isArray(g.board) && g.board.length === CELLS && g.players?.length === 2) return g;
  } catch {
    // Unreadable save: start fresh.
  }
  return null;
}

function tileEl({ id, letter, blank }, ...classes) {
  const el = document.createElement('div');
  el.className = ['tile', ...classes].filter(Boolean).join(' ');
  if (id != null) el.dataset.tile = id;
  const isBlank = blank || letter === '?';
  if (isBlank) el.classList.add('blank');
  const shown = letter === '?' ? '' : letter;
  el.innerHTML = `<span class="l">${shown}</span>${isBlank ? '' : `<span class="p">${POINTS[letter]}</span>`}`;
  el.setAttribute('aria-label', isBlank ? `blank${shown ? ` as ${shown}` : ''}` : `${letter}, ${POINTS[letter]} points`);
  return el;
}

/** Pending tiles in the shape rules.validate() wants, or null while a blank has no letter. */
function pendingPlacements() {
  const out = [];
  for (const [idx, p] of pending) {
    const t = rackTile(p.tileId);
    const blank = t.letter === '?';
    if (blank && !p.letter) return null;
    out.push({ idx, letter: blank ? p.letter : t.letter, blank });
  }
  return out;
}

function lastPlayCells() {
  const m = game?.moves.findLast((m) => m.type === 'play');
  return new Set(m?.cells ?? []);
}

// --- Rendering -----------------------------------------------------------

function buildBoard() {
  const board = $('#board');
  for (let i = 0; i < CELLS; i++) {
    const cell = document.createElement('div');
    cell.className = `cell ${PREMIUM[i]?.toLowerCase() ?? ''}`;
    cell.dataset.idx = i;
    board.append(cell);
    cells.push(cell);
  }
  const brand = $('.brand');
  for (const l of 'SCRABBLE') brand.append(tileEl({ letter: l }));
}

function render() {
  renderBoard();
  renderRack();
  renderScores();
  renderSide();
  renderStatus();
  renderActions();
  fresh = new Set();
}

function renderBoard() {
  const last = lastPlayCells();
  for (let i = 0; i < CELLS; i++) {
    const cell = cells[i];
    const t = game?.board[i];
    const p = pending.get(i);
    cell.replaceChildren();
    const hasCursor = cursor?.idx === i && myTurn() && !t && !p;
    cell.classList.toggle('cursor', hasCursor);
    cell.dataset.dir = hasCursor ? cursor.dir : '';
    if (t) {
      cell.append(tileEl({ letter: t.letter, blank: t.blank }, last.has(i) && 'last', fresh.has(i) && 'fresh'));
    } else if (p) {
      const rt = rackTile(p.tileId);
      const blank = rt.letter === '?';
      cell.append(tileEl({ id: rt.id, letter: blank ? p.letter ?? '?' : rt.letter, blank }, 'pending'));
    } else if (PREMIUM[i]) {
      const label = document.createElement('span');
      label.className = 'prem';
      label.textContent = PREMIUM_LABEL[PREMIUM[i]];
      cell.append(label);
    }
  }
}

function renderRack() {
  const rack = $('#rack');
  rack.replaceChildren();
  rack.classList.toggle('waiting', !myTurn());
  if (!game) return;
  for (const t of human().rack) {
    if (isPending(t.id)) continue;
    rack.append(tileEl(t, selected === t.id && 'selected'));
  }
}

function renderScores() {
  if (!game) return;
  $('#scores').innerHTML = game.players
    .map((p, i) => {
      const turn = !game.over && game.turn === i;
      let state = '';
      if (game.over && game.result.winners.includes(i)) state = game.result.winners.length > 1 ? 'Tie' : 'Winner';
      else if (turn && p.kind === 'human') state = 'Your turn';
      else if (turn && thinking) state = 'Thinking';
      return `<div class="player${turn ? ' turn' : ''}">
        <span class="name">${esc(p.name)}</span>${p.kind === 'computer' ? `<span class="level">${LEVEL_NAME[p.level]}</span>` : ''}
        <span class="score">${p.score}</span>
        <span class="state${state === 'Thinking' ? ' thinking' : ''}">${state}</span>
      </div>`;
    })
    .join('');
}

function renderSide() {
  if (!game) return;
  $('#bag-count').textContent = game.bag.length;

  const left = unseen(game, humanIdx());
  const total = Object.values(left).reduce((a, b) => a + b, 0);
  $('#unseen-box summary').textContent = `Tiles you haven’t seen (${total})`;
  $('#unseen').innerHTML = Object.entries(left)
    .map(([l, n]) => `<span class="${n ? '' : 'gone'}">${l === '?' ? 'Blank' : l}<small>${n}</small></span>`)
    .join('');

  const log = $('#log');
  if (!game.moves.length) {
    log.innerHTML = '<li class="empty">No moves yet.</li>';
    return;
  }
  log.innerHTML = game.moves
    .map((m) => {
      const who = esc(game.players[m.player].name);
      let what;
      if (m.type === 'play') {
        const [main, ...rest] = m.words;
        what = `<span class="word">${main}</span>${m.bingo ? '<span class="bingo">BINGO</span>' : ''}${
          rest.length ? `<br><span class="also">also ${rest.join(', ')}</span>` : ''}`;
      } else if (m.type === 'exchange') {
        what = `<span class="who">exchanged ${m.count} tile${m.count === 1 ? '' : 's'}</span>`;
      } else {
        what = '<span class="who">passed</span>';
      }
      return `<li><span><span class="who">${who}</span> ${what}</span><span class="pts">${m.score ? `+${m.score}` : '–'}</span></li>`;
    })
    .reverse()
    .join('');
}

function renderStatus() {
  const el = $('#status');
  el.classList.remove('error');
  if (message) {
    el.textContent = message.text;
    el.classList.toggle('error', !!message.error);
    return;
  }
  if (!game) return;
  if (game.over) {
    el.textContent = 'Game over.';
  } else if (!myTurn()) {
    el.textContent = 'The computer is thinking…';
  } else if (pending.size) {
    const placements = pendingPlacements();
    const r = placements && validate(game.board, placements, dict);
    if (!r) el.textContent = '';
    else if (r.error) {
      el.textContent = r.error;
      el.classList.add('error');
    } else {
      el.innerHTML = `<span class="words">${r.words.map((w) => w.word).join(', ')}</span> · <span class="pts">${r.score} points</span>${r.bingo ? ' with the bingo' : ''}`;
    }
  } else {
    el.textContent = 'Your turn. Drag tiles onto the board, or click a square and type.';
  }
}

function renderActions() {
  const mine = myTurn();
  const placements = mine && pending.size ? pendingPlacements() : null;
  const preview = placements && validate(game.board, placements, dict);
  const ok = preview && !preview.error;
  $('#play').disabled = !ok;
  $('#play').textContent = ok ? `Play ${preview.score}` : 'Play';
  $('#recall').disabled = !pending.size;
  $('#shuffle').disabled = !game || game.over;
  $('#swap').disabled = !mine || game.bag.length < RACK_SIZE;
  $('#swap').title = game && game.bag.length < RACK_SIZE
    ? 'The bag needs at least 7 tiles to exchange'
    : 'Swap tiles with the bag and miss a turn';
  $('#pass').disabled = !mine;
  $('#hint').disabled = !mine;
  if (!mine) disarmPass();
}

function say(text, error = false) {
  message = { text, error };
  renderStatus();
}

// --- Placing tiles -------------------------------------------------------

async function placeTile(id, idx, fromIdx = null) {
  if (!myTurn() || game.board[idx] || idx === fromIdx) return;
  message = null;
  const displaced = pending.get(idx);
  const moving = fromIdx != null ? pending.get(fromIdx) : { tileId: id };
  if (fromIdx != null) pending.delete(fromIdx);
  if (displaced) {
    // Dropping onto another new tile swaps them, or sends it home.
    pending.delete(idx);
    if (fromIdx != null) pending.set(fromIdx, displaced);
  }
  pending.set(idx, moving);
  selected = null;
  typed = [];
  if (rackTile(id).letter === '?' && !moving.letter) {
    render();
    const letter = await chooseBlank();
    if (letter) moving.letter = letter;
    else pending.delete(idx);
  }
  render();
}

function takeBack(idx) {
  pending.delete(idx);
  typed = typed.filter((i) => i !== idx);
  message = null;
  render();
}

function recall() {
  pending.clear();
  typed = [];
  message = null;
  render();
}

/** Moves a rack tile to position `index` among the tiles shown on the rack. */
function moveInRack(id, index) {
  const rack = human().rack;
  const tile = rackTile(id);
  const shown = rack.filter((t) => t !== tile && !isPending(t.id));
  const before = shown[index];
  rack.splice(rack.indexOf(tile), 1);
  rack.splice(before ? rack.indexOf(before) : rack.length, 0, tile);
  save();
}

function typeLetter(letter) {
  let idx = cursor.idx;
  while (idx != null && (game.board[idx] || pending.has(idx))) idx = step(idx, cursor.dir);
  if (idx == null) return;
  const free = human().rack.filter((t) => !isPending(t.id));
  const tile = free.find((t) => t.letter === letter) ?? free.find((t) => t.letter === '?');
  if (!tile) {
    say(`You don’t have ${/^[AEIOU]/.test(letter) ? 'an' : 'a'} ${letter}.`, true);
    return;
  }
  message = null;
  pending.set(idx, { tileId: tile.id, letter: tile.letter === '?' ? letter : undefined });
  typed.push(idx);
  let next = step(idx, cursor.dir);
  while (next != null && game.board[next]) next = step(next, cursor.dir);
  cursor = { idx: next ?? idx, dir: cursor.dir };
  render();
}

function untype() {
  const idx = typed.pop();
  if (idx == null) return;
  pending.delete(idx);
  cursor = { idx, dir: cursor?.dir ?? ACROSS };
  message = null;
  render();
}

function clickCell(idx) {
  if (!myTurn() || game.board[idx]) return;
  if (selected != null) {
    placeTile(selected, idx);
    return;
  }
  cursor = cursor?.idx === idx ? { idx, dir: cursor.dir === ACROSS ? DOWN : ACROSS } : { idx, dir: ACROSS };
  typed = [];
  render();
}

// --- Zoom ----------------------------------------------------------------
// Squares are small on a phone, so a double tap (or double click) on the board
// zooms it in around that point, and dragging the board pans it. The rack
// stays where it is.
// x and y are the board's offset as a fraction of its size, so they stay
// right when the window resizes.

const ZOOM = 2;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_PX = 30;

let zoom = { scale: 1, x: 0, y: 0 };
let lastTap = null; // { time, x, y, undo } after a tap on the board

function applyZoom(animate = true) {
  const board = $('#board');
  board.classList.toggle('panning', !animate);
  board.style.transform = zoom.scale === 1 ? '' : `translate(${zoom.x * 100}%, ${zoom.y * 100}%) scale(${zoom.scale})`;
  $('#board-view').classList.toggle('zoomed', zoom.scale > 1);
}

function resetZoom() {
  zoom = { scale: 1, x: 0, y: 0 };
  applyZoom(false);
}

/** Zooms in so the board point under (x, y) stays put, or zooms back out. */
function toggleZoom(x, y) {
  if (zoom.scale > 1) {
    zoom = { scale: 1, x: 0, y: 0 };
  } else {
    const r = $('#board-view').getBoundingClientRect();
    const fx = (x - r.left) / r.width;
    const fy = (y - r.top) / r.height;
    zoom = { scale: ZOOM, x: fx * (1 - ZOOM), y: fy * (1 - ZOOM) };
  }
  applyZoom();
}

function panBoard(from, dx, dy) {
  const r = $('#board-view').getBoundingClientRect();
  const clamp = (v) => Math.min(0, Math.max(1 - zoom.scale, v));
  zoom.x = clamp(from.x + dx / r.width);
  zoom.y = clamp(from.y + dy / r.height);
  applyZoom(false);
}

// Safari on iPhone can still zoom the whole page on a double tap despite
// touch-action: manipulation. Cancelling the second tap's touchend stops it.
// That tap's pointer events have already fired, so the board still zooms.
let lastTouchEnd = -Infinity;

// touchend goes to the element the touch started on, which a render may have
// taken out of the page by then, so listen there rather than on the document.
function onTouchStart(e) {
  e.target.addEventListener('touchend', onTouchEnd, { once: true });
}

function onTouchEnd(e) {
  if (e.cancelable && e.timeStamp - lastTouchEnd < DOUBLE_TAP_MS) e.preventDefault();
  lastTouchEnd = e.timeStamp;
}

const snapshot = () => ({ pending: new Map(pending), selected, cursor, typed: [...typed] });

/**
 * Runs a tap on the board, unless it's the second tap of a double tap. Then it
 * undoes the first tap and zooms instead, so a double tap does nothing else.
 */
function tapBoard(p, e, action) {
  const t = lastTap;
  if (t && p.downAt - t.time < DOUBLE_TAP_MS && Math.hypot(e.clientX - t.x, e.clientY - t.y) < DOUBLE_TAP_PX) {
    lastTap = null;
    pending.clear();
    for (const [idx, v] of t.undo.pending) pending.set(idx, v);
    ({ selected, cursor } = t.undo);
    typed = t.undo.typed;
    toggleZoom(e.clientX, e.clientY);
    render();
    return;
  }
  lastTap = { time: e.timeStamp, x: e.clientX, y: e.clientY, undo: snapshot() };
  action();
}

// --- Dragging ------------------------------------------------------------
// Pointer events rather than HTML drag-and-drop, so touch works the same as
// a mouse. A press that doesn't move is a tap. Only the primary pointer counts,
// so a second finger touching the screen can't hijack a drag.

let press = null;

function onPointerDown(e) {
  if (e.button !== 0 || !e.isPrimary || !game) return;
  if (press) clearDrag(press); // a press whose pointerup never came
  const tile = e.target.closest('.tile[data-tile]');
  const cell = e.target.closest('.cell');
  const fromIdx = cell ? Number(cell.dataset.idx) : null;
  const at = { x: e.clientX, y: e.clientY, pointer: e.pointerId, downAt: e.timeStamp };
  if (tile && (fromIdx == null || pending.has(fromIdx))) {
    press = { id: Number(tile.dataset.tile), el: tile, fromIdx, ...at };
    e.preventDefault();
  } else if (e.target.closest('#board')) {
    press = { cellIdx: fromIdx, zoom: { ...zoom }, ...at };
  }
}

function dropTarget(x, y) {
  const el = document.elementFromPoint(x, y);
  const cell = el?.closest('#board .cell');
  if (cell) {
    const idx = Number(cell.dataset.idx);
    return game.board[idx] || !myTurn() ? null : { idx };
  }
  if (el?.closest('#rack')) {
    const all = [...$('#rack').querySelectorAll('.tile')];
    const from = all.findIndex((t) => t.classList.contains('dragging'));
    const tiles = all.filter((t) => !t.classList.contains('dragging'));
    const rects = tiles.map((t) => t.getBoundingClientRect());
    // Dropped on a tile: take its place. Between tiles: go in the gap.
    const over = rects.findIndex((r) => x >= r.left && x <= r.right);
    if (over !== -1) return { rack: from !== -1 && from <= over ? over + 1 : over };
    const i = rects.findIndex((r) => x < r.left + r.width / 2);
    return { rack: i === -1 ? tiles.length : i };
  }
  return null;
}

function onPointerMove(e) {
  if (!press || e.pointerId !== press.pointer) return;
  if (!press.el) {
    // A press on the board, not on a tile: pans the board while zoomed.
    const dx = e.clientX - press.x;
    const dy = e.clientY - press.y;
    if (zoom.scale === 1 || (!press.panning && Math.hypot(dx, dy) < 6)) return;
    press.panning = true;
    lastTap = null;
    panBoard(press.zoom, dx, dy);
    return;
  }
  if (!press.ghost) {
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < 6) return;
    press.ghost = press.el.cloneNode(true);
    press.ghost.classList.remove('selected', 'pending');
    press.ghost.classList.add('ghost');
    document.body.append(press.ghost);
    press.el.classList.add('dragging');
    selected = null;
  }
  const half = press.ghost.offsetWidth / 2;
  press.ghost.style.transform = `translate(${e.clientX - half}px, ${e.clientY - half}px) scale(1.08)`;
  const target = dropTarget(e.clientX, e.clientY);
  for (const c of document.querySelectorAll('.cell.drop')) c.classList.remove('drop');
  if (target?.idx != null) cells[target.idx].classList.add('drop');
}

function onPointerUp(e) {
  if (!press || e.pointerId !== press.pointer) return;
  const p = press;
  press = null;
  if (!p.el) {
    if (p.panning) return;
    const cell = document.elementFromPoint(e.clientX, e.clientY)?.closest('.cell');
    tapBoard(p, e, () => {
      if (cell && p.cellIdx != null && Number(cell.dataset.idx) === p.cellIdx) clickCell(p.cellIdx);
    });
    return;
  }
  if (!p.ghost) {
    // A tap: pick up a rack tile, or send a placed tile home.
    if (p.fromIdx != null) tapBoard(p, e, () => takeBack(p.fromIdx));
    else {
      selected = selected === p.id ? null : p.id;
      render();
    }
    return;
  }
  clearDrag(p);
  const target = dropTarget(e.clientX, e.clientY);
  if (target?.idx != null) {
    placeTile(p.id, target.idx, p.fromIdx);
    return;
  }
  if (target?.rack != null) {
    if (p.fromIdx != null) pending.delete(p.fromIdx);
    typed = [];
    message = null;
    moveInRack(p.id, target.rack);
  }
  render();
}

function onPointerCancel(e) {
  if (!press || e.pointerId !== press.pointer) return;
  clearDrag(press);
  press = null;
  render();
}

function clearDrag(p) {
  if (!p.ghost) return;
  p.ghost.remove();
  p.el.classList.remove('dragging');
  for (const c of document.querySelectorAll('.cell.drop')) c.classList.remove('drop');
}

// --- Turns ---------------------------------------------------------------

function afterTurn() {
  pending.clear();
  selected = null;
  cursor = null;
  typed = [];
  save();
  render();
  if (game.over) setTimeout(showGameOver, 600);
  else if (game.players[game.turn].kind === 'computer') computerTurn();
}

function doPlay() {
  if (!myTurn() || !pending.size) return;
  const placements = [...pending].map(([idx, p]) => ({ idx, tileId: p.tileId, letter: p.letter }));
  const r = play(game, placements, dict);
  if (r.error) {
    say(r.error, true);
    return;
  }
  fresh = new Set(placements.map((p) => p.idx));
  message = { text: `You played ${r.words[0].word} for ${r.score}.` };
  afterTurn();
}

function doPass() {
  if (!myTurn()) return;
  if (!passArmed) {
    $('#pass').textContent = 'Really pass?';
    passArmed = setTimeout(disarmPass, 3000);
    return;
  }
  disarmPass();
  recall();
  pass(game);
  message = { text: 'You passed.' };
  afterTurn();
}

function disarmPass() {
  clearTimeout(passArmed);
  passArmed = null;
  $('#pass').textContent = 'Pass';
}

function doHint() {
  if (!myTurn()) return;
  pending.clear();
  typed = [];
  const me = human();
  const move = chooseMove(game.board, me.rack.map((t) => t.letter), dict, { level: 'hard', bagCount: game.bag.length });
  if (!move) {
    say(game.bag.length >= RACK_SIZE ? 'No word fits. Try exchanging.' : 'No word fits. You’ll have to pass.', true);
    render();
    return;
  }
  for (const p of toTilePlacements(me.rack, move)) pending.set(p.idx, { tileId: p.tileId, letter: p.letter });
  message = null;
  render();
}

function computerTurn() {
  thinking = true;
  render();
  const started = performance.now();
  // Let the "Thinking" state paint before the search blocks the main thread.
  requestAnimationFrame(() => setTimeout(() => {
    const p = game.players[game.turn];
    const move = chooseMove(game.board, p.rack.map((t) => t.letter), dict, {
      level: p.level,
      bagCount: game.bag.length,
    });
    setTimeout(() => {
      thinking = false;
      if (move) {
        play(game, toTilePlacements(p.rack, move), dict);
        const m = game.moves.at(-1);
        fresh = new Set(m.cells);
        message = { text: `${p.name} played ${m.words[0]} for ${m.score}.` };
      } else if (game.bag.length >= RACK_SIZE) {
        const ids = tilesToExchange(p.rack);
        exchange(game, ids);
        message = { text: `${p.name} exchanged ${ids.length} tile${ids.length === 1 ? '' : 's'}.` };
      } else {
        pass(game);
        message = { text: `${p.name} passed.` };
      }
      afterTurn();
    }, Math.max(0, COMPUTER_DELAY - (performance.now() - started)));
  }, 30));
}

// --- Dialogs -------------------------------------------------------------

function chooseBlank() {
  const dlg = $('#blank');
  dlg.returnValue = '';
  dlg.showModal();
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue || null), { once: true });
  });
}

function openExchange() {
  if (!myTurn() || game.bag.length < RACK_SIZE) return;
  recall();
  const dlg = $('#exchange');
  const tray = $('#swap-rack');
  tray.replaceChildren(...human().rack.map((t) => tileEl(t)));
  $('#swap-ok').disabled = true;
  dlg.returnValue = '';
  dlg.showModal();
}

function openSetup() {
  const dlg = $('#setup');
  $('#setup-cancel').hidden = !game || game.over;
  dlg.returnValue = '';
  dlg.showModal();
}

function startGame(level, computerFirst) {
  const you = { name: 'You', kind: 'human' };
  const cpu = { name: 'Computer', kind: 'computer', level };
  game = newGame(computerFirst ? [cpu, you] : [you, cpu]);
  resetZoom();
  pending.clear();
  selected = null;
  cursor = null;
  typed = [];
  message = null;
  try {
    localStorage.setItem('scrabble:level', level);
  } catch {
    // Not remembered; the default is fine.
  }
  afterTurn();
}

function showGameOver() {
  const { result, players } = game;
  const me = humanIdx();
  const title = result.winners.length > 1 ? 'It’s a tie!' : result.winners[0] === me ? 'You win!' : 'The computer wins';
  $('#over-title').textContent = title;
  let how = 'Six turns in a row scored nothing, so the game ends. Tiles left on each rack come off that score.';
  if (result.out === me) how = 'You used every tile, so you collect the points left on the computer’s rack.';
  else if (result.out != null) how = 'The computer used every tile, so it collects the points left on your rack.';
  const rows = players
    .map((p, i) => {
      let adj = -result.leftovers[i];
      if (result.out === i) adj = result.leftovers.reduce((a, b) => a + b, 0);
      return `<tr><td>${esc(p.name)}</td><td>${adj > 0 ? '+' : ''}${adj || '–'}</td><td class="total">${p.score}</td></tr>`;
    })
    .join('');
  $('#over-body').innerHTML = `
    <p>${how}</p>
    <table class="final"><tr><th></th><th>Tiles left</th><th>Final</th></tr>${rows}</table>`;
  const dlg = $('#over');
  dlg.returnValue = '';
  dlg.showModal();
}

// --- Wiring --------------------------------------------------------------

function bindEvents() {
  $('#board').addEventListener('pointerdown', onPointerDown);
  $('#rack').addEventListener('pointerdown', onPointerDown);
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp);
  document.addEventListener('pointercancel', onPointerCancel);
  document.addEventListener('touchstart', onTouchStart);

  $('#play').addEventListener('click', doPlay);
  $('#recall').addEventListener('click', recall);
  $('#shuffle').addEventListener('click', () => {
    shuffle(human().rack);
    save();
    render();
  });
  $('#swap').addEventListener('click', openExchange);
  $('#pass').addEventListener('click', doPass);
  $('#hint').addEventListener('click', doHint);
  $('#new-game').addEventListener('click', openSetup);

  const letters = $('#blank-letters');
  for (let c = 0; c < 26; c++) {
    const b = document.createElement('button');
    b.value = b.textContent = String.fromCharCode(65 + c);
    letters.append(b);
  }

  $('#swap-rack').addEventListener('click', (e) => {
    const t = e.target.closest('.tile');
    if (!t) return;
    t.classList.toggle('chosen');
    $('#swap-ok').disabled = !$('#swap-rack .chosen');
  });
  $('#exchange').addEventListener('close', () => {
    if ($('#exchange').returnValue !== 'ok' || !myTurn()) return;
    const ids = [...$('#swap-rack').querySelectorAll('.chosen')].map((t) => Number(t.dataset.tile));
    const r = exchange(game, ids);
    if (r.error) {
      say(r.error, true);
      return;
    }
    message = { text: `You exchanged ${ids.length} tile${ids.length === 1 ? '' : 's'}.` };
    afterTurn();
  });

  $('#setup').addEventListener('close', () => {
    const dlg = $('#setup');
    if (dlg.returnValue === 'start') {
      const form = dlg.querySelector('form');
      startGame(form.level.value, form.first.value === 'computer');
    } else if (!game) {
      // There's nothing behind the dialog to go back to.
      openSetup();
    }
  });
  $('#over').addEventListener('close', () => {
    if ($('#over').returnValue === 'new') openSetup();
  });

  document.addEventListener('keydown', (e) => {
    if (document.querySelector('dialog[open]') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!myTurn()) return;
    if (/^[a-z]$/i.test(e.key) && cursor) {
      typeLetter(e.key.toUpperCase());
      e.preventDefault();
    } else if (e.key === 'Backspace') {
      untype();
      e.preventDefault();
    } else if (e.key === 'Enter' && pending.size && !e.target.closest?.('button')) {
      doPlay();
      e.preventDefault();
    } else if (e.key === 'Escape') {
      cursor = null;
      recall();
    }
  });
}

async function init() {
  buildBoard();
  bindEvents();
  say('Loading the word list…');
  try {
    const res = await fetch('data/words.txt');
    if (!res.ok) throw new Error(res.statusText);
    dict = Dictionary.fromText(await res.text());
  } catch {
    say('Couldn’t load the word list. Serve this folder over HTTP (npm start) rather than opening the file.', true);
    return;
  }
  message = null;
  try {
    const level = localStorage.getItem('scrabble:level');
    if (level in LEVEL_NAME) $(`#setup input[name=level][value=${level}]`).checked = true;
  } catch {
    // Use the default level.
  }
  game = load();
  if (game && !game.over) {
    render();
    if (game.players[game.turn].kind === 'computer') computerTurn();
  } else {
    if (game) render();
    openSetup();
  }
}

init();
