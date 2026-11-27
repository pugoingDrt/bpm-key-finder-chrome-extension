/**
 * Browser-side key and tempo of a song: the result of the free Key & BPM
 * Finder (14), and the tempo and key signature Song to MIDI (13) writes
 * into its files. Written here (no library): the best open-source
 * analysers are AGPL.
 *
 * Key: spectral peaks of the whole song folded into a 12-note pitch-class
 * profile, corrected for tuning that is not A = 440 Hz, and matched against
 * major and minor key profiles (Sha'ath 2011, as in KeyFinder); the best
 * correlation of the 24 keys wins.
 *
 * Tempo: an onset envelope (spectral flux), its autocorrelation weighted
 * towards common tempos, then a fine search over the beat period with the
 * first few multiples, so the result is accurate to well under 1 BPM.
 */

import { monoAt } from '@/lib/audio-resample';
import { nextTask } from '@/lib/next-task';
import { stopIfAborted } from '@/lib/song-decode';

export type KeyMode = 'major' | 'minor';

export interface MusicalKey {
  /** Pitch class of the tonic, 0 = C … 11 = B. */
  tonic: number;
  mode: KeyMode;
}

export interface KeyBpmAnalysis {
  /** Null when no notes were heard (silence, or under a second of audio). */
  key: MusicalKey | null;
  /** Correlation of the winning key, −1…1 (display only). */
  keyStrength: number;
  /** Winner's correlation minus the best unrelated key's (see matchKey). */
  keyMargin: number;
  /** How much of the sound sits on semitones (see pitchProfile). */
  tonalness: number;
  chroma: number[];
  /** Beats per minute, folded into 70–180. */
  bpm: number;
  /** How clearly the beat stands out (best period ÷ average period). */
  pulse: number;
}

/** Analysis runs at this rate: enough for pitch and onsets, and light. */
const RATE = 11_025;

// ---------------------------------------------------------------- FFT ---

/** Twiddle factors and bit-reversal order per FFT size, computed once. */
const fftTables = new Map<
  number,
  { cos: Float64Array; sin: Float64Array; swaps: Uint32Array }
>();

function tablesFor(n: number) {
  let tables = fftTables.get(n);
  if (tables) return tables;
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let k = 0; k < n / 2; k += 1) {
    cos[k] = Math.cos((-2 * Math.PI * k) / n);
    sin[k] = Math.sin((-2 * Math.PI * k) / n);
  }
  const pairs: number[] = [];
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) pairs.push(i, j);
  }
  tables = { cos, sin, swaps: Uint32Array.from(pairs) };
  fftTables.set(n, tables);
  return tables;
}

/** In-place radix-2 FFT of `re` / `im` (length a power of two). */
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  const { cos, sin, swaps } = tablesFor(n);
  for (let p = 0; p < swaps.length; p += 2) {
    const i = swaps[p]!;
    const j = swaps[p + 1]!;
    const r = re[i]!;
    re[i] = re[j]!;
    re[j] = r;
    const m = im[i]!;
    im[i] = im[j]!;
    im[j] = m;
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const stride = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k += 1) {
        const wr = cos[k * stride]!;
        const wi = sin[k * stride]!;
        const a = start + k;
        const b = a + half;
        const tr = wr * re[b]! - wi * im[b]!;
        const ti = wr * im[b]! + wi * re[b]!;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
      }
    }
  }
}

function hann(size: number) {
  const window = new Float64Array(size);
  for (let i = 0; i < size; i += 1)
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  return window;
}

/**
 * Magnitude spectra of `signal` frame by frame (Hann window); `onFrame`
 * gets the frame index and the magnitudes (reused between calls). Yields to
 * the page every `yieldEvery` frames.
 */
