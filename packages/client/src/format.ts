/**
 * Formatting. All money in the simulation is integer pence; nothing outside
 * this file should ever divide it by a hundred, because that is how a display
 * rounding quietly becomes a state rounding.
 */

const GBP = '£';

export function money(pence: number, sign = false): string {
  const p = Math.round(pence);
  const neg = p < 0;
  const abs = Math.abs(p);
  const pounds = abs / 100;
  let body: string;
  if (pounds >= 1e9) body = `${(pounds / 1e9).toFixed(2)}bn`;
  else if (pounds >= 1e6) body = `${(pounds / 1e6).toFixed(2)}m`;
  else if (pounds >= 1e4) body = Math.round(pounds).toLocaleString('en-GB');
  else body = pounds.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const prefix = neg ? '-' : sign ? '+' : '';
  return `${prefix}${GBP}${body}`;
}

export function shortMoney(pence: number): string {
  const p = Math.abs(Math.round(pence)) / 100;
  const s = p >= 1e6 ? `${(p / 1e6).toFixed(1)}m` : p >= 1e3 ? `${(p / 1e3).toFixed(1)}k` : p.toFixed(0);
  return `${pence < 0 ? '-' : ''}${GBP}${s}`;
}

/**
 * A price to compare, not to budget with. "£130k", "£21k", "£1.2m".
 *
 * Not `shortMoney`, which keeps a decimal on the thousands and gives "£130.0k" — a
 * figure with a false precision in it. This one is for a row of buildings in the
 * Build tray, where what matters is that a creamery is dearer than a sawmill and
 * nothing at all turns on the hundreds. The exact pounds appear when the cursor is
 * over the ground and the game knows which spot is being asked about.
 *
 * A decimal only under ten of whatever unit it is in, which is where the difference
 * between 1.2 and 2.0 is most of the number.
 */
export function roughMoney(pence: number): string {
  const p = Math.abs(Math.round(pence)) / 100;
  const sign = pence < 0 ? '-' : '';
  if (p >= 1e6) {
    const m = p / 1e6;
    return `${sign}${GBP}${m < 10 ? m.toFixed(1) : Math.round(m)}m`;
  }
  if (p >= 1e3) {
    const k = p / 1e3;
    return `${sign}${GBP}${k < 10 ? k.toFixed(1) : Math.round(k)}k`;
  }
  return `${sign}${GBP}${Math.round(p)}`;
}

export function num(n: number, digits = 0): string {
  return n.toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function tonnes(t: number): string {
  return t >= 1e6 ? `${(t / 1e6).toFixed(1)}Mt` : t >= 1000 ? `${(t / 1000).toFixed(1)}kt` : `${Math.round(t)}t`;
}

/** Ticks as a human duration, in game days. */
export function days(ticks: number, ticksPerDay: number): string {
  const d = Math.round(ticks / ticksPerDay);
  if (d < 1) return 'today';
  if (d < 30) return `${d}d`;
  const months = Math.round(d / 20);
  if (months < 12) return `${months}mo`;
  return `${(d / 240).toFixed(1)}y`;
}

export function pct(n: number): string {
  return `${Math.round(n)}%`;
}

/** Colour class for a signed figure. Semantic set only. */
export function signClass(n: number): string {
  return n > 0 ? 'pos' : n < 0 ? 'neg' : 'dim';
}
