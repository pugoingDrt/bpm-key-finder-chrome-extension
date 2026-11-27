/**
 * Speaker down-mix of decoded sound to at most two channels, with Web
 * Audio's own rules (the channel order is Web Audio's: L R C LFE SL SR):
 * quad and 5.1 keep their centre and surrounds, the LFE is left out, and
 * other layouts keep their first two channels. Mono and stereo are
 * returned as they are (views, no copy).
 */
export function stereoChannels(
  buffer: AudioBuffer,
  from = 0,
  to = buffer.length
): Float32Array<ArrayBuffer>[] {
  const channels = buffer.numberOfChannels;
  const plane = (index: number) =>
    buffer.getChannelData(index).subarray(from, to);
  if (channels <= 2) {
    return Array.from({ length: channels }, (_, index) => plane(index));
  }
  const length = Math.max(0, to - from);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  if (channels === 4) {
    // L R SL SR
    const [l, r, sl, sr] = [plane(0), plane(1), plane(2), plane(3)];
    for (let i = 0; i < length; i += 1) {
      left[i] = 0.5 * (l[i]! + sl[i]!);
      right[i] = 0.5 * (r[i]! + sr[i]!);
    }
  } else if (channels === 6) {
    // L R C LFE SL SR
    const [l, r, c, sl, sr] = [
      plane(0),
      plane(1),
      plane(2),
      plane(4),
      plane(5),
    ];
    const k = Math.SQRT1_2;
    for (let i = 0; i < length; i += 1) {
      const center = k * c[i]!;
      left[i] = l[i]! + center + k * sl[i]!;
      right[i] = r[i]! + center + k * sr[i]!;
    }
  } else {
    left.set(plane(0));
    right.set(plane(1));
  }
  return [left, right];
}

/** `stereoChannels` as an AudioBuffer (the same one when nothing changes). */
export function stereoBuffer(
  buffer: AudioBuffer,
  from = 0,
  to = buffer.length
) {
  if (buffer.numberOfChannels <= 2 && from === 0 && to === buffer.length)
    return buffer;
  const planes = stereoChannels(buffer, from, to);
  const out = new AudioBuffer({
    length: Math.max(1, to - from),
    numberOfChannels: planes.length,
    sampleRate: buffer.sampleRate,
  });
  planes.forEach((data, index) => out.copyToChannel(data, index));
  return out;
}
