// `pnpm smoke removebackgroundmusic-key-bpm`: the bundled sample must give
// the same result as the Key & BPM Finder on the website (8B · 119), and
// the toolbar logic (find, focus, open the analyzer tab) must work with no
// permissions.
export default {
  page: 'app.html',
  check: `
    document.querySelector('#sample').click();
    const start = Date.now();
    while (!document.querySelector('.item.is-done, .error:not([hidden])')) {
      if (Date.now() - start > 60000) throw new Error('sample timed out');
      await new Promise((r) => setTimeout(r, 200));
    }
    const text = document.querySelector('.item').innerText.replace(/\\s+/g, ' ');
    if (!text.includes('8B') || !text.includes('119')) throw new Error('unexpected sample result: ' + text);
    const url = chrome.runtime.getURL('app.html');
    const [open] = await chrome.runtime.getContexts({ contextTypes: ['TAB'], documentUrls: [url] });
    if (!open) throw new Error('getContexts did not find the analyzer tab');
    await chrome.tabs.update(open.tabId, { active: true });
    return 'sample → ' + text + ' | analyzer tab found and focused (' + chrome.i18n.getUILanguage() + ')';
  `,
};
