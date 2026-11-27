/**
 * Text from _locales (Chrome picks the browser's language and falls back
 * to English). `locale` is the file Chrome actually used, read from its own
 * `locale_code` message.
 */

export function t(name: string, substitutions?: string | string[]): string {
  return chrome.i18n.getMessage(name, substitutions) || name;
}

export const locale = t('locale_code');

/** Fills `data-i18n` text and `data-i18n-<attribute>` attributes. */
export function applyI18n(root: ParentNode) {
  for (const element of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    element.textContent = t(element.dataset.i18n!);
  }
  for (const element of root.querySelectorAll<HTMLElement>('*')) {
    for (const attribute of Array.from(element.attributes)) {
      if (!attribute.name.startsWith('data-i18n-')) continue;
      element.setAttribute(
        attribute.name.slice('data-i18n-'.length),
        t(attribute.value)
      );
    }
  }
}
