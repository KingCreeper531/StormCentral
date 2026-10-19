/**
 * bzip2 decompression for NEXRAD files (Level II LDM records and compressed
 * Level III products), in plain TypeScript so it runs in a Web Worker with
 * no Node `Buffer` polyfill or WASM. A straight implementation of the
 * format: Huffman-coded MTF/RLE2 symbols per block, inverse BWT, RLE1.
 * Concatenated streams are decoded back to back.
 */

class BitReader {
  private pos = 0;
  /** Up to 31 buffered bits, most significant first. */
  private acc = 0;
  private n = 0;
  constructor(private readonly buf: Uint8Array) {}

  /** Read `count` ≤ 24 bits. */
  bits(count: number): number {
    while (this.n < count) {
      const byte = this.buf[this.pos++];
      if (byte === undefined) throw new Error("bzip2: unexpected end of data");
      this.acc = ((this.acc << 8) | byte) >>> 0;
      this.n += 8;
    }
    this.n -= count;
    const v = (this.acc >>> this.n) & ((1 << count) - 1);
    this.acc &= (1 << this.n) - 1;
    return v;
  }

  bits32(): number {
    return ((this.bits(16) << 16) | this.bits(16)) >>> 0;
  }

  /** Skip to the next byte boundary (between streams). */
  align() {
    this.n -= this.n % 8;
    this.acc &= (1 << this.n) - 1;
  }

  get done() {
    return this.pos >= this.buf.length && this.n < 8;
  }
}

class Output {
  buf: Uint8Array;
  len = 0;
  constructor(size: number) {
    this.buf = new Uint8Array(Math.max(1024, size));
  }
  push(b: number) {
    if (this.len === this.buf.length) {
      const next = new Uint8Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
    }
    this.buf[this.len++] = b;
  }
  result() {
    return this.buf.subarray(0, this.len);
  }
}

const MAX_GROUPS = 6;
const MAX_CODE_LEN = 20;
const GROUP_SIZE = 50;

interface Table {
  limit: Int32Array;
  base: Int32Array;
  perm: Int32Array;
  minLen: number;
  maxLen: number;
}

function buildTable(lengths: Uint8Array, symCount: number): Table {
  let minLen = 32;
  let maxLen = 0;
  for (let i = 0; i < symCount; i++) {
    minLen = Math.min(minLen, lengths[i]!);
    maxLen = Math.max(maxLen, lengths[i]!);
  }
  const perm = new Int32Array(symCount);
  let p = 0;
  for (let len = minLen; len <= maxLen; len++) for (let s = 0; s < symCount; s++) if (lengths[s] === len) perm[p++] = s;
  const count = new Int32Array(MAX_CODE_LEN + 2);
  for (let i = 0; i < symCount; i++) count[lengths[i]!]!++;
  const limit = new Int32Array(MAX_CODE_LEN + 2).fill(-1);
  const base = new Int32Array(MAX_CODE_LEN + 2);
  let code = 0;
  let idx = 0;
  for (let len = minLen; len <= maxLen; len++) {
    base[len] = idx - code;
    code += count[len]!;
    idx += count[len]!;
    limit[len] = code - 1;
    code <<= 1;
  }
  return { limit, base, perm, minLen, maxLen };
}

function decodeSymbol(r: BitReader, t: Table): number {
  let len = t.minLen;
  let code = r.bits(len);
  while (len <= t.maxLen) {
    if (code <= t.limit[len]!) return t.perm[code + t.base[len]!]!;
    code = (code << 1) | r.bits(1);
    len++;
  }
  throw new Error("bzip2: bad Huffman code");
}

