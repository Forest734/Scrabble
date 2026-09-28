// The word list as a trie packed into typed arrays, so 170k words cost a few
// MB instead of a few hundred thousand objects. Node 0 is the root. Letters
// are codes 0–25 (a–z). A node's children form a sibling list in letter
// order: first[node] → next[child] → … → -1.

export class Dictionary {
  constructor(words) {
    const sorted = [...words].sort();
    let cap = 1;
    for (const w of sorted) cap += w.length;
    const first = new Int32Array(cap).fill(-1);
    const next = new Int32Array(cap).fill(-1);
    const last = new Int32Array(cap).fill(-1);
    const letter = new Uint8Array(cap);
    const end = new Uint8Array(cap);

    // Sorted input means each word shares a prefix only with the path of the
    // word before it, so new nodes are always appended as a last child.
    let count = 1;
    const path = [0];
    let prev = '';
    for (const w of sorted) {
      let p = 0;
      while (p < w.length && p < prev.length && w[p] === prev[p]) p++;
      path.length = p + 1;
      let node = path[p];
      for (let i = p; i < w.length; i++) {
        const n = count++;
        letter[n] = w.charCodeAt(i) - 97;
        if (first[node] === -1) first[node] = n;
        else next[last[node]] = n;
        last[node] = n;
        path.push(n);
        node = n;
      }
      end[node] = 1;
      prev = w;
    }

    this.size = sorted.length;
    this.first = first.slice(0, count);
    this.next = next.slice(0, count);
    this.letter = letter.slice(0, count);
    this.end = end.slice(0, count);
  }

  static fromText(text) {
    return new Dictionary(
      text.split('\n').map((w) => w.trim().toLowerCase()).filter((w) => /^[a-z]{2,15}$/.test(w)),
    );
  }

  /** Child of `node` along letter code `c`, or -1. */
  child(node, c) {
    for (let n = this.first[node]; n !== -1; n = this.next[n]) {
      const l = this.letter[n];
      if (l === c) return n;
      if (l > c) return -1;
    }
    return -1;
  }

  /** Node reached by spelling `word` from `node`, or -1. Case-insensitive. */
  walk(word, node = 0) {
    for (let i = 0; i < word.length && node !== -1; i++) {
      node = this.child(node, (word.charCodeAt(i) | 32) - 97);
    }
    return node;
  }

  has(word) {
    const n = this.walk(word);
    return n !== -1 && this.end[n] === 1;
  }
}
