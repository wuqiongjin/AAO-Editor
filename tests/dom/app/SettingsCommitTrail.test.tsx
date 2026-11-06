// @vitest-environment jsdom
// 14 票：26 个 setter 退成只交 patch 的接线后，一次变更仍只记一条轨迹，
// 且变更键与改前逐 setter 手写的键逐字一致、落盘内容与 state 同源。
// 「落盘恰好一次」由 module 侧可注入 Storage 的 SettingsCommit.test.ts 看守；
// 这里补 React 接线这一半（jsdom 的 localStorage 是被补回的内存桩，不适合计数）。
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { ConfigProvider, useConfig, type ConfigContextValue } from '@/src/app/providers/ConfigProvider';
import { getDefaultConfig } from '@/src/chart/config/ShortcutConfig';
import * as AssetCachePolicy from '@/src/community/assetCachePolicy';
import { trail } from '@/src/diagnostics/trail';
import { SETTINGS_KEY, seedZhSettings } from '@/tests/support/storage';

let api: ConfigContextValue;
let pushCachePolicy: ReturnType<typeof vi.spyOn>;

function Probe() {
  api = useConfig();
  return null;
}

function renderConfig() {
  const result = render(<ConfigProvider><Probe /></ConfigProvider>);
  pushCachePolicy.mockClear(); // 只清掉挂载时按已存策略拨的那一次
  return result;
}

function changeKeysAt(call: number): string[] {
  const event = vi.mocked(trail.record).mock.calls[call][0];
  return (event.meta as { keys: string[] }).keys;
}

beforeEach(() => {
  localStorage.clear();
  seedZhSettings();
  pushCachePolicy = vi.spyOn(AssetCachePolicy, 'syncAssetCachePolicy').mockImplementation(() => undefined);
  vi.spyOn(trail, 'record').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('14 · 一次变更只记一条轨迹', () => {
  it('普通 setter：键由 patch 派生，轨迹一条，落盘内容与 state 一致', () => {
    renderConfig();

    act(() => api.setTheme('dark'));

    expect(trail.record).toHaveBeenCalledTimes(1);
    expect(trail.record).toHaveBeenCalledWith({
      module: 'settings', action: 'change', meta: { keys: ['theme'] },
    });
    expect(api.settings.theme).toBe('dark');
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}').theme).toBe('dark');
  });

  it('setShortcutConfig：不传 shortcutLast 只记 shortcuts，传了记两个键', () => {
    renderConfig();

    act(() => api.setShortcutConfig(getDefaultConfig()));
    act(() => api.setShortcutConfig(getDefaultConfig(), {}));

    expect(changeKeysAt(0)).toEqual(['shortcuts']);
    expect(changeKeysAt(1)).toEqual(['shortcuts', 'shortcutLast']);
    expect(trail.record).toHaveBeenCalledTimes(2);
  });

  it('setCachePolicy / setAllSettings：各一条轨迹，缓存策略两条路径都推主进程', () => {
    renderConfig();

    act(() => api.setCachePolicy({}));
    expect(changeKeysAt(0)).toEqual(['cachePolicy']);
    expect(pushCachePolicy).toHaveBeenCalledTimes(1);

    const imported = { ...api.settings, theme: 'light' as const };
    act(() => api.setAllSettings(imported));

    expect(changeKeysAt(1)).toEqual(Object.keys(imported));
    expect(trail.record).toHaveBeenCalledTimes(2);
    expect(pushCachePolicy).toHaveBeenCalledTimes(2);
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}')).toEqual(imported);
  });
});