async function forEachSpectrum(
  signal: Float32Array,
  size: number,
  hop: number,
  onFrame: (index: number, magnitudes: Float64Array) => void,
  options: {
    abort?: AbortSignal;
    onProgress?: (value: number) => void;
    yieldEvery?: number;
  }
) {
  const window = hann(size);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const magnitudes = new Float64Array(size / 2);
  const frames = Math.max(0, Math.floor((signal.length - size) / hop) + 1);
  const yieldEvery = options.yieldEvery ?? 256;
  for (let frame = 0; frame < frames; frame += 1) {
    const offset = frame * hop;
    for (let i = 0; i < size; i += 1) {
      re[i] = signal[offset + i]! * window[i]!;
      im[i] = 0;
    }
    fft(re, im);
    for (let i = 0; i < size / 2; i += 1) {
      const r = re[i]!;
      const m = im[i]!;
      magnitudes[i] = Math.sqrt(r * r + m * m);
    }
    onFrame(frame, magnitudes);
    if (frame % yieldEvery === yieldEvery - 1) {
      options.onProgress?.(frame / frames);
      await nextTask();
      stopIfAborted(options.abort);
    }
  }
  return frames;
}

// --------------------------------------------------------------- Key ---

/** Sha'ath (2011) key profiles, tonic first. */
const MAJOR_PROFILE = [
  7.239, 3.5035, 3.584, 2.8496, 5.8187, 4.559, 2.4486, 6.9945, 3.3907, 4.5569,
  4.0716, 4.46,
];
const MINOR_PROFILE = [
  7.0035, 3.144, 4.3523, 5.4812, 3.6765, 4.0862, 3.6783, 6.8793, 5.5849, 3.295,
  3.2866, 3.6061,
];

/** Sub-steps per semitone of the fine pitch histogram (tuning). */
const STEPS = 10;
const LOW_HZ = 65; // C2
const HIGH_HZ = 2100; // ~C7

