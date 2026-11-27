// Real-extension smoke test: loads extensions/<name>/dist unpacked in a
// headless Chrome (DevTools Extensions.loadUnpacked; branded Chrome ignores
// --load-extension), requires its service worker to start without errors,
// opens the page named in store/smoke.mjs, runs that file's check in the
// page with the real chrome.* APIs, and fails on any page error.
//
//   store/smoke.mjs: export default { page: 'app.html', check: 'async JS returning a string', timeout? }
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchChrome } from './cdp.mjs';
import { extensionFromArgs } from './lib.mjs';

const ext = extensionFromArgs();
if (!existsSync(join(ext.dist, 'manifest.json'))) {
  console.error(`No build found. Run: pnpm build ${ext.name}`);
  process.exit(1);
}
const { default: smoke } = await import(pathToFileURL(join(ext.store, 'smoke.mjs')).href);
const manifest = JSON.parse(readFileSync(join(ext.dist, 'manifest.json'), 'utf8'));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const chrome = await launchChrome({
  prefix: 'ext-smoke-',
  args: ['--enable-unsafe-extension-debugging'],
});
let ok = true;
const fail = (message) => {
  ok = false;
  console.error(`✗ ${message}`);
};
try {
  const { id: extensionId } = await chrome.send('Extensions.loadUnpacked', { path: ext.dist });
  const origin = `chrome-extension://${extensionId}`;
  console.log(`loaded ${ext.name} as ${extensionId}`);

  let targets = [];
  const wantsWorker = Boolean(manifest.background?.service_worker);
  for (let i = 0; i < 40; i += 1) {
    ({ targetInfos: targets } = await chrome.send('Target.getTargets'));
    if (!wantsWorker || targets.some((t) => t.url.startsWith(origin) && t.type === 'service_worker')) break;
    await wait(250);
  }
  const worker = targets.find((t) => t.url.startsWith(origin) && t.type === 'service_worker');
  let workerErrors = null;
  if (wantsWorker && !worker) fail('the service worker did not start');
  if (worker) {
    console.log(`✓ service worker ${worker.url.slice(origin.length)}`);
    const { sessionId } = await chrome.send('Target.attachToTarget', {
      targetId: worker.targetId,
      flatten: true,
    });
    workerErrors = chrome.collectErrors(sessionId);
    await chrome.send('Runtime.enable', {}, sessionId);
  }

  let page = targets.find((t) => t.type === 'page' && t.url === `${origin}/${smoke.page}`);
  if (page) console.log(`✓ ${smoke.page} was opened by the extension`);
  else
    page = {
      targetId: (await chrome.send('Target.createTarget', { url: `${origin}/${smoke.page}` }))
        .targetId,
    };
  const { sessionId } = await chrome.send('Target.attachToTarget', {
    targetId: page.targetId,
    flatten: true,
  });
  const pageErrors = chrome.collectErrors(sessionId);
  await chrome.send('Runtime.enable', {}, sessionId);
  // Load-time errors may predate Runtime.enable: reload once to see them.
  await chrome.send('Page.enable', {}, sessionId);
  await chrome.send('Page.reload', {}, sessionId);
  await wait(1000);
  try {
    const value = await chrome.evaluate(sessionId, smoke.check, smoke.timeout ?? 120_000);
    console.log(`✓ check: ${value}`);
  } catch (error) {
    fail(`check: ${error.message}`);
  }
  await wait(300);
  for (const error of pageErrors.errors) fail(`page error: ${error}`);
  for (const error of workerErrors?.errors ?? []) fail(`service worker error: ${error}`);
  if (ok) console.log('✓ no page or service worker errors');
} catch (error) {
  fail(error.message);
} finally {
  await chrome.close();
}
if (!ok) process.exit(1);
