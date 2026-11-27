// Serves an extension's dist on http://127.0.0.1 (this machine only) so its
// pages can be opened in a normal tab, for screenshots and quick checks. A
// stand-in for chrome.i18n / chrome.runtime is injected before the page's
// scripts; pick the language with ?lang=de (one of the dist's _locales,
// else the default locale). Like Chrome, a message missing from the chosen
// locale falls back to the default one. Not part of the package.
import { createServer } from 'node:http';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';
import { extensionFromArgs } from './lib.mjs';

const ext = extensionFromArgs();
const portArg = process.argv.find((arg) => arg.startsWith('--port='));
const port = Number(portArg?.slice(7) ?? 4310);
const manifestFile = join(ext.dist, 'manifest.json');
if (!existsSync(manifestFile)) {
  console.error(`No build found. Run: pnpm build ${ext.name}`);
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
const localesDir = join(ext.dist, '_locales');
const locales = new Set(
  readdirSync(localesDir).filter((name) => statSync(join(localesDir, name)).isDirectory())
);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.txt': 'text/plain; charset=utf-8',
};

const readMessages = (locale) =>
  JSON.parse(readFileSync(join(localesDir, locale, 'messages.json'), 'utf8'));

function shim(lang) {
  const chosen = locales.has(lang) ? lang : manifest.default_locale;
  const messages = { ...readMessages(manifest.default_locale), ...readMessages(chosen) };
  // "<" escaped so no message can close the script element.
  const data = JSON.stringify(messages).replace(/</g, '\\u003c');
  return `<script>
(() => {
  const messages = ${data};
  const getMessage = (name, subs) => {
    const entry = messages[name];
    if (!entry) return '';
    const list = subs == null ? [] : Array.isArray(subs) ? subs : [subs];
    const fill = (text) =>
      text.replace(/\\$(\\$|\\d)/g, (_, c) => (c === '$' ? '$' : String(list[Number(c) - 1] ?? '')));
    // Like Chrome: placeholders become their content ($1…), then one pass
    // fills $1… and $$, so substituted values are never scanned again.
    return fill(entry.message.replace(/\\$([A-Za-z0-9_]+)\\$/g, (_, ph) =>
      entry.placeholders?.[ph.toLowerCase()]?.content ?? ''));
  };
  globalThis.chrome = {
    i18n: { getMessage, getUILanguage: () => ${JSON.stringify(chosen.replace('_', '-'))} },
    runtime: { getURL: (path) => new URL(path, location.origin + '/').href },
  };
})();
</script>`;
}

const root = resolve(ext.dist);
createServer((req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    let path;
    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      res.writeHead(400).end('Bad request');
      return;
    }
    const file = resolve(root, `.${path === '/' ? '/app.html' : path}`);
    const inside = relative(root, file);
    if (inside.startsWith('..') || inside.includes(`..${sep}`) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404).end('Not found');
      return;
    }
    let body = readFileSync(file);
    if (extname(file) === '.html') {
      const lang = url.searchParams.get('lang') ?? manifest.default_locale;
      // A function, so "$'" and "$$" in the shim are not replacement patterns.
      body = Buffer.from(body.toString('utf8').replace('<head>', () => `<head>${shim(lang)}`));
    }
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.writeHead(500);
    res.end('Server error');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(
    `Preview of ${ext.name}: http://localhost:${port}/app.html?lang=${manifest.default_locale}`
  );
});
