// Writes static/_locales/<locale>/messages.json from extensions/<name>/
// locales.mjs, which exports { placeholders, descriptions, locales }:
//   placeholders: { messageKey: ['name1', 'name2'] }  ($NAME1$ → $1 …)
//   descriptions: { messageKey: 'note for translators' } (English file only)
//   locales:      { en: { key: 'text' }, de: { … } }
// Locale folders that are no longer listed are reported, not deleted.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { extensionFromArgs } from './lib.mjs';

const ext = extensionFromArgs();
const source = join(ext.dir, 'locales.mjs');
if (!existsSync(source)) {
  console.error(`${ext.name} has no locales.mjs; edit its _locales files directly.`);
  process.exit(1);
}
const { placeholders = {}, descriptions = {}, locales } = (
  await import(pathToFileURL(source).href)
).default;
const out = join(ext.static, '_locales');

for (const [code, table] of Object.entries(locales)) {
  const messages = {};
  for (const [key, message] of Object.entries(table)) {
    const entry = { message };
    if (descriptions[key] && code === 'en') entry.description = descriptions[key];
    const names = placeholders[key];
    if (names) {
      entry.placeholders = Object.fromEntries(
        names.map((name, index) => [name, { content: `$${index + 1}` }])
      );
    }
    messages[key] = entry;
  }
  mkdirSync(join(out, code), { recursive: true });
  writeFileSync(
    join(out, code, 'messages.json'),
    `${JSON.stringify(messages, null, 2)}\n`
  );
}
const stale = existsSync(out)
  ? readdirSync(out).filter((name) => !name.startsWith('.') && !(name in locales))
  : [];
console.log(`Wrote ${Object.keys(locales).length} locales for ${ext.name}`);
if (stale.length) console.log(`Not in locales.mjs (left as they are): ${stale.join(', ')}`);
