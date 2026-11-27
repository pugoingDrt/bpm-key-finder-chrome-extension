// Store images: opens pages in a headless Chrome (scripts/cdp.mjs), runs
// each shot's script, and saves PNGs at exact sizes. Shots are listed in
// extensions/<name>/store/shots.mjs:
//
//   export default [{ url, out, width, height, scheme?, before?, timeout? }]
//
// `url` is relative to the preview server (start `pnpm preview <name>`
// first) or absolute (file://…), `out` relative to the extension's store/
// folder, `before` async JS run in the page before the capture (a string it
// returns is printed), `timeout` its limit in ms (default 180 s). Console
// errors, page exceptions and timeouts fail the run. --only=<text> keeps
// the shots whose `out` contains <text>.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchChrome, withTimeout } from './cdp.mjs';
import { extensionFromArgs } from './lib.mjs';

const ext = extensionFromArgs();
const portArg = process.argv.find((arg) => arg.startsWith('--port='));
const base = `http://localhost:${portArg?.slice(7) ?? 4310}/`;
const only = process.argv.find((arg) => arg.startsWith('--only='))?.slice(7);
const { default: allShots } = await import(pathToFileURL(join(ext.store, 'shots.mjs')).href);
const shots = only ? allShots.filter((shot) => shot.out.includes(only)) : allShots;

const chrome = await launchChrome({
  prefix: 'ext-shoot-',
  args: ['--hide-scrollbars', '--force-color-profile=srgb'],
});
let failed = false;
try {
  for (const shot of shots) {
    const { targetId } = await chrome.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await chrome.send('Target.attachToTarget', { targetId, flatten: true });
    const { errors, stop } = chrome.collectErrors(sessionId);
    try {
      await chrome.send('Runtime.enable', {}, sessionId);
      await chrome.send('Page.enable', {}, sessionId);
      await chrome.send(
        'Emulation.setDeviceMetricsOverride',
        { width: shot.width, height: shot.height, deviceScaleFactor: 1, mobile: false },
        sessionId
      );
      await chrome.send(
        'Emulation.setEmulatedMedia',
        { features: [{ name: 'prefers-color-scheme', value: shot.scheme ?? 'light' }] },
        sessionId
      );
      let stopLoad;
      const loaded = new Promise((resolve) => {
        stopLoad = chrome.on((message) => {
          if (message.sessionId === sessionId && message.method === 'Page.loadEventFired') resolve();
        });
      });
      await chrome.send('Page.navigate', { url: new URL(shot.url, base).href }, sessionId);
      await withTimeout(loaded, 30_000, `load ${shot.url}`).finally(stopLoad);
      if (shot.before) {
        const value = await chrome.evaluate(sessionId, shot.before, shot.timeout ?? 180_000);
        if (typeof value === 'string') console.log(`  ${shot.out}: ${value}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
      const { data } = await chrome.send(
        'Page.captureScreenshot',
        { format: 'png', clip: { x: 0, y: 0, width: shot.width, height: shot.height, scale: 1 } },
        sessionId
      );
      const file = join(ext.store, shot.out);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, Buffer.from(data, 'base64'));
    } catch (error) {
      errors.push(error.message);
    } finally {
      stop();
      await chrome.send('Target.closeTarget', { targetId }).catch(() => {});
    }
    if (errors.length) {
      failed = true;
      console.error(`✗ ${shot.out}: ${errors.join(' | ')}`);
    } else {
      console.log(`✓ ${shot.out} (${shot.width}×${shot.height})`);
    }
  }
} finally {
  await chrome.close();
}
if (failed) process.exit(1);
