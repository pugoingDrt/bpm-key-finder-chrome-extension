# Copied code — do not edit here

These files are byte-for-byte copies from the removebackgroundmusic project
(`src/lib/`), so the extension gives the same results as the website's
Key & BPM Finder:

| File | Source |
| --- | --- |
| key-bpm.ts | src/lib/key-bpm.ts |
| audio-resample.ts | src/lib/audio-resample.ts |
| audio-downmix.ts | src/lib/audio-downmix.ts |
| next-task.ts | src/lib/next-task.ts |
| song-decode.ts | src/lib/song-decode.ts |

Copied from commit `b300c9d` (2026-11-25). Their `@/lib/...` imports are
resolved to this folder by the build (esbuild alias) and tsconfig paths.

To update: copy the files again from the site project, note the new
commit here, then `pnpm typecheck && pnpm build && pnpm smoke` and bump the
version in `static/manifest.json`. `song-decode.ts` needs `mediabunny`
(MPL-2.0); keep its version in the root package.json equal to the site's.
