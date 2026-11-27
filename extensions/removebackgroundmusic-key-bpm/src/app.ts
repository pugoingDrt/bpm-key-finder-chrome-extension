/**
 * The analyzer page: songs dropped or chosen here are decoded and analysed
 * in this tab, one after another, with the same code as the Key & BPM
 * Finder on removebackgroundmusic.app (src/vendor). Nothing is uploaded or
 * stored; results live only while the tab is open.
 */

import {
  type KeyBpmAnalysis,
  analyzeKeyBpm,
  beatClarity,
  camelotCode,
  compatibleCamelot,
  openKeyCode,
  relativeKey,
} from '@/lib/key-bpm';
import { SongDecodeError, decodeSong, fetchSampleSong } from '@/lib/song-decode';
import { applyI18n, locale, t } from './parts/i18n';
import { keyLabel, keyLabelEnglish } from './parts/keys';
import { TapTempo } from './parts/tap-tempo';

const SAMPLE_URL = 'samples/indie-pop-loop.mp3';
/** Audio and video files the decoder can try (also for dropped folders,
 *  where files often come without a type). */
const MEDIA_NAME =
  /\.(mp3|wav|wave|m4a|aac|flac|ogg|oga|opus|aif|aiff|wma|mp4|m4v|mov|webm|mkv|avi|ts|mts|m2ts|3gp)$/i;

type State = 'queued' | 'reading' | 'listening' | 'done' | 'error';

interface Item {
  id: number;
  file: Blob;
  name: string;
  size: number;
  /** Same song twice is skipped: name, size and modification time. */
  identity: string;
  state: State;
  progress: number;
  duration: number | null;
  result: KeyBpmAnalysis | null;
  error: string | null;
  /** False when trying again cannot help (too long, unreadable). */
  retryable: boolean;
  controller: AbortController | null;
  el: HTMLLIElement;
}

const $ = <T extends HTMLElement>(selector: string, root: ParentNode = document) =>
  root.querySelector<T>(selector)!;

const items: Item[] = [];
let nextId = 1;
let running = false;

// ------------------------------------------------------------ Format ---

