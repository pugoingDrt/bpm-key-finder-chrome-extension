/**
 * Mono at a lower sample rate, for analysis (Key & BPM at 11.025 kHz,
 * Song to MIDI's model at 22.05 kHz).
 *
 * An OfflineAudioContext at the target rate resamples, but Chrome's
 * resampler does not filter first (measured 2026-11-13: a 15 kHz tone
 * comes out at full level at 11.025 and 22.05 kHz), so cymbals, hi-hats
 * and the air above a voice fold down into the notes being measured. The
 * sound is therefore low-passed at its own rate first: an 8th-order
 * Butterworth (four biquads), cut off at 45% of the target rate, about
 * 48 dB down an octave above.
 */

/** Q of the four sections of an 8th-order Butterworth low-pass. */
const BUTTERWORTH_8_Q = [0.5098, 0.6013, 0.9, 2.5629];
const CUTOFF_OF_RATE = 0.45;

/** `buffer` down-mixed to mono at `rate`. */
export async function monoAt(
  buffer: AudioBuffer,
  rate: number
): Promise<Float32Array<ArrayBuffer>> {
  let source = buffer;
  if (rate < buffer.sampleRate) {
    const context = new OfflineAudioContext(
      1,
      Math.max(1, buffer.length),
      buffer.sampleRate
    );
    const node = context.createBufferSource();
    node.buffer = buffer;
    let last: AudioNode = node;
    for (const q of BUTTERWORTH_8_Q) {
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = rate * CUTOFF_OF_RATE;
      // Web Audio reads a low-pass Q in dB.
      filter.Q.value = 20 * Math.log10(q);
      last.connect(filter);
      last = filter;
    }
    last.connect(context.destination);
    node.start();
    source = await context.startRendering();
  }
  const length = Math.max(1, Math.ceil(source.duration * rate));
  const context = new OfflineAudioContext(1, length, rate);
  const node = context.createBufferSource();
  node.buffer = source;
  node.connect(context.destination);
  node.start();
  return (await context.startRendering()).getChannelData(0);
}