function correlation(a: readonly number[], b: readonly number[]) {
  const n = a.length;
  const meanA = a.reduce((s, v) => s + v, 0) / n;
  const meanB = b.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i += 1) {
    const x = a[i]! - meanA;
    const y = b[i]! - meanB;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

/**
 * Whether the sound has a key to report. Measured 2026-11-13 on the site's
 * clips through the low-passed input (audio-resample): music with a key
 * (mixes, stems, beds, the three tools' samples; 14 clips) has tonalness
 * 0.327–0.401, or a strength of 0.517 at 0.310 (a rock vocal stem); a
 * mix with an unclear key reads 0.312 and is left without one; inputs
 * without a key (drum stems, speech, white / pink / brown noise; 8 clips)
 * have tonalness 0.302–0.309. The filter barely moved these (music
 * +0.001–0.012, the rest ±0.002), so the limits stand.
 * Kept on the cautious side: a key is shown unless both are low.
 */
const MIN_TONALNESS = 0.32;
const MIN_KEY_STRENGTH = 0.5;
export function hasClearKey(tonalness: number, strength: number) {
  return tonalness >= MIN_TONALNESS || strength >= MIN_KEY_STRENGTH;
}

/** The best of the 24 keys for a 12-note profile (index 0 = C). */
export function matchKey(chroma: readonly number[]) {
  let best: MusicalKey = { tonic: 0, mode: 'major' };
  let bestScore = -Infinity;
  const scores: { key: MusicalKey; score: number }[] = [];
  for (let tonic = 0; tonic < 12; tonic += 1) {
    const rotated = Array.from(
      { length: 12 },
      (_, i) => chroma[(i + tonic) % 12]!
    );
    for (const mode of ['major', 'minor'] as const) {
      const score = correlation(
        rotated,
        mode === 'major' ? MAJOR_PROFILE : MINOR_PROFILE
      );
      scores.push({ key: { tonic, mode }, score });
      if (score > bestScore) {
        bestScore = score;
        best = { tonic, mode };
      }
    }
  }
  // How far the winner stands above the best key that is neither it nor
  // its relative (which shares its notes): small for noise, drums or
  // speech, where every key fits about as badly.
  const relative = relativeKey(best);
  const rival = Math.max(
    ...scores
      .filter(
        ({ key }) =>
          !(key.tonic === best.tonic && key.mode === best.mode) &&
          !(key.tonic === relative.tonic && key.mode === relative.mode)
      )
      .map(({ score }) => score)
  );
  return { key: best, strength: bestScore, margin: bestScore - rival };
}

/**
 * Pitch-class profile of the song: every frame's spectral peaks (with
 * parabolic interpolation) in a fine histogram, the tuning offset that best
 * centres the peaks on semitones, then folded into 12 notes.
 */
async function pitchProfile(
  signal: Float32Array,
  options: { abort?: AbortSignal; onProgress?: (value: number) => void }
) {
  const size = 8192;
  const hop = 4096;
  const bins = 12 * STEPS;
  const fine = new Float64Array(bins);
  const lowBin = Math.ceil((LOW_HZ * size) / RATE);
  const highBin = Math.min(size / 2 - 2, Math.floor((HIGH_HZ * size) / RATE));
  await forEachSpectrum(
    signal,
    size,
    hop,
    (_, mag) => {
      let total = 0;
      for (let i = lowBin; i <= highBin; i += 1) total += mag[i]!;
      if (total <= 1e-6) return;
      for (let i = lowBin; i <= highBin; i += 1) {
        const value = mag[i]!;
        if (value <= mag[i - 1]! || value < mag[i + 1]!) continue;
        // Peak position between bins, and its frequency.
        const left = mag[i - 1]!;
        const right = mag[i + 1]!;
        const denom = left - 2 * value + right;
        const shift = denom !== 0 ? (0.5 * (left - right)) / denom : 0;
        const hz = ((i + shift) * RATE) / size;
        const midi = 12 * Math.log2(hz / 440) + 69;
        const position = (((midi % 12) + 12) % 12) * STEPS;
        // Each frame weighs the same (loud passages do not dominate);
        // stronger peaks of the frame weigh more.
        fine[Math.round(position) % bins]! += Math.sqrt(value / total);
      }
    },
    { ...options, yieldEvery: 64 }
  );

  // Tuning: the sub-step offset that puts the most energy on the notes.
  let offset = 0;
  let bestEnergy = -Infinity;
  for (let shift = -STEPS / 2; shift < STEPS / 2; shift += 1) {
    let energy = 0;
    for (let note = 0; note < 12; note += 1) {
      for (let d = -1; d <= 1; d += 1) {
        const index = (((note * STEPS + shift + d) % bins) + bins) % bins;
        energy += fine[index]! * (d === 0 ? 1 : 0.5);
      }
    }
    if (energy > bestEnergy) {
      bestEnergy = energy;
      offset = shift;
    }
  }
  const chroma = new Array<number>(12).fill(0);
  for (let note = 0; note < 12; note += 1) {
    for (let d = -STEPS / 2; d < STEPS / 2; d += 1) {
      const index = (((note * STEPS + offset + d) % bins) + bins) % bins;
      // Triangular weight around the note centre.
      chroma[note]! += fine[index]! * (1 - Math.abs(d) / (STEPS / 2));
    }
  }
  // Share of the peaks' weight within ±15 cents of a (tuned) semitone:
  // about 0.3 when peaks fall anywhere (noise, drums, speech), higher when
  // the sound is made of notes.
  let total = 0;
  let centred = 0;
  for (let i = 0; i < bins; i += 1) total += fine[i]!;
  for (let note = 0; note < 12; note += 1) {
    for (let d = -1; d <= 1; d += 1) {
      centred += fine[(((note * STEPS + offset + d) % bins) + bins) % bins]!;
    }
  }
  return { chroma, tonalness: total > 0 ? centred / total : 0 };
}

// ------------------------------------------------------------- Tempo ---

const TEMPO_SIZE = 1024;
const TEMPO_HOP = 128;
const MIN_BPM = 50;
/** Shortest audio a tempo is measured on. */
const MIN_TEMPO_SECONDS = 4;
const MAX_BPM = 220;

/** Spectral-flux onset envelope, local mean removed. */
async function onsetEnvelope(
  signal: Float32Array,
  options: { abort?: AbortSignal; onProgress?: (value: number) => void }
) {
  const frames = Math.max(
    0,
    Math.floor((signal.length - TEMPO_SIZE) / TEMPO_HOP) + 1
  );
  const envelope = new Float64Array(frames);
  const previous = new Float64Array(TEMPO_SIZE / 2);
  await forEachSpectrum(
    signal,
    TEMPO_SIZE,
    TEMPO_HOP,
    (frame, mag) => {
      let flux = 0;
      for (let i = 1; i < mag.length; i += 1) {
        const value = Math.log1p(100 * mag[i]!);
        const rise = value - previous[i]!;
        if (rise > 0 && frame > 0) flux += rise;
        previous[i] = value;
      }
      envelope[frame] = flux;
    },
    { ...options, yieldEvery: 1024 }
  );
  // Remove the slow trend (about 0.5 s), keep the peaks.
  const fps = RATE / TEMPO_HOP;
  const radius = Math.round(fps * 0.25);
  const out = new Float64Array(frames);
  let sum = 0;
  for (let i = 0; i < Math.min(frames, radius); i += 1) sum += envelope[i]!;
  for (let i = 0; i < frames; i += 1) {
    const add = i + radius;
    const drop = i - radius - 1;
    if (add < frames) sum += envelope[add]!;
    if (drop >= 0) sum -= envelope[drop]!;
    const count = Math.min(frames - 1, add) - Math.max(0, drop + 1) + 1;
    out[i] = Math.max(0, envelope[i]! - sum / count);
  }
  return out;
}

/** Autocorrelation of `x` for lags 0…maxLag (via FFT). */
function autocorrelation(x: Float64Array, maxLag: number) {
  let size = 1;
  while (size < x.length * 2) size <<= 1;
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  re.set(x);
  fft(re, im);
  for (let i = 0; i < size; i += 1) {
    re[i] = re[i]! * re[i]! + im[i]! * im[i]!;
    im[i] = 0;
  }
  // Inverse through the forward transform of the conjugate.
  fft(re, im);
  const out = new Float64Array(maxLag + 1);
  for (let lag = 0; lag <= maxLag; lag += 1) out[lag] = re[lag]! / size;
  return out;
}

/** Linear interpolation of `values` at a fractional index. */
function at(values: Float64Array, index: number) {
  const i = Math.floor(index);
  if (i < 0 || i + 1 >= values.length) return 0;
  const t = index - i;
  return values[i]! * (1 - t) + values[i + 1]! * t;
}

/** Tempo in BPM from the onset envelope. */
function tempoOf(envelope: Float64Array) {
  const fps = RATE / TEMPO_HOP;
  const maxLag = Math.ceil((fps * 60 * 4) / MIN_BPM);
  // Too short to hear a few beats (under 4 s): nothing to measure. With
  // less, most beat periods fall outside the clip and the comparison with
  // the average period means nothing.
  if (envelope.length < fps * MIN_TEMPO_SECONDS) return { bpm: 0, pulse: 0 };
  const ac = autocorrelation(envelope, Math.min(maxLag, envelope.length - 1));
  if (!(ac[0]! > 0)) return { bpm: 0, pulse: 0 };

  // A beat period and its first multiples: the comb that rewards a steady
  // pulse, weighted towards common tempos (log-normal around 120 BPM).
  const comb = (period: number) => {
    let total = 0;
    for (let k = 1; k <= 4; k += 1) total += at(ac, period * k) / k;
    return total;
  };
  const prior = (bpm: number) =>
    Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));

  let bestBpm = 0;
  let bestScore = -Infinity;
  let rawBest = 0;
  let rawTotal = 0;
  let count = 0;
  for (let bpm = MIN_BPM; bpm <= MAX_BPM; bpm += 0.5) {
    const raw = comb((fps * 60) / bpm);
    rawTotal += raw;
    count += 1;
    const score = raw * prior(bpm);
    if (score > bestScore) {
      bestScore = score;
      bestBpm = bpm;
      rawBest = raw;
    }
  }
  // How far the chosen period stands out from the average one: a steady
  // beat gives a clear peak, music without one a flat curve.
  const mean = rawTotal / count;
  const pulse = mean > 0 ? rawBest / mean : 0;
  // Fine search around it, without the prior (it would pull the value).
  let fineBpm = bestBpm;
  let fineScore = -Infinity;
  for (let bpm = bestBpm - 1; bpm <= bestBpm + 1; bpm += 0.02) {
    const score = comb((fps * 60) / bpm);
    if (score > fineScore) {
      fineScore = score;
      fineBpm = bpm;
    }
  }
  // Fold into the range most people count in.
  while (fineBpm < 70) fineBpm *= 2;
  while (fineBpm >= 180) fineBpm /= 2;
  return { bpm: fineBpm, pulse };
}