const languageTag = locale.replace('_', '-');
const decimal = new Intl.NumberFormat(languageTag, { maximumFractionDigits: 1 });
const megabytes = new Intl.NumberFormat(languageTag, {
  style: 'unit',
  unit: 'megabyte',
  unitDisplay: 'short',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const kilobytes = new Intl.NumberFormat(languageTag, {
  style: 'unit',
  unit: 'kilobyte',
  unitDisplay: 'short',
  maximumFractionDigits: 0,
});

function formatDuration(seconds: number) {
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, '0')}`;
}

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return kilobytes.format(Math.max(1, Math.round(bytes / 1024)));
  return megabytes.format(bytes / (1024 * 1024));
}

function roundedBpm(result: KeyBpmAnalysis) {
  return Math.round(result.bpm);
}

/** "59.5 · 238" (in this language's numbers): half and double tempo. */
function halfDouble(bpm: number) {
  return `${decimal.format(bpm / 2)} · ${decimal.format(bpm * 2)}`;
}

/** The result as one line, for the clipboard. */
function summaryLine(item: Item) {
  const result = item.result!;
  const key = result.key
    ? t('copyKeyText', [
        keyLabel(result.key),
        camelotCode(result.key),
        openKeyCode(result.key),
      ])
    : t('copyNoKey');
  const clarity = beatClarity(result);
  const bpm = String(roundedBpm(result));
  const tempo =
    clarity === 'none'
      ? t('copyNoBeat')
      : clarity === 'weak'
        ? t('copyTempoWeak', bpm)
        : t('copyTempo', bpm);
  return t('copyLine', [item.name, key, tempo]);
}

// ------------------------------------------------- Toast and speech ---

let toastTimer = 0;
function toast(message: string) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => element.classList.remove('show'), 2600);
}

/** Reads `message` to screen readers (also when it repeats). */
function announce(message: string) {
  const live = $('#live');
  live.textContent = '';
  window.setTimeout(() => {
    live.textContent = message;
  }, 60);
}

async function copyText(text: string) {
  const focused = document.activeElement as HTMLElement | null;
  try {
    await navigator.clipboard.writeText(text);
    toast(t('copied'));
  } catch {
    // Fallback for a page without clipboard access (e.g. not focused).
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    focused?.focus();
    toast(ok ? t('copied') : t('copyFailed'));
  }
}

// ------------------------------------------------------------ Render ---

function render(item: Item) {
  const el = item.el;
  const meta = [
    item.duration !== null ? formatDuration(item.duration) : null,
    formatSize(item.size),
  ]
    .filter(Boolean)
    .join(' · ');
  $('.meta', el).textContent = meta;

  const busy = item.state === 'queued' || item.state === 'reading' || item.state === 'listening';
  const status = $('.status', el);
  status.hidden = !busy;
  if (busy) {
    const text =
      item.state === 'queued'
        ? t('statusQueued')
        : item.state === 'reading'
          ? t('statusReading')
          : t('statusListening', String(Math.round(item.progress)));
    $('.status-text', el).textContent = text;
    const bar = $('.bar', el);
    bar.setAttribute('aria-label', text);
    if (item.state === 'listening') bar.setAttribute('aria-valuenow', String(Math.round(item.progress)));
    else bar.removeAttribute('aria-valuenow');
    $('.bar-fill', el).style.width = `${item.state === 'listening' ? item.progress : 0}%`;
    status.classList.toggle('indeterminate', item.state === 'reading');
  }

  const error = $('.error', el);
  error.hidden = item.state !== 'error';
  if (item.state === 'error') {
    $('.error-text', el).textContent = item.error ?? '';
    $('.retry', el).hidden = !item.retryable;
  }

  const done = item.state === 'done' && item.result;
  $('.result', el).hidden = !done;
  $('.item-foot', el).hidden = !done;
  el.classList.toggle('is-done', Boolean(done));
  if (!done) return;
  const result = item.result!;

  if (result.key) {
    const relative = relativeKey(result.key);
    let main = keyLabel(result.key);
    // Russian writes key names in lower case; as a label it starts upper.
    if (locale === 'ru') main = main.charAt(0).toUpperCase() + main.slice(1);
    $('.key-value', el).textContent = main;
    $('.key-sub', el).textContent =
      result.key.mode === 'minor'
        ? t('relativeMajor', keyLabel(relative, result.key))
        : t('relativeMinor', keyLabel(relative, result.key));
    $('.camelot-value', el).textContent = camelotCode(result.key);
    $('.camelot-sub', el).textContent = t('openKey', openKeyCode(result.key));
    $('.mixes', el).textContent = `${t('mixesWith')} ${compatibleCamelot(result.key).join(' · ')}`;
  } else {
    $('.key-value', el).textContent = '—';
    $('.key-sub', el).textContent = t('noKey');
    $('.camelot-value', el).textContent = '—';
    $('.camelot-sub', el).textContent = '';
    $('.mixes', el).textContent = '';
  }

  const clarity = beatClarity(result);
  if (clarity === 'none') {
    $('.tempo-value', el).textContent = '—';
    $('.tempo-sub', el).textContent = t('noBeat');
  } else {
    const bpm = roundedBpm(result);
    $('.tempo-value', el).textContent = `${bpm} ${t('bpmUnit')}`;
    $('.tempo-sub', el).textContent =
      clarity === 'weak' ? t('weakBeat') : t('halfDouble', halfDouble(bpm));
  }
}

function renderList() {
  const results = $('#results');
  results.hidden = items.length === 0;
  $('#count').textContent = items.length ? `(${items.length})` : '';
  const anyDone = items.some((item) => item.state === 'done');
  $<HTMLButtonElement>('#copy-all').disabled = !anyDone;
  $<HTMLButtonElement>('#csv').disabled = !anyDone;
}

// ------------------------------------------------------------- Queue ---

function identityOf(file: Blob, name: string) {
  const modified = file instanceof File ? file.lastModified : 0;
  return `${name}\u0000${file.size}\u0000${modified}`;
}

/** Adds a song to the queue; false when the same song is already there. */
function addSong(file: Blob, name: string) {
  const identity = identityOf(file, name);
  if (items.some((item) => item.identity === identity && item.state !== 'error')) {
    toast(t('alreadyAdded', name));
    return false;
  }
  const template = $<HTMLTemplateElement>('#row');
  const el = template.content.firstElementChild!.cloneNode(true) as HTMLLIElement;
  applyI18n(el);
  const item: Item = {
    id: nextId++,
    file,
    name,
    size: file.size,
    identity,
    state: 'queued',
    progress: 0,
    duration: null,
    result: null,
    error: null,
    retryable: true,
    controller: null,
    el,
  };
  $('.name', el).textContent = name;
  $('.name', el).title = name;
  const remove = $('.remove', el);
  remove.setAttribute('aria-label', t('removeNamed', name));
  remove.title = t('removeNamed', name);
  remove.addEventListener('click', () => removeItem(item, true));
  $('.copy', el).setAttribute('aria-label', t('copyNamed', name));
  $('.retry', el).addEventListener('click', () => {
    item.state = 'queued';
    item.error = null;
    render(item);
    void pump();
  });
  $('.copy', el).addEventListener('click', () => void copyText(summaryLine(item)));
  items.push(item);
  $('#list').append(el);
  render(item);
  renderList();
  void pump();
  return true;
}

/** Removes a song (stopping its analysis); `moveFocus` keeps keyboard
 *  users on the list instead of dropping focus onto the page. */
function removeItem(item: Item, moveFocus = false) {
  item.controller?.abort();
  const index = items.indexOf(item);
  if (index >= 0) items.splice(index, 1);
  item.el.remove();
  renderList();
  if (moveFocus) {
    const next = items[index] ?? items[index - 1];
    (next ? $('.remove', next.el) : $('#browse')).focus();
  }
}

function errorOf(error: unknown): { message: string; retryable: boolean } {
  if (error instanceof SongDecodeError) {
    if (error.code === 'unreadable') return { message: t('errorUnreadable'), retryable: false };
    if (error.code === 'too_long') return { message: t('errorTooLong'), retryable: false };
  }
  return { message: t('errorFailed'), retryable: true };
}

/**
 * `work`, or a rejection as soon as `signal` aborts. Some decoding steps
 * (the browser's decoder, resampling) don't stop on abort; a removed song
 * must not hold the queue until they finish.
 */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new SongDecodeError('aborted'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new SongDecodeError('aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
}

/** Analyses queued songs one at a time (each holds a decoded song). */
async function pump() {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const item = items.find((entry) => entry.state === 'queued');
      if (!item) break;
      const controller = new AbortController();
      const { signal } = controller;
      item.controller = controller;
      item.state = 'reading';
      item.progress = 0;
      render(item);
      try {
        const buffer = await untilAborted(decodeSong(item.file, { signal }), signal);
        item.duration = buffer.duration;
        item.state = 'listening';
        render(item);
        let shown = -1;
        item.result = await untilAborted(
          analyzeKeyBpm(buffer, {
            signal,
            onProgress: (value) => {
              const percent = Math.floor(value * 100);
              if (percent === shown || signal.aborted) return;
              shown = percent;
              item.progress = percent;
              render(item);
            },
          }),
          signal
        );
        item.state = 'done';
        announce(summaryLine(item));
      } catch (error) {
        if (signal.aborted) continue;
        const { message, retryable } = errorOf(error);
        item.state = 'error';
        item.error = message;
        item.retryable = retryable;
        announce(`${item.name}: ${message}`);
      } finally {
        item.controller = null;
      }
      render(item);
      renderList();
    }
  } finally {
    running = false;
  }
}

// ------------------------------------------------------ Adding files ---

function isMedia(file: File) {
  return /^(audio|video)\//.test(file.type) || MEDIA_NAME.test(file.name);
}

function addFiles(files: File[]) {
  let skipped = 0;
  for (const file of files) {
    if (isMedia(file)) addSong(file, file.name);
    else skipped += 1;
  }
  if (skipped) toast(t('skippedFiles', String(skipped)));
}

/** Every file in a dropped folder (and its subfolders), by path. */
async function filesIn(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile) {
    return new Promise((resolve) =>
      (entry as FileSystemFileEntry).file(
        (file) => resolve([file]),
        () => resolve([])
      )
    );
  }
  if (!entry.isDirectory) return [];
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const children: FileSystemEntry[] = [];
  // readEntries returns the folder in batches until an empty one.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve) =>
      reader.readEntries(resolve, () => resolve([]))
    );
    if (!batch.length) break;
    children.push(...batch);
  }
  children.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const nested = await Promise.all(children.map(filesIn));
  return nested.flat();
}

async function addDropped(data: DataTransfer) {
  // Entries must be taken while the drop event runs.
  const entries = Array.from(data.items)
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry());
  if (entries.length && entries.every(Boolean)) {
    const files = (await Promise.all(entries.map((entry) => filesIn(entry!)))).flat();
    addFiles(files);
    return;
  }
  addFiles(Array.from(data.files));
}

// ---------------------------------------------------------- Exports ---

function doneItems() {
  return items.filter((item) => item.state === 'done' && item.result);
}

/** A CSV cell: quoted when needed, and text that a spreadsheet would run
 *  as a formula (= + - @ tab CR first) starts with an apostrophe. */
function csvCell(value: string, separator: string) {
  let text = value;
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  const special = new RegExp(`["\\r\\n${separator === ';' ? ';' : ','}]`);
  return special.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv() {
  const separator = t('csvSeparator') === ';' ? ';' : ',';
  const seconds = new Intl.NumberFormat(separator === ';' ? languageTag : 'en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
    useGrouping: false,
  });
  const rows = [['file', 'key', 'camelot', 'open_key', 'bpm', 'beat', 'duration_seconds']];
  for (const item of doneItems()) {
    const result = item.result!;
    const clarity = beatClarity(result);
    rows.push([
      item.name,
      result.key ? keyLabelEnglish(result.key) : '',
      result.key ? camelotCode(result.key) : '',
      result.key ? openKeyCode(result.key) : '',
      clarity !== 'none' ? String(roundedBpm(result)) : '',
      clarity,
      item.duration !== null ? seconds.format(item.duration) : '',
    ]);
  }
  const text = rows
    .map((row) => row.map((cell) => csvCell(cell, separator)).join(separator))
    .join('\r\n');
  const url = URL.createObjectURL(new Blob([`﻿${text}\r\n`], { type: 'text/csv' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'key-bpm-results.csv';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// --------------------------------------------------------- Tap tempo ---

function setUpTapTempo() {
  const tempo = new TapTempo();
  const button = $<HTMLButtonElement>('#tap');
  const value = $('#tap-bpm');
  const info = $('#tap-info');
  let speakTimer = 0;

  const show = (count: number, bpm: number | null) => {
    value.textContent = bpm === null ? '—' : String(Math.round(bpm));
    info.textContent =
      count === 0 ? '' : bpm === null ? t('tapNeedMore') : t('tapCount', String(count));
    // Spoken once the tapping stops, not on every beat.
    window.clearTimeout(speakTimer);
    if (bpm !== null) {
      speakTimer = window.setTimeout(() => announce(t('copyTempo', String(Math.round(bpm)))), 1200);
    }
  };
  const tap = () => {
    const reading = tempo.tap(performance.now());
    show(reading.count, reading.bpm);
    button.classList.remove('pulse');
    void button.offsetWidth; // restart the animation
    button.classList.add('pulse');
  };

  button.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    tap();
  });
  // Keyboard: T anywhere (by key position, so it works with any layout),
  // Space or Enter on the focused tap button. The button's own click
  // (from Enter / Space) is not used, so a key press counts once.
  document.addEventListener('keydown', (event) => {
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    // The document itself can be the target (no element focused).
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('input, textarea, select, [contenteditable]')) return;
    const isT = event.code === 'KeyT';
    const onButton = target === button && (event.key === ' ' || event.key === 'Enter');
    if (isT || onButton) {
      event.preventDefault();
      tap();
    }
  });
  $('#tap-reset').addEventListener('click', () => {
    tempo.reset();
    show(0, null);
  });
}

// -------------------------------------------------------------- Start ---

function setUpDrop() {
  const input = $<HTMLInputElement>('#file');
  const drop = $('#drop');
  const browse = $<HTMLButtonElement>('#browse');
  drop.addEventListener('click', (event) => {
    if (event.target === browse) return;
    input.click();
  });
  browse.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    if (input.files?.length) addFiles(Array.from(input.files));
    input.value = '';
  });

  // Files dropped anywhere on the page (Chrome would otherwise open them).
  let depth = 0;
  const hasFiles = (event: DragEvent) =>
    Array.from(event.dataTransfer?.types ?? []).includes('Files');
  const endDrag = () => {
    depth = 0;
    document.body.classList.remove('dragging');
  };
  window.addEventListener('dragenter', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    depth += 1;
    document.body.classList.add('dragging');
  });
  window.addEventListener('dragleave', (event) => {
    if (!hasFiles(event)) return;
    depth = Math.max(0, depth - 1);
    // Leaving the window (no element under the pointer) ends it at once.
    if (depth === 0 || event.relatedTarget === null) endDrag();
  });
  window.addEventListener('dragover', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('drop', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    endDrag();
    if (event.dataTransfer) void addDropped(event.dataTransfer);
  });

  const sample = $<HTMLButtonElement>('#sample');
  sample.addEventListener('click', async () => {
    sample.disabled = true;
    try {
      const blob = await fetchSampleSong(SAMPLE_URL);
      addSong(blob, t('sampleName'));
    } catch {
      toast(t('errorSample'));
    } finally {
      sample.disabled = false;
    }
  });
}

function start() {
  document.documentElement.lang = languageTag;
  document.title = t('appName');
  applyI18n(document);
  setUpDrop();
  setUpTapTempo();
  $('#copy-all').addEventListener('click', () => {
    const lines = doneItems().map(summaryLine);
    if (lines.length) void copyText(lines.join('\n'));
  });
  $('#csv').addEventListener('click', downloadCsv);
  $('#clear').addEventListener('click', () => {
    for (const item of [...items]) removeItem(item);
    $('#browse').focus();
  });
  renderList();
}

start();
