// Build settings for scripts/build.mjs.
export default {
  // song-decode.ts loads mediabunny with `import('mediabunny')`, which keeps
  // the whole library (muxers, encoders, HLS, capture: ~730 KB with worker
  // code). Only its four decoding parts are bundled instead.
  redirect: { mediabunny: './src/parts/mediabunny-decode.ts' },
  // Bundled packages whose LICENSE ships in the package (licenses/<pkg>.txt).
  licenses: ['mediabunny'],
};
