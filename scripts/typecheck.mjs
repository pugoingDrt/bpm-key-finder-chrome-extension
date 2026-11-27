// Type-checks every extension (or the ones named) with its own tsconfig.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { EXTENSIONS, ROOT, listExtensions } from './lib.mjs';

const named = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
const names = named.length ? named : listExtensions();
for (const name of names) {
  execFileSync(
    join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc'),
    ['--noEmit', '-p', join(EXTENSIONS, name, 'tsconfig.json')],
    { stdio: 'inherit', shell: process.platform === 'win32' }
  );
  console.log(`✓ ${name} type-checks`);
}
