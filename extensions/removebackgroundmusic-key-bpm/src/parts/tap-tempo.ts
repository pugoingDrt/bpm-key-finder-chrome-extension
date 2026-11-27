/**
 * Tap tempo: the average beat of the last taps. A pause longer than
 * `RESET_MS` starts a new count, so a new song needs no reset.
 */

const RESET_MS = 2000;
/** Taps kept for the average (enough to steady it, short enough to follow
 *  a change of tempo). */
const WINDOW = 12;

export interface TapReading {
  /** Taps in the current count. */
  count: number;
  /** Null until there are two intervals to average. */
  bpm: number | null;
}

export class TapTempo {
  private taps: number[] = [];
  private total = 0;

  tap(now: number): TapReading {
    const last = this.taps[this.taps.length - 1];
    if (last !== undefined && now - last > RESET_MS) this.reset();
    this.taps.push(now);
    this.total += 1;
    if (this.taps.length > WINDOW) this.taps.shift();
    return this.reading();
  }

  reset() {
    this.taps = [];
    this.total = 0;
  }

  private reading(): TapReading {
    const count = this.total;
    const kept = this.taps.length;
    if (kept < 3) return { count, bpm: null };
    const first = this.taps[0]!;
    const last = this.taps[kept - 1]!;
    return { count, bpm: (60_000 * (kept - 1)) / (last - first) };
  }
}
