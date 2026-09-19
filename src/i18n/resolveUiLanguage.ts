// 界面语言解析（issue 128）：出货 locale 本期仅 zh-CN / en。
// OS 映射见 CONTEXT「界面语言」；非法/缺省值走 OS，不 bump schemaVersion。

export const UI_LANGUAGES = ['zh-CN', 'en'] as const;
export type UiLanguage = (typeof UI_LANGUAGES)[number];

export function isUiLanguage(raw: unknown): raw is UiLanguage {
  return raw === 'zh-CN' || raw === 'en';
}

/** Chromium / Electron locale tag，如 zh-CN、en-GB、zh-TW。测试注入假 OS tag。 */
export function detectOsLanguageTag(): string {
  if (typeof navigator !== 'undefined' && typeof navigator.language === 'string' && navigator.language) {
    return navigator.language;
  }
  return '';
}

/**
 * 无已存/非法值：zh-CN / zh-Hans / zh → zh-CN；
 * en* → en；zh-TW / zh-HK / zh-Hant 在繁中出货前暂用 zh-CN；其余 → en。
 */
export function mapOsLanguageTag(osTag: string): UiLanguage {
  const n = osTag.trim().toLowerCase().replace(/_/g, '-');
  if (!n) return 'en';
  if (n === 'zh-tw' || n === 'zh-hk' || n === 'zh-hant' || n.startsWith('zh-hant-') || n.startsWith('zh-tw-') || n.startsWith('zh-hk-')) {
    return 'zh-CN';
  }
  if (n === 'zh' || n === 'zh-cn' || n === 'zh-hans' || n.startsWith('zh-hans-') || n.startsWith('zh-cn-')) {
    return 'zh-CN';
  }
  if (n === 'en' || n.startsWith('en-')) return 'en';
  return 'en';
}

/** 有效已存值保留；否则按 OS 表。 */
export function resolveUiLanguage(raw: unknown, osTag: string): UiLanguage {
  if (isUiLanguage(raw)) return raw;
  return mapOsLanguageTag(osTag);
}
