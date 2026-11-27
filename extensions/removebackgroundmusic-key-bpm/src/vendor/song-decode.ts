/**
 * Browser-side decoding of a song for the free tools (14, 15): an audio or
 * video file (or the same-origin sample clip) to one AudioBuffer at 44.1 kHz
 * with at most two channels. The length is read from the headers first, so
 * a file over the limit is refused before it is decoded. Nothing leaves the
 * device. Video and formats the browser's decoder refuses go through
 * mediabunny (MPL-2.0), loaded on demand.
 */

import { stereoChannels } from '@/lib/audio-downmix';

export type SongDecodeErrorCode =
  /** The file has no sound, or the browser cannot decode it. */
  | 'unreadable'
  /** Longer than `MAX_SONG_SECONDS`. */
  | 'too_long'
  /** Stopped with `signal`. */
  | 'aborted';

export class SongDecodeError extends Error {
  constructor(
    readonly code: SongDecodeErrorCode,
    options?: { cause?: unknown }
  ) {
    super(`Song decoding failed: ${code}`, options);
    this.name = 'SongDecodeError';
  }
}

/** Songs up to this length. Slowed + Reverb holds the song, its result and
 *  the render at once: about 0.8 GB at 10 minutes, what a phone can take. */
export const MAX_SONG_SECONDS = 10 * 60;
/** Allowance over the limit for containers that round their length. */
const LENGTH_SLACK_SECONDS = 1;
/** A file mediabunny cannot measure is refused above this size (a
 *  10-minute WAV is about 100 MB). */
const UNMEASURED_MAX_BYTES = 150 * 1024 * 1024;
/** Every song is decoded at this rate (MP3-friendly, the same everywhere). */
export const SAMPLE_RATE = 44_100;

export function stopIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new SongDecodeError('aborted');
}

/** Resamples `buffer` to `SAMPLE_RATE` (at most two channels). */
async function resample(buffer: AudioBuffer) {
  const channels = Math.min(2, buffer.numberOfChannels);
  if (buffer.sampleRate === SAMPLE_RATE && buffer.numberOfChannels <= 2)
    return buffer;
  const length = Math.ceil(buffer.duration * SAMPLE_RATE);
  const context = new OfflineAudioContext(channels, length, SAMPLE_RATE);
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  source.start();
  return context.startRendering();
}

type MediaInput = InstanceType<typeof import('mediabunny').Input>;

/** Decodes with mediabunny (video files, and formats the browser's own
 *  decoder refuses, e.g. Ogg in Safari), from an input already opened. */
async function decodeWithMediabunny(
  mb: typeof import('mediabunny'),
  input: MediaInput,
  signal?: AbortSignal
) {
  let track: Awaited<ReturnType<MediaInput['getPrimaryAudioTrack']>>;
  try {
    track = await input.getPrimaryAudioTrack();
  } catch (cause) {
    throw new SongDecodeError('unreadable', { cause });
  }
  if (!track || !(await track.canDecode().catch(() => false))) {
    throw new SongDecodeError('unreadable');
  }
  stopIfAborted(signal);

  const chunks: AudioBuffer[] = [];
  let frames = 0;
  const sink = new mb.AudioBufferSink(track);
  for await (const { buffer } of sink.buffers()) {
    stopIfAborted(signal);
    chunks.push(buffer);
    frames += buffer.length;
  }
  if (frames === 0) throw new SongDecodeError('unreadable');
  // Down-mixed chunk by chunk: a 5.1 song keeps its centre (the voice)
  // and surrounds, without holding all six channels at once.
  const first = chunks[0]!;
  const channels = Math.min(2, first.numberOfChannels);
  const joined = new AudioBuffer({
    length: frames,
    numberOfChannels: channels,
    sampleRate: first.sampleRate,
  });
  let offset = 0;
  for (const chunk of chunks) {
    const planes = stereoChannels(chunk);
    for (let channel = 0; channel < channels; channel += 1) {
      joined.copyToChannel(
        planes[Math.min(channel, planes.length - 1)]!,
        channel,
        offset
      );
    }
    offset += chunk.length;
  }
  return joined;
}