/** Decode one block's symbols, then undo BWT and RLE1 into `out`. */
function readBlock(r: BitReader, blockSize: number, out: Output) {
  r.bits32(); // block CRC (not verified: NEXRAD transport already checks integrity)
  if (r.bits(1)) throw new Error("bzip2: randomised blocks are not supported");
  const origPtr = r.bits(24);

  // Symbol map.
  const used = r.bits(16);
  const symToByte = new Uint8Array(256);
  let symTotal = 0;
  for (let i = 0; i < 16; i++) {
    if (!(used & (0x8000 >> i))) continue;
    const bits = r.bits(16);
    for (let j = 0; j < 16; j++) if (bits & (0x8000 >> j)) symToByte[symTotal++] = i * 16 + j;
  }
  if (!symTotal) throw new Error("bzip2: empty symbol map");
  const symCount = symTotal + 2;

  // Huffman groups and selectors (MTF-coded).
  const nGroups = r.bits(3);
  if (nGroups < 2 || nGroups > MAX_GROUPS) throw new Error("bzip2: bad group count");
  const nSelectors = r.bits(15);
  if (!nSelectors) throw new Error("bzip2: no selectors");
  const mtfGroups = Array.from({ length: nGroups }, (_, i) => i);
  const selectors = new Uint8Array(nSelectors);
  for (let i = 0; i < nSelectors; i++) {
    let j = 0;
    while (r.bits(1)) if (++j >= nGroups) throw new Error("bzip2: bad selector");
    const v = mtfGroups[j]!;
    mtfGroups.splice(j, 1);
    mtfGroups.unshift(v);
    selectors[i] = v;
  }
  const tables: Table[] = [];
  for (let g = 0; g < nGroups; g++) {
    const lengths = new Uint8Array(symCount);
    let len = r.bits(5);
    for (let s = 0; s < symCount; s++) {
      for (;;) {
        if (len < 1 || len > MAX_CODE_LEN) throw new Error("bzip2: bad code length");
        if (!r.bits(1)) break;
        len += r.bits(1) ? -1 : 1;
      }
      lengths[s] = len;
    }
    tables.push(buildTable(lengths, symCount));
  }

  // Symbols → bytes (MTF + RUNA/RUNB run lengths).
  const mtf = new Uint8Array(256);
  for (let i = 0; i < 256; i++) mtf[i] = i;
  const tt = new Uint32Array(blockSize);
  const byteCount = new Int32Array(256);
  let count = 0;
  let selector = 0;
  let groupLeft = 0;
  let table = tables[0]!;
  let run = 0;
  let runBit = 1;
  const flushRun = () => {
    if (!run) return;
    const b = symToByte[mtf[0]!]!;
    if (count + run > blockSize) throw new Error("bzip2: block overflow");
    byteCount[b]! += run;
    while (run--) tt[count++] = b;
    run = 0;
    runBit = 1;
  };
  for (;;) {
    if (!groupLeft) {
      if (selector >= nSelectors) throw new Error("bzip2: ran out of selectors");
      table = tables[selectors[selector++]!]!;
      groupLeft = GROUP_SIZE;
    }
    groupLeft--;
    const sym = decodeSymbol(r, table);
    if (sym <= 1) {
      // RUNA = +1·bit, RUNB = +2·bit, in bijective base 2.
      run += (sym + 1) * runBit;
      runBit <<= 1;
      continue;
    }
    flushRun();
    if (sym === symCount - 1) break;
    const idx = sym - 1;
    const v = mtf[idx]!;
    mtf.copyWithin(1, 0, idx);
    mtf[0] = v;
    const b = symToByte[v]!;
    if (count >= blockSize) throw new Error("bzip2: block overflow");
    byteCount[b]!++;
    tt[count++] = b;
  }
  if (origPtr >= count) throw new Error("bzip2: bad origin pointer");

  // Inverse BWT: tt[i] low byte = character, high bits = next index.
  const start = new Int32Array(256);
  for (let i = 0, sum = 0; i < 256; i++) {
    start[i] = sum;
    sum += byteCount[i]!;
  }
  for (let i = 0; i < count; i++) {
    const b = tt[i]! & 0xff;
    tt[start[b]!]! |= i << 8;
    start[b]!++;
  }

  // Walk the chain, undoing RLE1 (4 equal bytes then a repeat count).
  let pos = tt[origPtr]! >>> 8;
  let last = -1;
  let same = 0;
  for (let i = 0; i < count; i++) {
    const entry = tt[pos]!;
    const b = entry & 0xff;
    pos = entry >>> 8;
    if (same === 4) {
      for (let k = 0; k < b; k++) out.push(last);
      same = 0;
      last = -1;
      continue;
    }
    out.push(b);
    if (b === last) same++;
    else {
      last = b;
      same = 1;
    }
  }
}

/** Decompress one or more concatenated bzip2 streams. */
export function bunzip2(data: Uint8Array, sizeHint = data.length * 6): Uint8Array {
  const r = new BitReader(data);
  const out = new Output(sizeHint);
  let streams = 0;
  while (!r.done) {
    // "BZh" + block size digit.
    const b = r.bits(8);
    if (b !== 0x42) {
      if (streams) break; // trailing padding after the last stream
      throw new Error("bzip2: missing stream header");
    }
    if (r.bits(8) !== 0x5a || r.bits(8) !== 0x68) throw new Error("bzip2: missing stream header");
    const level = r.bits(8) - 0x30;
    if (level < 1 || level > 9) throw new Error("bzip2: bad block size");
    const blockSize = level * 100_000;
    for (;;) {
      const hi = r.bits(24);
      const lo = r.bits(24);
      if (hi === 0x314159 && lo === 0x265359) readBlock(r, blockSize, out);
      else if (hi === 0x177245 && lo === 0x385090) {
        r.bits32(); // stream CRC
        r.align();
        break;
      } else throw new Error("bzip2: bad block signature");
    }
    streams++;
  }
  return out.result();
}
