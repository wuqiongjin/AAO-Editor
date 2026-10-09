// 票 12 + 08：新建入口的文案守卫 —— **「Bestdori」不进用户文案**（用户 2026-10-09 口径）。
//
// 四项来源的说话方式是「空白创建 / 从本地谱面导入 / 从官方谱面导入 / 从社区谱面导入」：
// 用户不关心数据从哪个站来，只关心「官方谱」还是「社区谱」之分。这条是本票用户口径里
// 唯一能机器验的形态，也是防回潮的总闸 —— 人一图省事就会把「从 Bestdori 导入」写回去。
import { describe, expect, it } from 'vitest';
import { readSource } from '@/tests/support/source';

/** 新建入口用到的文案键（弹窗四支 + 官方面板 + 社区占位） */
const ENTRY_KEYS = /^projects\.(new|official|community)/;

function messages(file: string): Record<string, string> {
  return JSON.parse(readSource(file)) as Record<string, string>;
}

const FILES = ['src/i18n/messages/zh-CN.json', 'src/i18n/messages/en.json'];

describe('票 12 · 新建入口文案去站名化', () => {
  for (const file of FILES) {
    it(`${file}：projects.new* / official* / community* 的值里不出现 bestdori`, () => {
      const offenders = Object.entries(messages(file))
        .filter(([key]) => ENTRY_KEYS.test(key))
        .filter(([, value]) => /bestdori/i.test(value));
      expect(offenders).toEqual([]);
    });
  }

  it('四支入口的文案键都在（少一个就是入口断了）', () => {
    const zh = messages('src/i18n/messages/zh-CN.json');
    const en = messages('src/i18n/messages/en.json');
    for (const key of ['projects.newBlank', 'projects.newCopy', 'projects.newOfficial', 'projects.newCommunity']) {
      expect(zh[key], `zh 缺 ${key}`).toBeTruthy();
      expect(en[key], `en 缺 ${key}`).toBeTruthy();
    }
    // 四支的名词都短：desc 才是那句补充说明（票 12「不许写成解释句」）
    for (const key of ['projects.newOfficial', 'projects.newCommunity']) {
      expect(zh[key].length, `${key} 太长`).toBeLessThanOrEqual(10);
    }
  });
});
