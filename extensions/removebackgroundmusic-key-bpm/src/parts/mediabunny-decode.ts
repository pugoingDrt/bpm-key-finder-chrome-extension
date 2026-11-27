/**
 * The parts of mediabunny that src/vendor/song-decode.ts uses (reading a
 * container and decoding its audio). The build sends song-decode's
 * `import('mediabunny')` here (build.config.mjs), so the muxers, encoders
 * and capture code it never calls stay out of the package.
 */
export { ALL_FORMATS, AudioBufferSink, BlobSource, Input } from 'mediabunny';
