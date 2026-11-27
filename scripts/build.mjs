// Builds one extension into extensions/<name>/dist: static files as they
// are, every src/*.ts entry bundled (ES modules, code split, minified, no
// source maps: all code ships inside the package, nothing is loaded from
// the network).
//
// An extension may add extensions/<name>/build.config.mjs:
//   export default {
//     redirect: { pkg: './src/parts/pkg-subset.ts' },
//     licenses: ['pkg'],
//   }
// `redirect` sends every import of a package to a local module, except the
// module's own import of it, so a subset file can re-export only what the
// extension uses (a namespace `import('pkg')` keeps the whole package).
// `licenses` copies node_modules/<pkg>/LICENSE to licenses/<pkg>.txt.
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, extensionFromArgs } from './lib.mjs';

const ext = extensionFromArgs();
const configFile = join(ext.dir, 'build.config.mjs');
const config = existsSync(configFile)
  ? (await import(pathToFileURL(configFile).href)).default
  : {};

rmSync(ext.dist, { recursive: true, force: true });
mkdirSync(ext.dist, { recursive: true });
cpSync(ext.static, ext.dist, {
  recursive: true,
  filter: (source) => !source.endsWith('.DS_Store'),
});

const entryPoints = readdirSync(ext.src)
  .filter((file) => file.endsWith('.ts') && !file.endsWith('.d.ts'))
  .map((file) => join(ext.src, file));

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const redirectPlugin = {
  name: 'redirect',
  setup(builder) {
    for (const [pkg, target] of Object.entries(config.redirect ?? {})) {
      const file = resolve(ext.dir, target);
      builder.onResolve({ filter: new RegExp(`^${escape(pkg)}$`) }, (args) =>
        resolve(args.importer) === file ? undefined : { path: file }
      );
    }
  },
};

await build({
  entryPoints,
  outdir: ext.dist,
  bundle: true,
  format: 'esm',
  splitting: true,
  minify: true,
  target: 'chrome116',
  legalComments: 'eof',
  chunkNames: 'chunks/[name]-[hash]',
  alias: { '@/lib': join(ext.src, 'vendor') },
  plugins: [redirectPlugin],
  absWorkingDir: ROOT,
  logLevel: 'info',
});

const licences = join(ext.dist, 'licenses');
for (const pkg of config.licenses ?? []) {
  const file = join(ROOT, 'node_modules', pkg, 'LICENSE');
  if (!existsSync(file)) throw new Error(`No LICENSE file for ${pkg}`);
  mkdirSync(licences, { recursive: true });
  cpSync(file, join(licences, `${pkg}.txt`));
}
console.log(`Built ${ext.name} → ${ext.dist}`);
