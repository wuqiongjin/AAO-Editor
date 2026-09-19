import zhCN from './messages/zh-CN.json' with { type: 'json' };
import en from './messages/en.json' with { type: 'json' };
import { type UiLanguage } from './resolveUiLanguage';

export type MessageKey = keyof typeof zhCN;
export type MessageVars = Record<string, string | number>;

const FALLBACK: UiLanguage = 'zh-CN';

const DICTS: Record<UiLanguage, Record<string, string>> = {
  'zh-CN': zhCN as Record<string, string>,
  en: en as Record<string, string>,
};

let activeUiLanguage: UiLanguage = 'zh-CN';

export function getActiveUiLanguage(): UiLanguage {
  return activeUiLanguage;
}

export function setActiveUiLanguage(locale: UiLanguage): void {
  activeUiLanguage = locale;
}

export function interpolate(template: string, vars?: MessageVars): string {
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    const v = vars[name];
    return v === undefined ? `{{${name}}}` : String(v);
  });
}

export function lookupMessage(
  locale: UiLanguage,
  key: string,
  vars?: MessageVars,
  dicts: Record<UiLanguage, Record<string, string>> = DICTS,
): string {
  const primary = dicts[locale]?.[key];
  if (primary !== undefined) return interpolate(primary, vars);
  const fallback = dicts[FALLBACK]?.[key];
  if (fallback !== undefined) {
    if (locale !== FALLBACK) {
      console.warn(`[i18n] missing key "${key}" in ${locale}, falling back to ${FALLBACK}`);
    }
    return interpolate(fallback, vars);
  }
  console.warn(`[i18n] missing key "${key}"`);
  return key;
}

export function t(key: MessageKey, vars?: MessageVars): string {
  return lookupMessage(activeUiLanguage, key, vars);
}

export function tFor(locale: UiLanguage, key: MessageKey, vars?: MessageVars): string {
  return lookupMessage(locale, key, vars);
}

/** 英语 one/other；中文 CLDR 只有 other。 */
export function tPlural(keyBase: string, count: number, vars?: MessageVars): string {
  const locale = activeUiLanguage;
  const tag = locale === 'zh-CN' ? 'zh-CN' : 'en';
  const category = new Intl.PluralRules(tag).select(count);
  const suffix = category === 'one' ? 'one' : 'other';
  const key = `${keyBase}.${suffix}`;
  const found = lookupMessage(locale, key, { count, ...vars });
  if (found !== key) return found;
  return lookupMessage(locale, `${keyBase}.other`, { count, ...vars });
}

export function tPluralFor(locale: UiLanguage, keyBase: string, count: number, vars?: MessageVars): string {
  const prev = activeUiLanguage;
  activeUiLanguage = locale;
  try {
    return tPlural(keyBase, count, vars);
  } finally {
    activeUiLanguage = prev;
  }
}

export { zhCN, en };
