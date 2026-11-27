// Shared helpers for the scripts: which extension, and its folders.
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const EXTENSIONS = join(ROOT, 'extensions');

export function listExtensions() {
  return readdirSync(EXTENSIONS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

/** The extension named on the command line (or the only one there is). */
export function extensionFromArgs(argv = process.argv.slice(2)) {
  const name = argv.find((arg) => !arg.startsWith('-'));
  const all = listExtensions();
  if (!name) {
    if (all.length === 1) return paths(all[0]);
    console.error(`Name an extension: ${all.join(', ')}`);
    process.exit(1);
  }
  if (!all.includes(name)) {
    console.error(`No extension "${name}". Known: ${all.join(', ')}`);
    process.exit(1);
  }
  return paths(name);
}

function paths(name) {
  const dir = join(EXTENSIONS, name);
  return {
    name,
    dir,
    src: join(dir, 'src'),
    static: join(dir, 'static'),
    dist: join(dir, 'dist'),
    store: join(dir, 'store'),
    has: (file) => existsSync(join(dir, file)),
  };
}
