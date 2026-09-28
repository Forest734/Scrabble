# Scrabble

Scrabble in the browser on a dark board, you against the computer. No build
step and no dependencies: plain HTML, CSS and JavaScript modules.

## Play

```sh
npm start          # python3 -m http.server 8000
```

Then open <http://localhost:8000>. It has to be served over HTTP: opened as a
file, the browser won't load the word list.

- Drag tiles from your rack onto the board, or tap a tile and then a square.
- Or click a square and type. Click the square again to switch between across
  and down. Backspace takes a letter back, Enter plays, and Esc takes all your
  tiles back.
- Tap a tile you've placed to send it back to the rack. Drag tiles along the
  rack to rearrange them.
- While you place tiles, the line under the rack shows the words you're making
  and what they score, or why the play isn't allowed.
- **Hint** puts the computer's best play for your rack on the board.
- **Exchange** swaps tiles with the bag (only while it holds 7 or more).
  **Pass** asks you to click twice.

The computer has three levels. Easy aims for about half the best score on
offer, normal for about three-quarters, and hard takes the best play, weighing
what tiles it keeps.

The game saves after every turn in the browser's local storage, so a reload
picks it up where you left off.

## Rules

Standard board, 100 tiles with 2 blanks, 7-tile racks. Using all seven tiles
scores 50 extra. A play whose words aren't all in the word list is refused
before it's made, so there are no challenges. The game ends when someone
plays their last tile with the bag empty, or after six scoreless turns in a
row. Tiles left on a rack come off that player's score, and a player who goes
out gets the other player's leftover points.

## Word list

`data/words.txt` is [ENABLE](https://github.com/dolph/dictionary) (public
domain) cut to 2–15 letters, plus the two-letter words FE, KI, OI, QI and ZA
from the tournament list. To rebuild it:

```sh
npm run words -- path/to/enable1.txt
```

## Tests

```sh
npm test           # node:test: rules, scoring and the move generator
```
