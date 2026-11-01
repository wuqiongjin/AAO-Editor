// 片段命名（issue 184 / 164 定案 §3）。
//
// 「片段 N」/ "Pattern N"：按**生成时的界面语言**定格（之后切语言不追改，同「副本命名」先例）；
// N = 库内最大序号 + 1，删除不回收。
import { DICTS, getActiveUiLanguage, tFor } from '../../i18n/t';
import type { UiLanguage } from '../../i18n/resolveUiLanguage';
import type { Pattern, PatternPayload } from './types';

export function newPatternId(): string {
  return crypto.randomUUID();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 所有语言默认名模板的前缀（zh「片段」/ en "Pattern"）——从消息模板推导，不另写一套文案。
 * 库里可能同时存在两种语言生成的名字，序号要一起算。
 */
function defaultNamePrefixes(): string[] {
  return (Object.keys(DICTS) as UiLanguage[])
    .map((locale) => tFor(locale, 'patternLibrary.defaultName', { n: '' }).trim())
    .filter((prefix) => prefix !== '');
}

function parseDefaultSequence(name: string, prefixes: readonly string[]): number | null {
  for (const prefix of prefixes) {
    const match = name.match(new RegExp(`^${escapeRegExp(prefix)}\\s*(\\d+)$`));
    if (match) return Number(match[1]);
  }
  return null;
}

/**
 * 库内最大序号 + 1（删除不回收）。
 * 只认默认名模板形态（「片段 N」/「Pattern N」）；被用户改成别的名字的片段不参与序号计算
 * （但若改成的仍是模板形态，序号照算——名字是标签，库不该猜哪条是"改过的"）。
 */
export function nextPatternSequence(patterns: readonly Pick<Pattern, 'name'>[]): number {
  const prefixes = defaultNamePrefixes();
  let max = 0;
  for (const pattern of patterns) {
    const n = parseDefaultSequence(pattern.name, prefixes);
    if (n !== null && n > max) max = n;
  }
  return max + 1;
}

export function nextPatternName(
  patterns: readonly Pick<Pattern, 'name'>[],
  locale: UiLanguage = getActiveUiLanguage(),
): string {
  return tFor(locale, 'patternLibrary.defaultName', { n: nextPatternSequence(patterns) });
}

/** 采集产物 → 可落库的片段：领 id、按当前界面语言定格名字。 */
export function createPattern(
  payload: PatternPayload,
  existing: readonly Pattern[],
  now: number = Date.now(),
): Pattern {
  return {
    id: newPatternId(),
    name: nextPatternName(existing),
    createdAt: now,
    notes: payload.notes,
    bpmContext: payload.bpmContext,
  };
}
