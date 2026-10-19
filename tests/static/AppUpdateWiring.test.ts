import { describe, expect, it } from 'vitest';
import { readStripped } from '@/tests/support/source';

describe('ADR-0021 · 应用更新接线', () => {
  it('弹窗走 Dialog 壳；关于页不直连 updater', () => {
    const host = readStripped('src/app/AppUpdateHost.tsx');
    expect(host).toMatch(/from '\.\.\/ui\/Dialog'/);
    expect(host).not.toMatch(/electron-updater/);

    const settings = readStripped('src/pages/settings/SettingsPage.tsx');
    expect(settings).toMatch(/section === 'about'/);
    expect(settings).toMatch(/settings\.section\.about/);
    expect(settings).not.toMatch(/electron-updater/);
  });
});
