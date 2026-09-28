// Builds data/words.txt from the ENABLE word list (public domain).
//
//   node scripts/build-words.js <path to enable1.txt>
//
// Keeps words of 2–15 letters (the board is 15 squares wide), adds the few
// two-letter words from the tournament list that ENABLE lacks, and writes
// them sorted, one per line, lowercase.
import { readFileSync, writeFileSync } from 'node:fs';

const EXTRA = ['fe', 'ki', 'oi', 'qi', 'za'];

const src = process.argv[2];
if (!src) {
  console.error('usage: node scripts/build-words.js <enable1.txt>');
  process.exit(1);
}

const words = new Set(
  readFileSync(src, 'utf8')
    .split(/\r?\n/)
    .map((w) => w.trim().toLowerCase())
    .filter((w) => /^[a-z]{2,15}$/.test(w)),
);
for (const w of EXTRA) words.add(w);

const out = [...words].sort();
writeFileSync(new URL('../data/words.txt', import.meta.url), out.join('\n') + '\n');
console.log(`wrote ${out.length} words`);
