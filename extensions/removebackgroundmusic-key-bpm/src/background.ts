/**
 * The toolbar button opens the analyzer page in a tab (or brings back the
 * one already open). A tab rather than a popup: a popup closes as soon as
 * the file picker or Finder takes focus, so a song could never be chosen
 * or dropped. No permission is needed for any of this.
 */

const PAGE = 'app.html';

/** Brings an open analyzer tab to the front; false when there is none or
 *  it can't be shown (closing window, tab being dragged…). */
async function focusOpenTab(url: string) {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.TAB],
    documentUrls: [url],
  });
  for (const context of contexts) {
    if (context.tabId < 0) continue;
    try {
      await chrome.tabs.update(context.tabId, { active: true });
      if (context.windowId >= 0) {
        const window = await chrome.windows.get(context.windowId);
        await chrome.windows.update(context.windowId, {
          focused: true,
          ...(window.state === 'minimized' ? { state: 'normal' as const } : {}),
        });
      }
      return true;
    } catch {
      // Try the next one, or open a new tab.
    }
  }
  return false;
}

async function openAnalyzer() {
  const url = chrome.runtime.getURL(PAGE);
  if (await focusOpenTab(url)) return;
  await chrome.tabs.create({ url });
}

/** Clicks while one is being handled join it, so a double click opens
 *  one tab, not two (the new tab has no document for a moment). */
let opening: Promise<void> | null = null;
function openOnce() {
  opening ??= openAnalyzer()
    .catch((error: unknown) => console.warn('Could not open the analyzer', error))
    .finally(() => {
      // Keep the guard a little longer than the tab takes to appear.
      setTimeout(() => {
        opening = null;
      }, 500);
    });
  return opening;
}

chrome.action.onClicked.addListener(() => {
  void openOnce();
});

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) void openOnce();
});
