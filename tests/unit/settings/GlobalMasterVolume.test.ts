// 票 60 · 全局主音量统一（Q7 统一 / Q9 默认保持 1）
// 锁静态锁与 DOM 净值网之外、还需钉住的两条事实：
//   1) 工作台滑杆经 ConfigProvider.setAudioVolume → commitSettings，把 audio.volume 落到
//      `aao.settings.v1`，loadSettings 能读回（跨重启记住）；Q9 默认 / 回落仍是 1（数值一字不改）。
//   2) AudioSessionRoot 构造与同步 effect 都注入 settings.audio.volume（A），工作台引擎跟 A 起步。
import { describe, expect, it } from 'vitest';
import { commitSettings, defaultSettings, loadSettings } from '@/src/settings/AppSettings';
import { settingsMemStorage, SETTINGS_KEY } from '@/tests/support/storage';
import { readStripped } from '@/tests/support/source';

describe('票 60 · 全局主音量（settings.audio.volume）', () => {
  it('Q9：出厂默认与 merge 回落仍是 1（数值一字不改）', () => {
    expect(defaultSettings().audio.volume).toBe(1);
    // 老存档缺 audio 段时回落 1（不把默认调成 0.8）
    const st = settingsMemStorage(JSON.stringify({ schemaVersion: 1, theme: 'dark' }));
    expect(loadSettings(st).audio.volume).toBe(1);
  });

  it('工作台滑杆写入 aao.settings.v1：audio.volume 落盘且 loadSettings 读回', () => {
    const st = settingsMemStorage();
    const next = commitSettings(defaultSettings(), { audio: { volume: 0.3 } }, st);
    expect(next.audio.volume).toBe(0.3);
    // SE 仍是独立滑杆，不被这一笔主音量写回带走
    expect(next.audio.seVolume).toBe(defaultSettings().audio.seVolume);
    const saved = JSON.parse(st.getItem(SETTINGS_KEY)!) as { audio: { volume: number } };
    expect(saved.audio.volume).toBe(0.3);
    expect(loadSettings(st).audio.volume).toBe(0.3);
  });

  it('AudioSessionRoot 注入 A：构造与同步 effect 都带 settings.audio.volume', () => {
    const root = readStripped('src/app/providers/AudioSessionRoot.tsx');
    expect(root).toMatch(/volume:\s*settings\.audio\.volume/);
    expect(root).toMatch(/syncSettingsFromConfig\([^)]*settings\.audio\.volume/);
    // 构造值、同步 effect 调用、effect 依赖三处都要带 A：缺依赖则跨页改音量不会推进引擎
    expect((root.match(/settings\.audio\.volume/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('AudioSession.syncSettingsFromConfig 收主音量（三参）', () => {
    const session = readStripped('src/audio/AudioSession.ts');
    expect(session).toMatch(/syncSettingsFromConfig\([^)]*volume/);
  });
});
