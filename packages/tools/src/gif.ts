/**
 * A GIF89a encoder, for the timelapse. features.md §14.
 *
 * Written rather than depended on because the requirement is unusually narrow:
 * every frame comes out of our own renderer, so the palette is *known* — it is
 * the game's palette plus the terrain ramp — and a general encoder's hardest
 * job, choosing 256 colours out of sixteen million without visible banding,
 * does not exist here. What is left is LZW and the block structure, which is a
 * couple of hundred lines and has the useful property of being exactly as fast
 * as it needs to be for a 240-frame region.
 *
 * Fixed palette across every frame also gets the thing a timelapse most needs
 * for free: colours do not shift between frames. An encoder that re-quantised
 * each frame would make a still coastline shimmer for 240 frames, which is the
 * one artefact that would make the asset unusable.
 */

const HEADER = 'GIF89a';

class ByteStream {
  private parts: number[] = [];

  byte(v: number): this {
    this.parts.push(v & 0xff);
    return this;
  }

  short(v: number): this {
    return this.byte(v).byte(v >> 8);
  }

  bytes(v: ArrayLike<number>): this {
    for (let i = 0; i < v.length; i++) this.parts.push(v[i] & 0xff);
    return this;
  }

  ascii(v: string): this {
    for (let i = 0; i < v.length; i++) this.parts.push(v.charCodeAt(i) & 0xff);
    return this;
  }

  /** GIF carries payloads in sub-blocks of at most 255 bytes, each preceded by
   *  its length and terminated by a zero. */
  subBlocks(data: number[]): this {
    for (let i = 0; i < data.length; i += 255) {
      const run = Math.min(255, data.length - i);
      this.byte(run);
      for (let j = 0; j < run; j++) this.parts.push(data[i + j] & 0xff);
    }
    return this.byte(0);
  }

  toBuffer(): Buffer {
    return Buffer.from(this.parts);
  }
}

/**
 * LZW as GIF uses it, which is not quite LZW as anybody else does.
 *
 * The differences that matter: codes are variable width and grow as the table
 * fills, there are two reserved codes above the palette (clear and end), and
 * the bits pack little-endian within each byte. Getting any one of those wrong
 * produces a file that opens and shows garbage, which is why the clear-code
 * handling below is written out rather than folded into the loop.
 */
function lzw(pixels: Uint8Array, minCodeSize: number): number[] {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let next = endCode + 1;

  let dict = new Map<string, number>();
  const reset = (): void => {
    dict = new Map();
    for (let i = 0; i < clearCode; i++) dict.set(String(i), i);
    codeSize = minCodeSize + 1;
    next = endCode + 1;
  };

  const out: number[] = [];
  let acc = 0;
  let accBits = 0;
  const emit = (code: number): void => {
    acc |= code << accBits;
    accBits += codeSize;
    while (accBits >= 8) {
      out.push(acc & 0xff);
      acc >>= 8;
      accBits -= 8;
    }
  };

  reset();
  emit(clearCode);

  let prefix = String(pixels[0]);
  for (let i = 1; i < pixels.length; i++) {
    const k = pixels[i];
    const candidate = `${prefix},${k}`;
    if (dict.has(candidate)) {
      prefix = candidate;
      continue;
    }
    emit(dict.get(prefix) as number);
    if (next < 4096) {
      dict.set(candidate, next++);
      // The width grows *after* the code that filled the last slot, not
      // before. One off here and every decoder in the world disagrees with us.
      if (next - 1 === (1 << codeSize) && codeSize < 12) codeSize++;
    } else {
      emit(clearCode);
      reset();
    }
    prefix = String(k);
  }
  emit(dict.get(prefix) as number);
  emit(endCode);
  if (accBits > 0) out.push(acc & 0xff);
  return out;
}

export interface GifOptions {
  width: number;
  height: number;
  /** Up to 256 entries of [r, g, b]. */
  palette: [number, number, number][];
  /** Hundredths of a second per frame. Below 2 most browsers clamp to 10. */
  delay: number;
  /** 0 loops forever. */
  loops?: number;
}

/**
 * Build a whole animation in memory.
 *
 * In memory rather than streamed because a 512×512 region for 240 years is
 * about sixty megabytes of indices before compression, which is nothing, and
 * because streaming would buy complexity for a tool that runs once.
 */
export function encodeGif(frames: Uint8Array[], opts: GifOptions): Buffer {
  const { width, height, palette, delay } = opts;
  if (palette.length > 256) throw new Error('a GIF palette is at most 256 colours');

  // The colour table has to be a power of two, so round up and pad.
  let bits = 1;
  while (1 << bits < palette.length) bits++;
  const tableSize = 1 << bits;

  const s = new ByteStream();
  s.ascii(HEADER);
  s.short(width).short(height);
  // Global colour table, 8 bits of colour resolution, table size in the low
  // three bits.
  s.byte(0x80 | 0x70 | (bits - 1));
  s.byte(0).byte(0);
  for (let i = 0; i < tableSize; i++) {
    const c = palette[i] ?? [0, 0, 0];
    s.byte(c[0]).byte(c[1]).byte(c[2]);
  }

  // Netscape application extension: the only way to say "loop".
  s.byte(0x21).byte(0xff).byte(11).ascii('NETSCAPE2.0');
  s.byte(3).byte(1).short(opts.loops ?? 0).byte(0);

  const minCodeSize = Math.max(2, bits);
  for (const frame of frames) {
    if (frame.length !== width * height) throw new Error('frame is the wrong size');
    // Graphic control: no transparency, no disposal — every frame is complete,
    // which costs a little size and removes a whole class of decoder bug.
    s.byte(0x21).byte(0xf9).byte(4).byte(0).short(delay).byte(0).byte(0);
    s.byte(0x2c);
    s.short(0).short(0).short(width).short(height).byte(0);
    s.byte(minCodeSize);
    s.subBlocks(lzw(frame, minCodeSize));
  }
  s.byte(0x3b);
  return s.toBuffer();
}