/** The sample clip (same origin, a static file), as a blob. */
export async function fetchSampleSong(
  src: string,
  options: { signal?: AbortSignal } = {}
) {
  let response: Response;
  try {
    response = await fetch(src, { signal: options.signal });
  } catch (cause) {
    stopIfAborted(options.signal);
    throw new SongDecodeError('unreadable', { cause });
  }
  if (!response.ok) {
    // Leave no body unread on the shared connection (see AI_AUDIO_TASKS).
    await response.body?.cancel().catch(() => undefined);
    throw new SongDecodeError('unreadable');
  }
  const blob = await response.blob();
  stopIfAborted(options.signal);
  return blob;
}

/**
 * The sound of an audio or video file, at `SAMPLE_RATE`, ≤ 2 channels. The
 * container is opened once: its length is read from the headers first
 * (decoding a two-hour file only to refuse it would run the tab out of
 * memory), and the same input decodes it when the browser cannot.
 */
export async function decodeSong(
  file: Blob,
  options: { signal?: AbortSignal } = {}
): Promise<AudioBuffer> {
  const { signal } = options;
  stopIfAborted(signal);
  const asFile =
    file instanceof File
      ? file
      : new File([file], 'audio', { type: file.type });
  const mb = await import('mediabunny');
  const input = new mb.Input({
    source: new mb.BlobSource(asFile),
    formats: mb.ALL_FORMATS,
  });
  try {
    // The sound's length: from its first timestamp (MPEG-TS keeps its
    // broadcast clock, so the end alone can read as an hour), on its own
    // track (a video's picture can run longer).
    let seconds: number | null = null;
    try {
      const track = await input.getPrimaryAudioTrack();
      const tracks = track ? [track] : undefined;
      const end = await input.computeDuration(tracks);
      const first = await input.getFirstTimestamp(tracks).catch(() => 0);
      const value = end - (Number.isFinite(first) ? Math.max(0, first) : 0);
      if (Number.isFinite(value) && value > 0) seconds = value;
    } catch {
      seconds = null; // not a container mediabunny reads
    }
    stopIfAborted(signal);
    if (seconds !== null && seconds > MAX_SONG_SECONDS + LENGTH_SLACK_SECONDS)
      throw new SongDecodeError('too_long');
    if (seconds === null && file.size > UNMEASURED_MAX_BYTES)
      throw new SongDecodeError('too_long');

    // The browser's own decoder first for audio files (fastest), and for
    // video only where there is no WebCodecs audio decoding (Safari before
    // 26, which still decodes MP4 / MOV sound): it reads the whole file,
    // picture and all, while mediabunny reads just the sound. Each is the
    // other's fallback. The browser's is given the file whole, so only up
    // to a size.
    const isVideo =
      asFile.type.startsWith('video/') ||
      /\.(mp4|m4v|mov|mkv|webm|ts|mts|m2ts)$/i.test(asFile.name);
    const canDecodeWhole = file.size <= 400 * 1024 * 1024;
    const decodeNatively = async () => {
      if (!canDecodeWhole) return null;
      try {
        const context = new OfflineAudioContext(2, 1, SAMPLE_RATE);
        return await context.decodeAudioData(await file.arrayBuffer());
      } catch {
        return null;
      }
    };
    const nativeFirst = !isVideo || typeof AudioDecoder === 'undefined';
    let buffer: AudioBuffer | null = nativeFirst
      ? await decodeNatively()
      : null;
    stopIfAborted(signal);
    if (!buffer && seconds !== null) {
      try {
        buffer = await decodeWithMediabunny(mb, input, signal);
      } catch (error) {
        if (
          nativeFirst ||
          !(error instanceof SongDecodeError) ||
          error.code !== 'unreadable'
        )
          throw error;
      }
    }
    if (!buffer && !nativeFirst) buffer = await decodeNatively();
    stopIfAborted(signal);
    if (!buffer) throw new SongDecodeError('unreadable');
    if (buffer.duration > MAX_SONG_SECONDS + LENGTH_SLACK_SECONDS) {
      throw new SongDecodeError('too_long');
    }
    if (buffer.length === 0) throw new SongDecodeError('unreadable');
    return await resample(buffer);
  } finally {
    input.dispose();
  }
}
