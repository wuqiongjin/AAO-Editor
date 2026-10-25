import { describe, expect, it } from 'vitest';
import { readFileSync, rmSync, writeFileSync } from 'fs';
import {
  appStateFilePath,
  loadUpdateSourceSync,
  patchAppStateSync,
} from '@/electron/appState.cjs';
import { saveDataRootSync, loadDataRootSync, normalizeDataRootPath } from '@/electron/dataRoot.cjs';
import { saveWindowStateSync, loadWindowStateSync } from '@/electron/windowState.cjs';
import { tmpDir } from '@/tests/support/fs';

describe('ADR-0021 · app-state.json 下载源', () => {
  it('缺省与非法值都是 github；cnb 可往返', () => {
    const userData = tmpDir('aao-update-source-');
    try {
      expect(loadUpdateSourceSync(userData)).toBe('github');
      writeFileSync(appStateFilePath(userData), JSON.stringify({ updateSource: 'CNB' }));
      expect(loadUpdateSourceSync(userData)).toBe('github');
      writeFileSync(appStateFilePath(userData), JSON.stringify({ updateSource: 'cnb' }));
      expect(loadUpdateSourceSync(userData)).toBe('cnb');
      patchAppStateSync(userData, { updateSource: 'github' });
      expect(loadUpdateSourceSync(userData)).toBe('github');
    } finally {
      rmSync(userData, { recursive: true, force: true });
    }
  });

  it('与 dataRoot、window 共存于同一份 app-state.json', () => {
    const userData = tmpDir('aao-update-source-coexist-');
    const custom = tmpDir('aao-update-source-root-');
    try {
      saveDataRootSync(userData, custom);
      saveWindowStateSync(userData, { width: 1320, height: 880, isMaximized: true });
      patchAppStateSync(userData, { updateSource: 'cnb' });
      expect(loadUpdateSourceSync(userData)).toBe('cnb');
      expect(loadDataRootSync(userData)).toBe(normalizeDataRootPath(custom));
      expect(loadWindowStateSync(userData)).toEqual({ width: 1320, height: 880, isMaximized: true });
      const doc = JSON.parse(readFileSync(appStateFilePath(userData), 'utf-8')) as {
        updateSource: string;
        dataRoot: string;
        window: { width: number };
      };
      expect(doc.updateSource).toBe('cnb');
      expect(doc.dataRoot).toBe(normalizeDataRootPath(custom));
      expect(doc.window.width).toBe(1320);
    } finally {
      rmSync(userData, { recursive: true, force: true });
      rmSync(custom, { recursive: true, force: true });
    }
  });
});
