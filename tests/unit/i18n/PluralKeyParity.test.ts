// issue 34：复数键 parity 锁。
// 规则：每种语言用它**自己的** `Intl.PluralRules`（tag 取自 PLURAL_TAGS）能选出的类别，
// 键 `<base>.<category>` 必须存在于该语言消息表——将来加日语（或任何语言）缺键即红；
// 漏配 PLURAL_TAGS 由 `Record<UiLanguage, …>` 编译红看守（见 t.ts）。
import { describe, expect, it } from 'vitest';
import { DICTS, PLURAL_TAGS, UI_LANGUAGES } from '@/src/i18n';

/** 采样计数：覆盖 CLDR 各类别的触发值（one / other / two / few / many / zero…）。 */
const SAMPLE_COUNTS = [0, 1, 2, 3, 5, 11, 21, 101];

/** issue 34 的四个时间档复数键基——防空转守卫逐个点名，任一 .one 被删都会让该基出局、由此红。 */
const TIME_PLURAL_BASES = [
  'projects.time.minutesAgo',
  'projects.time.hoursAgo',
  'projects.time.daysAgo',
  'projects.time.monthsAgo',
];

/**
 * 全部复数键基。锚点：某处存在 `${base}.one` 兄弟键——今日出货的复数键基都由 en 的
 * one/other 锚定。防误报：`indexFilter.other`（「其它」筛选项）这类以 .other 结尾的
 * **扁平键**没有 .one 兄弟，不算复数基。已知边界：未来若某复数基在任何语言都没有
 * `.one` 形（如日语独有键），它不进本循环——四时间档由 TIME_PLURAL_BASES 守卫兜底。
 */
function pluralKeyBases(): string[] {
  const bases = new Set<string>();
  for (const dict of Object.values(DICTS)) {
    for (const key of Object.keys(dict)) {
      const m = /\.one$/.exec(key);
      if (m) bases.add(key.slice(0, m.index));
    }
  }
  return [...bases].sort();
}

describe('tPlural 键 parity（issue 34）', () => {
  const bases = pluralKeyBases();

  it('消息表里确实存在复数键基（防本锁空转）', () => {
    for (const base of TIME_PLURAL_BASES) expect(bases).toContain(base);
    expect(bases.length).toBeGreaterThan(0);
  });

  it('每种语言：自己的 PluralRules 选出的类别键都存在', () => {
    for (const locale of UI_LANGUAGES) {
      const rules = new Intl.PluralRules(PLURAL_TAGS[locale]);
      for (const base of bases) {
        for (const n of SAMPLE_COUNTS) {
          const category = rules.select(n);
          expect(DICTS[locale][`${base}.${category}`], `${locale} 缺键 ${base}.${category}（count=${n}）`).toBeDefined();
        }
      }
    }
  });
});
