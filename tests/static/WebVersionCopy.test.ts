// 票 04：在线版口径的静态锁。锁三件靠自觉就容易漂的事：
//   1. 「弹窗与关于页是同一份内容」——复制一份文案，下次改口径必漏一处；
//   2. 「文案只活在消息表里」——组件里出现中文句子就说明有人又抄了一份；
//   3. 「界面文案不出现演示版 / 限制 / 阉割」——同一个东西在全站只能有一个名字。
import { describe, expect, it } from 'vitest';
import { readSource, readStripped } from '@/tests/support/source';

const host = readStripped('src/app/WebNoticeHost.tsx');
const settings = readStripped('src/pages/settings/SettingsPage.tsx');
const note = readStripped('src/app/WebVersionNote.tsx');
const zh = JSON.parse(readSource('src/i18n/messages/zh-CN.json')) as Record<string, string>;
const en = JSON.parse(readSource('src/i18n/messages/en.json')) as Record<string, string>;

const KEYS = [
  'web.notice.title',
  'web.notice.more',
  'web.notice.ack',
  'web.note.platform',
  'web.note.data',
  'web.note.desktop',
];

describe('票 04 · 在线版口径', () => {
  it('弹窗与关于页渲染同一份内容：两处都只用 WebVersionNote，谁也不许自带副本', () => {
    expect(host).toContain('<WebVersionNote />');
    expect(settings).toContain('<WebVersionNote compact />');
    // 组件里不该出现中文句子：文案一律从消息表来
    expect(note).not.toMatch(/[\u4e00-\u9fa5]{4,}/);
  });

  it('两份消息表都补齐了这 7 个 key', () => {
    for (const key of KEYS) {
      expect(zh[key], `zh-CN 缺 ${key}`).toBeTruthy();
      expect(en[key], `en 缺 ${key}`).toBeTruthy();
    }
  });

  it('文案里不出现「演示版 / 限制 / 阉割」——它叫在线版', () => {
    for (const key of KEYS) {
      expect(zh[key]).not.toMatch(/演示版|限制|阉割|demo/i);
      expect(en[key]).not.toMatch(/\bdemo\b|limitation/i);
    }
  });
});