/**
 * How clearly the tempo stands out (`pulse`), measured 2026-11-13 on the
 * site's clips: songs with drums 3.6–8.4 (brushed jazz the lowest),
 * a cappella vocals 1.3, speech 1.3, noise 1.05, a two-tone drone 2.3;
 * re-measured through the low-passed input: mixes and stems with drums
 * 3.0–11.8, vocal and bass stems 1.4–1.7, speech 1.2–1.4, noise 1.03.
 * Below `NO_BEAT_PULSE` there is no beat to count; up to `CLEAR_PULSE` the
 * value is shown with a note to check it by ear (soft, sparse percussion).
 */
const NO_BEAT_PULSE = 2;
const CLEAR_PULSE = 2.8;

export type BeatClarity = 'clear' | 'weak' | 'none';

/** Whether to show the tempo, and whether to add "check it by ear". */
export function beatClarity(analysis: KeyBpmAnalysis): BeatClarity {
  if (!(analysis.bpm > 0) || analysis.pulse < NO_BEAT_PULSE) return 'none';
  return analysis.pulse < CLEAR_PULSE ? 'weak' : 'clear';
}

// ------------------------------------------------------------ Public ---

/** Mono at `RATE` (the analysis rate). */
function prepare(buffer: AudioBuffer) {
  return monoAt(buffer, RATE);
}

