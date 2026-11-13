// issue 230 · 接线 / 文案 / 文档锁（照 EditorAudioSessionRefactor.test.ts 惯例）。
// DOM 测不到的部分：两处页面的 case 接线、noRepeat 传入、预览页 PLAY_ONLY、i18n 与键位表。
import { describe, expect, it } from 'vitest';
import { readSource, readStripped } from '@/tests/support/source';

const workspace = readStripped('src/pages/workspace/WorkspacePage.tsx');
const preview = readStripped('src/pages/preview/PreviewVideoStage.tsx');
const hook = readStripped('src/settings/useShortcutDispatch.ts');
const registry = readStripped('src/settings/ShortcutConfig.ts');

const CASES: Array<[string, RegExp]> = [
  ['rateDown', /case\s+'rateDown':\s*setRate\(stepPlaybackRatePreset\(getPlaybackRate\(\),\s*-1\)\);/],
  ['rateUp', /case\s+'rateUp':\s*setRate\(stepPlaybackRatePreset\(getPlaybackRate\(\),\s*1\)\);/],
  ['volumeDown', /case\s+'volumeDown':\s*\w+\(stepAudioVolume\(\w+\.current,\s*-1\)\);/],
  ['volumeUp', /case\s+'volumeUp':\s*\w+\(stepAudioVolume\(\w+\.current,\s*1\)\);/],
];

describe('issue 230 · 两处页面的四键接线', () => {
  for (const [label, src] of [['工作台', workspace], ['动态预览', preview]] as const) {
    for (const [id, pattern] of CASES) {
      it(`${label} runFunction 接上 ${id}`, () => {
        expect(src).toMatch(pattern);
      });
    }
    it(`${label} useShortcutDispatch 传 noRepeat（按住不连发）`, () => {
      expect(src).toMatch(/noRepeat:\s*PLAYBACK_SHORTCUT_IDS/);
    });
  }

  it('预览页 PLAY_ONLY = play + 四个新 id，其余绑定仍放行原生', () => {
    expect(preview).toMatch(/const PLAY_ONLY:\s*readonly FunctionId\[\]\s*=\s*\['play',\s*\.\.\.PLAYBACK_SHORTCUT_IDS\]/);
  });

  it('工作台音量快捷键走 setAudioVolume 那条统一入口（票 60 单点）', () => {
    expect(workspace).toMatch(/case\s+'volumeDown':\s*handleVolumeChange\(stepAudioVolume/);
    expect(workspace).toMatch(/const handleVolumeChange = useCallback\(\(v: number\) => \{\s*setAudioVolume\(v\);/);
  });
});

describe('issue 230 · 分发 hook 与载入去重', () => {
  it('useShortcutDispatch 有 noRepeat 选项，且只过滤名单内的功能', () => {
    expect(hook).toMatch(/noRepeat\?:\s*readonly FunctionId\[\]/);
    expect(hook).toMatch(/e\.repeat\s*&&\s*noRepeat\?\.includes\(fn\)/);
    expect(hook).toMatch(/\[active,\s*shortcutConfig,\s*runFunction,\s*onEscape,\s*only,\s*noRepeat\]/);
  });

  it('loadConfig 以快照 key 集合分流，去重不再按表序', () => {
    expect(registry).toMatch(/const existingIds = new Set\(Object\.keys\(parsed\)\)/);
    expect(registry).toMatch(/dedupeBindings\(repairStaleBindings\(cfg\),\s*existingIds\)/);
    expect(registry).toMatch(/existingIds\.has\(owner\)/);
  });
});

describe('issue 230 · i18n 与文档', () => {
  const ids = ['rateDown', 'rateUp', 'volumeDown', 'volumeUp'];

  it('zh-CN / en 两份消息表都有四个功能名', () => {
    const zh = JSON.parse(readSource('src/i18n/messages/zh-CN.json')) as Record<string, string>;
    const en = JSON.parse(readSource('src/i18n/messages/en.json')) as Record<string, string>;
    for (const id of ids) {
      const key = `shortcut.fn.${id}`;
      expect(zh[key], key).toBeTruthy();
      expect(en[key], key).toBeTruthy();
      expect(zh[key]).not.toBe(key);
      expect(en[key]).not.toBe(key);
    }
  });

  it('ADR-0002 头部修订写明默认键、去重规则与选键原则', () => {
    const adr = readSource('docs/adr/0002-快捷键系统与自定义配置.md');
    expect(adr).toMatch(/2026-11-11 修订（issue 230/);
    for (const token of ['rateDown', 'rateUp', 'volumeDown', 'volumeUp', '表序优先', 'playback', '选键原则']) {
      expect(adr, token).toContain(token);
    }
  });

  it('features（中/英）/ README / README.en 键位表都补了四键', () => {
    for (const rel of [
      'docs-site/guide/features.md', 'docs-site/en/guide/features.md', 'README.md', 'README.en.md',
    ]) {
      const text = readSource(rel);
      for (const key of ['`,`', '`.`', '`;`', "`'"]) {
        expect(text, `${rel} ${key}`).toContain(key);
      }
    }
  });
});
