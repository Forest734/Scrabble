# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Scrabble against the computer, on a dark board. A no-build static page (web-static shape):
`index.html`, `css/style.css`, ES modules in `js/`, the word list in `data/words.txt`. No
dependencies. `package.json` exists for `npm test` and `"type": "module"`.

## Commands

```sh
npm start                               # python3 -m http.server 8000 (file:// can't fetch the word list)
npm test                                # node:test over tests/
node --test tests/ai.test.js            # one file
node --test --test-name-pattern="bingo" # one test
npm run words -- <enable1.txt>          # rebuild data/words.txt
```

**Deploy:** GitHub Pages serves the `main` branch root as-is at
<https://forest734.github.io/Scrabble/>, so pushing to `main` deploys. `.nojekyll` turns off
Jekyll. Every path in the page is relative, so it runs under the `/Scrabble/` subpath. Keep new
paths relative too.

`node --check js/*.js` catches syntax errors in the page script. Tests cover `rules.js`,
`dictionary.js` and `ai.js` only, so check changes to `main.js` or the CSS in a browser.
Headless Chrome works for screenshots and for driving the page over CDP (see `~/dev/Deadbase/CLAUDE.md`
for the pattern).

## Architecture

- **`js/rules.js`**: board layout, tile set, scoring and turn flow, with no DOM. A game is a
  plain JSON-safe object (`board` of 225 cells, `bag`, `players[]` with `rack`, `turn`,
  `scoreless`, `moves`, `result`); `main.js` saves it to localStorage whole
  (`scrabble:game:v1`). `analyze()` checks placement and scores every word formed without the
  dictionary. `validate()` adds dictionary checks. `play()`/`exchange()`/`pass()` change
  the game only on success. The rules code allows any number of players, but the page always creates
  one human and one computer, and `load()` rejects saves without exactly two players.
- **`js/dictionary.js`**: the word list as a trie in typed arrays (sibling lists, letters in
  order). Builds from sorted input in ~100 ms. The move generator walks it directly via
  `first`/`next`/`letter`/`end`.
- **`js/ai.js`**: `findMoves()` is Appel–Jacobson (anchors, cross-check bitmasks, left part
  then extend right). Down plays reuse the across code by mapping (line, pos) to board index.
  It scores inline, and a test asserts that every generated move's score equals `analyze()`'s,
  so keep the two in step. `chooseMove()` picks by level: easy and normal target a fraction
  of the best score, hard adds `leaveValue()`. Hint uses hard.
- **`js/main.js`**: rendering and input. Uses pointer events for drag and drop (mouse and
  touch alike), not HTML5 DnD. A press without movement counts as a tap. Tiles placed but not yet
  played live only in `pending` (square → `{ tileId, letter }`) and aren't saved.

Tiles have stable numeric `id`s. A blank is `letter: '?'` on the rack and `{ letter, blank:
true }` on the board. Blanks score 0.
