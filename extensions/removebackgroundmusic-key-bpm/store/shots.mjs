// Store screenshots and promo tiles (run with `pnpm shoot`, preview server
// running). The demo songs are synthesised in the page (chords, bass and a
// drum loop at a known key and tempo) and dropped onto it, so every result
// in the pictures is the extension's own real output.
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LOCALES = ['en', 'es', 'pt_BR', 'pt_PT', 'fr', 'de', 'ru', 'ja', 'ko'];

/** Page code: synthesise demo songs and drop them onto the page. */
const DEMO = `
const wav = (buffer) => {
  const channels = buffer.numberOfChannels, rate = buffer.sampleRate, frames = buffer.length;
  const out = new DataView(new ArrayBuffer(44 + frames * channels * 2));
  const text = (offset, s) => [...s].forEach((c, i) => out.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF'); out.setUint32(4, 36 + frames * channels * 2, true); text(8, 'WAVE');
  text(12, 'fmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, channels, true);
  out.setUint32(24, rate, true); out.setUint32(28, rate * channels * 2, true); out.setUint16(32, channels * 2, true);
  out.setUint16(34, 16, true); text(36, 'data'); out.setUint32(40, frames * channels * 2, true);
  const data = [...Array(channels)].map((_, c) => buffer.getChannelData(c));
  let p = 44;
  for (let i = 0; i < frames; i++) for (let c = 0; c < channels; c++) {
    const v = Math.max(-1, Math.min(1, data[c][i])); out.setInt16(p, v * 0x7fff, true); p += 2;
  }
  return out.buffer;
};
const song = async (root, minor, bpm, seconds) => {
  const rate = 44100, ctx = new OfflineAudioContext(2, rate * seconds, rate);
  const beat = 60 / bpm, master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);
  const hz = (m) => 440 * 2 ** ((m - 69) / 12);
  const prog = minor ? [[0, 3, 7], [5, 8, 12], [0, 3, 7], [7, 10, 14]] : [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]];
  const tone = (m, t, d, type, gain) => {
    const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = type; o.frequency.value = hz(m); f.type = 'lowpass'; f.frequency.value = 2200;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.02); g.gain.setTargetAtTime(0, t + d * 0.85, 0.05);
    o.connect(f).connect(g).connect(master); o.start(t); o.stop(t + d + 0.3);
  };
  const noise = ctx.createBuffer(1, rate * 0.05, rate); const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  for (let bar = 0; bar * 4 * beat < seconds; bar++) {
    const t0 = bar * 4 * beat, chord = prog[bar % 4];
    for (const n of chord) tone(root + 48 + n, t0, 4 * beat, 'sawtooth', 0.05);
    tone(root + 36 + chord[0], t0, 4 * beat, 'triangle', 0.25);
    tone(root + 60 + chord[(bar + 1) % 3], t0 + 2 * beat, beat, 'triangle', 0.08);
    for (let b = 0; b < 4; b++) {
      const t = t0 + b * beat;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
      g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      o.connect(g).connect(master); o.start(t); o.stop(t + 0.3);
      const h = ctx.createBufferSource(), hg = ctx.createGain(), hf = ctx.createBiquadFilter();
      h.buffer = noise; hf.type = 'highpass'; hf.frequency.value = 7000; hg.gain.value = 0.15;
      h.connect(hf).connect(hg).connect(master); h.start(t + beat / 2);
    }
  }
  return new File([wav(await ctx.startRendering())], '', { type: 'audio/wav' });
};
const demo = async (list) => {
  const files = [];
  for (const [name, root, minor, bpm, seconds] of list) {
    const file = await song(root, minor, bpm, seconds);
    files.push(new File([file], name, { type: 'audio/wav' }));
  }
  const dt = new DataTransfer();
  files.forEach((f) => dt.items.add(f));
  window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  const start = Date.now();
  while (document.querySelectorAll('.item.is-done, .error:not([hidden])').length < list.length) {
    if (Date.now() - start > 120000) throw new Error('analysis timed out');
    await new Promise((r) => setTimeout(r, 200));
  }
  return [...document.querySelectorAll('.item')].map((el) => el.innerText.replace(/\\s+/g, ' ')).join(' || ');
};
`;

/** Root (0 = C), minor, BPM, seconds. */
const SONGS = `[
  ['midnight-drive.wav', 9, true, 124, 24],
  ['summer-hook-v2.wav', 7, false, 98, 24],
  ['deep-house-intro.wav', 2, true, 122, 24],
  ['acoustic-demo.wav', 5, false, 86, 24],
]`;

const tap = (bpm, taps) => `
for (let i = 0; i < ${taps}; i++) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 't', code: 'KeyT', bubbles: true }));
  await new Promise((r) => setTimeout(r, ${Math.round(60000 / bpm)}));
}
`;

const promo = (file) => pathToFileURL(join(HERE, 'promo', file)).href;

export default [
  // Smoke test of the bundled sample (not a store image; store/checks is
  // git-ignored).
  {
    url: 'app.html?lang=en',
    out: 'checks/sample-en.png',
    width: 1280,
    height: 800,
    before: `document.querySelector('#sample').click();
const start = Date.now();
while (!document.querySelector('.item.is-done, .error:not([hidden])')) {
  if (Date.now() - start > 60000) throw new Error('sample timed out');
  await new Promise((r) => setTimeout(r, 200));
}
return document.querySelector('.item').innerText.replace(/\\s+/g, ' ');`,
  },
  // Results, one per language (upload each to its own listing language).
  ...LOCALES.map((locale) => ({
    url: `app.html?lang=${locale}`,
    out: `images/screenshot-1-results-${locale}.png`,
    width: 1280,
    height: 800,
    before: `${DEMO}${tap(124, 9)} return demo(${SONGS});`,
  })),
  // Dark mode, a single song and tap tempo.
  {
    url: 'app.html?lang=en',
    out: 'images/screenshot-2-dark-en.png',
    width: 1280,
    height: 800,
    scheme: 'dark',
    before: `${DEMO}${tap(128, 10)} return demo([['festival-anthem-final.wav', 4, true, 128, 24]]);`,
  },
  // First screen: drop zone.
  {
    url: 'app.html?lang=en',
    out: 'images/screenshot-3-start-en.png',
    width: 1280,
    height: 800,
    before: `document.body.classList.add('dragging'); return 'start';`,
  },
  { url: promo('small-tile.html'), out: 'images/promo-small-440x280.png', width: 440, height: 280 },
  { url: promo('marquee.html'), out: 'images/promo-marquee-1400x560.png', width: 1400, height: 560 },
];