/**
 * Key and tempo of a decoded song (see song-decode.ts). `onProgress` gets
 * 0–1: the key pass is about a third of the work, the tempo pass the rest.
 */
export async function analyzeKeyBpm(
  buffer: AudioBuffer,
  options: { onProgress?: (value: number) => void; signal?: AbortSignal } = {}
): Promise<KeyBpmAnalysis> {
  const { signal } = options;
  const report = options.onProgress ?? (() => {});
  stopIfAborted(signal);
  const mono = await prepare(buffer);
  stopIfAborted(signal);
  const { chroma, tonalness } = await pitchProfile(mono, {
    abort: signal,
    onProgress: (value) => report(value * 0.35),
  });
  // Nothing to match (silence, or shorter than one analysis frame), or
  // nothing tonal (noise, drums, speech): no key rather than a guess.
  const heard = chroma.some((value) => value > 0);
  const found = heard ? matchKey(chroma) : null;
  const match = found && hasClearKey(tonalness, found.strength) ? found : null;
  const envelope = await onsetEnvelope(mono, {
    abort: signal,
    onProgress: (value) => report(0.35 + value * 0.6),
  });
  const { bpm, pulse } = tempoOf(envelope);
  report(1);
  return {
    key: match ? match.key : null,
    keyStrength: match?.strength ?? 0,
    keyMargin: match?.margin ?? 0,
    tonalness,
    // Profile of the notes heard (12 values from C), for calibration.
    chroma,
    bpm,
    pulse,
  };
}

