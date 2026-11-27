// A headless Chrome driven over the DevTools protocol (Node's built-in
// WebSocket), for shoot.mjs and smoke.mjs. Every command has a timeout,
// and close() stops Chrome and deletes its temporary profile, also when
// starting it failed half way.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_CHROME = {
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  win32: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  linux: '/usr/bin/google-chrome',
}[process.platform];

export const COMMAND_TIMEOUT_MS = 30_000;

/** Rejects after `ms` unless `promise` settles first. */
export function withTimeout(promise, ms, what) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out after ${ms} ms: ${what}`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

export async function launchChrome({ args = [], prefix = 'ext-chrome-' } = {}) {
  const executable = process.env.CHROME_PATH ?? DEFAULT_CHROME;
  if (!executable || !existsSync(executable)) {
    throw new Error(`Chrome not found at "${executable}". Set CHROME_PATH to the Chrome executable.`);
  }
  const profile = mkdtempSync(join(tmpdir(), prefix));
  const chrome = spawn(executable, [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    ...args,
    'about:blank',
  ]);
  const exited = new Promise((resolve) => chrome.once('exit', resolve));
  let socket = null;

  const close = async () => {
    try {
      socket?.close();
    } catch {
      // already closed
    }
    if (chrome.exitCode === null && chrome.signalCode === null) {
      chrome.kill();
      await withTimeout(exited, 5000, 'Chrome exit').catch(() => chrome.kill('SIGKILL'));
    }
    rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
  };

  try {
    const wsUrl = await withTimeout(
      new Promise((resolve, reject) => {
        let text = '';
        chrome.on('error', reject);
        chrome.stderr.on('data', (chunk) => {
          text += chunk;
          const match = text.match(/DevTools listening on (ws:\/\/\S+)/);
          if (match) resolve(match[1]);
        });
        chrome.once('exit', () => reject(new Error(`Chrome exited early:\n${text}`)));
      }),
      COMMAND_TIMEOUT_MS,
      'Chrome start'
    );
    socket = new WebSocket(wsUrl);
    await withTimeout(
      new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve, { once: true });
        socket.addEventListener('error', () => reject(new Error('DevTools connection failed')), {
          once: true,
        });
      }),
      COMMAND_TIMEOUT_MS,
      'DevTools connection'
    );
  } catch (error) {
    await close();
    throw error;
  }

  let id = 0;
  const pending = new Map();
  const listeners = new Set();
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    } else {
      for (const listener of listeners) listener(message);
    }
  });

  /** A DevTools command (`sessionId` for a page or worker target). */
  const send = (method, params = {}, sessionId, timeout = COMMAND_TIMEOUT_MS) =>
    withTimeout(
      new Promise((resolve, reject) => {
        id += 1;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params, sessionId }));
      }),
      timeout,
      method
    );

  /** Calls `listener` for every event; returns a function that stops it. */
  const on = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  /** Errors (exceptions, console.error) of a session, collected from now. */
  const collectErrors = (sessionId) => {
    const errors = [];
    const stop = on((message) => {
      if (message.sessionId !== sessionId) return;
      if (message.method === 'Runtime.exceptionThrown') {
        const details = message.params.exceptionDetails;
        errors.push(details.exception?.description ?? details.text);
      }
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        errors.push(message.params.args.map((arg) => arg.value ?? arg.description).join(' '));
      }
    });
    return { errors, stop };
  };

  /** Runs `body` (async JS) in a session and returns its value. */
  const evaluate = async (sessionId, body, timeout = COMMAND_TIMEOUT_MS) => {
    const { result, exceptionDetails } = await send(
      'Runtime.evaluate',
      {
        expression: `(async () => { ${body} })()`,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true,
      },
      sessionId,
      timeout
    );
    if (exceptionDetails) {
      throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    }
    return result?.value;
  };

  return { send, on, collectErrors, evaluate, close };
}
