// Packs extensions/<name>/dist into release/<name>-<version>.zip for upload
// to the Chrome Web Store. Refuses a build older than its sources (run
// `pnpm build <name>` and `pnpm check <name>` first).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, extensionFromArgs } from './lib.mjs';

const ext = extensionFromArgs();
const manifestFile = join(ext.dist, 'manifest.json');
if (!existsSync(manifestFile)) {
  console.error(`No build found. Run: pnpm build ${ext.name}`);
  process.exit(1);
}

/** Newest modification time under `path` (a file or folder). */
const newest = (path) => {
  if (!existsSync(path)) return 0;
  const stat = statSync(path);
  if (!stat.isDirectory()) return stat.mtimeMs;
  return Math.max(0, ...readdirSync(path).map((name) => newest(join(path, name))));
};
// The build copies static/ without keeping timestamps, so dist/manifest.json
// carries the time of the build.
const sources = Math.max(
  newest(ext.src),
  newest(ext.static),
  newest(join(ext.dir, 'build.config.mjs')),
  newest(join(ROOT, 'package.json'))
);
if (sources > statSync(manifestFile).mtimeMs) {
  console.error(`The build is older than its sources. Run: pnpm build ${ext.name}`);
  process.exit(1);
}

const { version } = JSON.parse(readFileSync(manifestFile, 'utf8'));
const releases = join(ROOT, 'release');
mkdirSync(releases, { recursive: true });
const zipFile = join(releases, `${ext.name}-${version}.zip`);
rmSync(zipFile, { force: true });
execFileSync('zip', ['-r', '-X', '-q', zipFile, '.', '-x', '*.DS_Store'], {
  cwd: ext.dist,
  stdio: 'inherit',
});
console.log(`Packed ${zipFile}`);
