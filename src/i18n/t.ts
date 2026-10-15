import zhCN from './messages/zh-CN.json' with { type: 'json' };
import en from './messages/en.json' with { type: 'json' };
import { type UiLanguage } from './resolveUiLanguage';

export type MessageKey = keyof typeof zhCN;
export type MessageVars = Record<string, string | number>;

const FALLBACK: UiLanguage = 'zh-CN';

/** 全语言消息表。导出供 parity 锁测（`tests/unit/i18n/tPlural.test.ts`）引用——新增语言在此登记，锁测自动覆盖。 */
export const DICTS: Record<UiLanguage, Record<string, string>> = {
  'zh-CN': zhCN as Record<string, string>,
  en: en as Record<string, string>,
};

/**
 * UiLanguage → `Intl.PluralRules` 的 BCP-47 tag。**数据驱动**：新增界面语言必须在这里加一项
 * —— `Record<UiLanguage, …>` 漏加直接编译红（issue 34：为计划中的日语铺路，不允许再出现
 * 「非 zh-CN 一律按 en 规则办」的硬编码二分）。
 */
export const PLURAL_TAGS: Record<UiLanguage, string> = {
  'zh-CN': 'zh-CN',
  en: 'en',
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

/**
 * 复数取键：类别 = **该语言自己的** `Intl.PluralRules` 选出（one/other，未来语言可能更多），
 * 键按类别原样拼（`<base>.<category>`）。英语 one/other；中文 CLDR 只有 other。
 * 类别键缺失（新语言多了类别但消息表没补）→ 回落 `.other`，不把键名当文案吐给用户；
 * 缺键由 `tests/unit/i18n/tPlural.test.ts` 的 parity 锁在看守。
 */
export function tPlural(keyBase: string, count: number, vars?: MessageVars): string {
  const locale = activeUiLanguage;
  const category = new Intl.PluralRules(PLURAL_TAGS[locale]).select(count);
  const key = `${keyBase}.${category}`;
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