// ------------------------------------------------------- Key naming ---

const SHARP_NAMES = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
];
/** Usual spellings: flats for Db, Eb, Ab, Bb majors and Eb, Bb minors. */
const MAJOR_NAMES = [
  'C',
  'Db',
  'D',
  'Eb',
  'E',
  'F',
  'F#',
  'G',
  'Ab',
  'A',
  'Bb',
  'B',
];
const MINOR_NAMES = [
  'C',
  'C#',
  'D',
  'Eb',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'Bb',
  'B',
];

/** "A", "F#", "Bb" (the tonic as usually written for this mode). */
const FLAT_NAMES = [
  'C',
  'Db',
  'D',
  'Eb',
  'E',
  'F',
  'Gb',
  'G',
  'Ab',
  'A',
  'Bb',
  'B',
];

/**
 * "A", "F#", "Bb": the tonic as usually written for its mode, or in the
 * spelling of `like` (sharps or flats) so a relative key reads as the same
 * signature: F# major ↔ D# minor, Eb minor ↔ Gb major.
 */
export function tonicName(key: MusicalKey, like?: MusicalKey) {
  if (like) {
    const family = tonicName(like);
    if (family.includes('#')) return SHARP_NAMES[key.tonic]!;
    if (family.includes('b')) return FLAT_NAMES[key.tonic]!;
  }
  return (
    (key.mode === 'major' ? MAJOR_NAMES : MINOR_NAMES)[key.tonic] ??
    SHARP_NAMES[key.tonic]!
  );
}

/**
 * Sharps (+) or flats (−) of the key's signature as `tonicName` spells it:
 * C major / A minor 0, G major 1, F major −1, F# major 6, Eb minor −6.
 */
export function keySignatureFifths(key: MusicalKey) {
  const major = key.mode === 'major' ? key.tonic : (key.tonic + 3) % 12;
  const fifths = (major * 7) % 12;
  const signed = fifths > 6 ? fifths - 12 : fifths;
  // Six sharps or six flats: follow the spelling shown (Eb minor is six
  // flats; F# major six sharps).
  if (signed === 6 && tonicName(key).includes('b')) return -6;
  return signed;
}

/** Camelot wheel: A minor = 8A, C major = 8B; a fifth up is one step on. */
export function camelot(key: MusicalKey) {
  // C major is 8B; each fifth (7 semitones) adds one.
  const fromC = key.mode === 'major' ? key.tonic : (key.tonic + 3) % 12;
  const steps = (fromC * 7) % 12;
  const number = ((7 + steps) % 12) + 1;
  return { number, letter: key.mode === 'major' ? 'B' : 'A' } as const;
}

export function camelotCode(key: MusicalKey) {
  const { number, letter } = camelot(key);
  return `${number}${letter}`;
}

/** Open Key notation: C major = 1d, A minor = 1m. */
export function openKeyCode(key: MusicalKey) {
  const { number } = camelot(key);
  return `${((number - 8 + 12) % 12) + 1}${key.mode === 'major' ? 'd' : 'm'}`;
}

/** The relative key (same notes): A minor ↔ C major. */
export function relativeKey(key: MusicalKey): MusicalKey {
  return key.mode === 'minor'
    ? { tonic: (key.tonic + 3) % 12, mode: 'major' }
    : { tonic: (key.tonic + 9) % 12, mode: 'minor' };
}

/** Keys that mix without a clash: one step either way, and the relative. */
export function compatibleCamelot(key: MusicalKey) {
  const { number, letter } = camelot(key);
  const wrap = (n: number) => ((n - 1 + 12) % 12) + 1;
  return [
    `${wrap(number - 1)}${letter}`,
    `${wrap(number + 1)}${letter}`,
    `${number}${letter === 'A' ? 'B' : 'A'}`,
  ];
}
