// issue 119：Electron 主窗体宽高 + 最大化记忆（不进设置对象 / 导出配置）。
import { describe, it, expect } from 'vitest';
import { rmSync } from 'fs';
import { join as pathJoin } from 'path';
import { tmpDir } from '@/tests/support/fs';
import {
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  browserWindowCreateOptions,
  defaultWindowState,
  loadWindowStateSync,
  normalizeWindowState,
  parseWindowStateJson,
  saveWindowStateSync,
  serializeWindowState,
} from '@/electron/windowState.cjs';
import { APP_STATE_FILENAME, appStateFilePath } from '@/electron/appState.cjs';
import { stripComments, readSource } from '@/tests/support/source';


const mainSrc = stripComments(readSource('electron/main.cjs'));
const settingsSrc = stripComments(readSource('src/chart/config/AppSettings.ts'));
const settingsPageSrc = stripComments(readSource('src/pages/settings/SettingsPage.tsx'));

describe('issue 119 · 纯函数 normalize / 序列化', () => {
  it('缺省 → 1260×800、未最大化', () => {
    expect(defaultWindowState()).toEqual({
      width: DEFAULT_WINDOW_WIDTH,
      height: DEFAULT_WINDOW_HEIGHT,
      isMaximized: false,
    });
  });

  it('合法 JSON → 保留宽高与最大化标志', () => {
    const raw = parseWindowStateJson(
      JSON.stringify({ width: 1400, height: 900, isMaximized: true }),
    );
    expect(raw).toEqual({ width: 1400, height: 900, isMaximized: true });
    expect(serializeWindowState(raw)).toBe(
      JSON.stringify({ width: 1400, height: 900, isMaximized: true }),
    );
  });

  it('非法 / 缺字段 → 回退默认或钳制 min', () => {
    expect(parseWindowStateJson('not json')).toEqual(defaultWindowState());
    expect(parseWindowStateJson('{}')).toEqual(defaultWindowState());
    expect(
      normalizeWindowState({ width: 'x', height: null, isMaximized: 'yes' }),
    ).toEqual(defaultWindowState());
    expect(normalizeWindowState({ width: 400, height: 500, isMaximized: false })).toEqual({
      width: MIN_WINDOW_WIDTH,
      height: MIN_WINDOW_HEIGHT,
      isMaximized: false,
    });
  });

  it('最大化与宽高可同时存在（序列化不含位置）', () => {
    const s = normalizeWindowState({ width: 1500, height: 950, isMaximized: true, x: 10, y: 20 });
    expect(s.isMaximized).toBe(true);
    expect(s).not.toHaveProperty('x');
    const parsed = JSON.parse(serializeWindowState(s));
    expect(parsed).toEqual({ width: 1500, height: 950, isMaximized: true });
    expect(parsed).not.toHaveProperty('x');
  });

  it('browserWindowCreateOptions 只带宽高、与 min 一致', () => {
    const opts = browserWindowCreateOptions(
      { width: 1300, height: 850, isMaximized: true },
      { minWidth: MIN_WINDOW_WIDTH, minHeight: MIN_WINDOW_HEIGHT },
    );
    expect(opts).toEqual({ width: 1300, height: 850 });
    expect(opts).not.toHaveProperty('x');
    expect(opts).not.toHaveProperty('isMaximized');
  });
});

describe('issue 119 · 磁盘路径与 I/O', () => {
  it('窗体状态落在 userData/app-state.json 的 window 字段', () => {
    expect(APP_STATE_FILENAME).toBe('app-state.json');
    expect(appStateFilePath('/tmp/user')).toBe(pathJoin('/tmp/user', 'app-state.json'));
  });

  it('saveWindowStateSync + loadWindowStateSync 往返', () => {
    const dir = tmpDir('aao-window-state-');
    try {
      saveWindowStateSync(dir, { width: 1320, height: 880, isMaximized: true });
      expect(loadWindowStateSync(dir)).toEqual({ width: 1320, height: 880, isMaximized: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('issue 119 · 主进程接线', () => {
  it('close 时同步 saveWindowStateSync；createWindow 用持久化几何', () => {
    expect(mainSrc).toMatch(/saveWindowStateSync/);
    expect(mainSrc).toMatch(/loadWindowStateSync/);
    expect(mainSrc).toMatch(/isMaximized|maximize\(/);
  });
});

describe('issue 119 · 不进设置 / 导出配置', () => {
  it('AppSettings 无窗体字段', () => {
    expect(settingsSrc).not.toMatch(/windowState|isMaximized|mainWindowWidth/i);
  });

  it('设置页导出仍是 settings 对象本身', () => {
    expect(settingsPageSrc).toMatch(/JSON\.stringify\(settings/);
    expect(settingsPageSrc).not.toMatch(/window-state|windowState|isMaximized/i);
  });
});
