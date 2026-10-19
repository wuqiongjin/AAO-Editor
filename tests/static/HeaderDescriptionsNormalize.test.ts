// issue 171 · 全局页面头与指引文案去口语化规范整改
// 锁测：静态断言 zh-CN.json 与 en.json 对应 key 存在且符合定稿，不留冗余废弃字段或口语化残留。
import { describe, expect, it } from 'vitest';
import { readSource } from '@/tests/support/source';

function messages(file: string): Record<string, string> {
  return JSON.parse(readSource(file)) as Record<string, string>;
}

const ZH_FILE = 'src/i18n/messages/zh-CN.json';
const EN_FILE = 'src/i18n/messages/en.json';

describe('issue 171 · 全局页面头与指引文案去口语化规范整改', () => {
  it('zh-CN.json 对应 key 严格匹配定稿表文案', () => {
    const zh = messages(ZH_FILE);

    // 1. assets.background -> 画布背景
    expect(zh['assets.background']).toBe('画布背景');

    // 2. projects.guide.description -> 每个工程对应一首曲目及其多难度谱面。创建工程即可完善曲目信息并开始制谱。
    expect(zh['projects.guide.description']).toBe(
      '每个工程对应一首曲目及其多难度谱面。创建工程即可完善曲目信息并开始制谱。',
    );

    // 3. projects.header.description -> 管理本地曲目工程及其包含的谱面难度版本。
    expect(zh['projects.header.description']).toBe(
      '管理本地曲目工程及其包含的谱面难度版本。',
    );

    // 4. assets.header.description -> 管理音符皮肤外观与谱面画布背景图像。
    expect(zh['assets.header.description']).toBe(
      '管理音符皮肤外观与谱面画布背景图像。',
    );

    // 5. shortcuts.header.description -> 查看并自定义编辑器全局与工作台操作快捷键。
    expect(zh['shortcuts.header.description']).toBe(
      '查看并自定义编辑器全局与工作台操作快捷键。',
    );

    // 6. settings.header.description
    expect(zh['settings.header.description']).toBe(
      '管理应用外观偏好、界面语言、本地数据存储与应用更新。',
    );
  });

  it('en.json 对应 key 英文标准基线译文规范且无流水账', () => {
    const en = messages(EN_FILE);

    expect(en['assets.background']).toBe('Canvas Background');
    expect(en['projects.guide.description']).toBe(
      'Each project corresponds to a song and its chart difficulties. Create a project to complete song info and start charting.',
    );
    expect(en['projects.header.description']).toBe(
      'Manage local song projects and their chart difficulty versions.',
    );
    expect(en['assets.header.description']).toBe(
      'Manage note skin appearances and chart canvas background images.',
    );
    expect(en['shortcuts.header.description']).toBe(
      'View and customize global and workspace editor shortcuts.',
    );
    expect(en['settings.header.description']).toBe(
      'Manage app appearance preferences, UI language, local data storage, and app updates.',
    );
  });

  it('字典与相关 key 中彻底去除旧口语化、流水账与防卫性行话', () => {
    const zh = messages(ZH_FILE);
    const en = messages(EN_FILE);

    const checkedKeys = [
      'assets.background',
      'projects.guide.description',
      'projects.header.description',
      'assets.header.description',
      'shortcuts.header.description',
      'settings.header.description',
    ];

    for (const key of checkedKeys) {
      const zhVal = zh[key] ?? '';
      const enVal = en[key] ?? '';

      // 中文禁现口语词根
      expect(zhVal).not.toContain('挂若干张');
      expect(zhVal).not.toContain('补完信息再进工作台');
      expect(zhVal).not.toContain('键音包在音频页');
      expect(zhVal).not.toContain('自动保存');
      expect(zhVal).not.toContain('冲突保存前提示');
      expect(zhVal).not.toContain('高风险操作会单独确认');

      // 英文禁现口语流水账
      expect(enVal).not.toMatch(/one project is one song/i);
      expect(enVal).not.toMatch(/leaves you on its detail page/i);
      expect(enVal).not.toMatch(/key-sound packs live on the audio page/i);
      expect(enVal).not.toMatch(/save automatically/i);
      expect(enVal).not.toMatch(/conflicts are blocked/i);
      expect(enVal).not.toMatch(/risky actions ask/i);
    }
  });
});
