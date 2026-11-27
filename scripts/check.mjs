// Pre-upload checks for one extension: manifest basics, permissions, every
// locale has every message (with its placeholders), store limits on the
// name (75) and summary (132), a store listing per locale, every message
// the code and pages use exists, and the build loads no remote code.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { extensionFromArgs } from './lib.mjs';

const ext = extensionFromArgs();
const errors = [];
const notes = [];
const read = (file) => readFileSync(file, 'utf8');

const manifest = JSON.parse(read(join(ext.static, 'manifest.json')));
if (manifest.manifest_version !== 3) errors.push('manifest_version must be 3');
for (const field of [
  'permissions',
  'host_permissions',
  'optional_permissions',
  'optional_host_permissions',
]) {
  if (manifest[field]?.length)
    notes.push(
      `${field}: ${manifest[field].join(', ')} (justify each in the Privacy practices tab)`
    );
}
if (manifest.content_scripts?.length)
  notes.push('content_scripts present: they need host access and a justification');

const localesDir = join(ext.static, '_locales');
const base = manifest.default_locale;
if (!base) errors.push('manifest has no default_locale');
const locales = readdirSync(localesDir).filter(
  (name) => !name.startsWith('.') && statSync(join(localesDir, name)).isDirectory()
);
const load = (locale) =>
  JSON.parse(read(join(localesDir, locale, 'messages.json')));
const baseMessages = load(base);
const baseKeys = Object.keys(baseMessages);

/** Placeholders by lower-case name (Chrome matches them ignoring case). */
const holders = (entry) =>
  Object.fromEntries(
    Object.entries(entry?.placeholders ?? {}).map(([name, value]) => [name.toLowerCase(), value])
  );

/** A message with its named placeholders filled by their content ($1…). */
const resolve = (messages, key) => {
  const entry = messages[key];
  if (!entry) return null;
  return entry.message.replace(/\$([A-Za-z0-9_]+)\$/g, (_, name) => {
    const holder = holders(entry)[name.toLowerCase()];
    return holder ? holder.content : `$${name}$`;
  });
};

for (const locale of locales) {
  const messages = load(locale);
  for (const key of baseKeys)
    if (!messages[key]) errors.push(`${locale}: missing ${key}`);
  for (const key of Object.keys(messages)) {
    if (!baseMessages[key])
      errors.push(`${locale}: extra key ${key} (not in ${base})`);
    const entry = messages[key];
    for (const [, name] of entry.message.matchAll(/\$([A-Za-z0-9_]+)\$/g)) {
      if (!holders(entry)[name.toLowerCase()])
        errors.push(`${locale}: ${key} uses $${name}$ without a placeholder`);
    }
    // A bare $1 or a lone $ in the text is a substitution to Chrome, not
    // text ("US$9" shows as "US"): use a placeholder, or $$ for "$".
    const bare = entry.message
      .replace(/\$\$/g, '')
      .replace(/\$[A-Za-z0-9_]+\$/g, '');
    if (/\$\d/.test(bare))
      errors.push(`${locale}: ${key} has a bare $<digit>; use a named placeholder`);
    const signature = (value) =>
      Object.entries(holders(value))
        .map(([name, holder]) => `${name}=${holder.content}`)
        .sort()
        .join();
    if (baseMessages[key] && signature(entry) !== signature(baseMessages[key]))
      errors.push(
        `${locale}: ${key} placeholders [${signature(entry)}] differ from ${base} [${signature(baseMessages[key])}]`
      );
  }
  const name = resolve(messages, 'extName') ?? '';
  const summary = resolve(messages, 'extDescription') ?? '';
  if (name.length > 75)
    errors.push(`${locale}: extName is ${name.length} chars (max 75)`);
  if (summary.length > 132)
    errors.push(`${locale}: extDescription is ${summary.length} chars (max 132)`);
  notes.push(`${locale}: name ${name.length}/75, summary ${summary.length}/132`);
  const listing = join(ext.store, 'listing', `${locale}.md`);
  if (!existsSync(listing))
    errors.push(`${locale}: no store listing at ${relative(ext.dir, listing)}`);
}

// Messages used by the code (t('key') / t("key")) and pages (data-i18n*).
const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const file = join(dir, name);
    return statSync(file).isDirectory() ? walk(file) : [file];
  });
const used = new Set();
// Keys passed to t() must exist; any other string literal that names a
// message (e.g. picked in a ternary) counts as a use for the unused report.
const mentioned = new Set();
for (const file of walk(ext.src).filter((f) => f.endsWith('.ts'))) {
  const text = read(file);
  for (const [, key] of text.matchAll(/\bt\(\s*['"]([A-Za-z0-9_]+)['"]/g)) used.add(key);
  for (const [, key] of text.matchAll(/['"`]([A-Za-z0-9_]+)['"`]/g)) mentioned.add(key);
}
for (const file of walk(ext.static).filter((f) => f.endsWith('.html'))) {
  for (const [, key] of read(file).matchAll(
    /data-i18n(?:-[a-z-]+)?="([A-Za-z0-9_]+)"/g
  ))
    used.add(key);
}
for (const [, key] of JSON.stringify(manifest).matchAll(
  /__MSG_([A-Za-z0-9_]+)__/g
))
  used.add(key);
for (const key of used)
  if (!baseMessages[key])
    errors.push(`message "${key}" is used but not defined in ${base}`);
const unused = baseKeys.filter(
  (key) => !used.has(key) && !mentioned.has(key) && key !== 'locale_code'
);
if (unused.length)
  notes.push(
    `messages not referenced literally (fine if built dynamically): ${unused.join(', ')}`
  );

// The build: no remote scripts or styles.
if (existsSync(ext.dist)) {
  for (const file of walk(ext.dist).filter((f) => /\.(html|js|css)$/.test(f))) {
    const text = read(file);
    if (
      /<script[^>]+src=["']?(https?:)?\/\//i.test(text) ||
      /<link[^>]+href=["']?(https?:)?\/\/[^>]*>/i.test(text) ||
      /@import\s+(url\()?["']?(https?:)?\/\//i.test(text) ||
      /\bimport\s*\(\s*["'`](https?:)?\/\//i.test(text) ||
      /\bimportScripts\s*\(\s*["'`](https?:)?\/\//i.test(text)
    )
      errors.push(`${relative(ext.dist, file)} loads a remote script or style`);
  }
} else {
  notes.push('no dist yet: run pnpm build first to check the build');
}

for (const note of notes) console.log(`· ${note}`);
if (errors.length) {
  for (const error of errors) console.error(`✗ ${error}`);
  process.exit(1);
}
console.log(
  `✓ ${ext.name}: ${locales.length} locales, ${baseKeys.length} messages, checks passed`
);
