import { describe, expect, it } from 'vitest';
import { readStripped } from '@/tests/support/source';

describe('ADR-0021 · 应用更新接线', () => {
  it('弹窗走 Dialog 壳；关于页不直连 updater', () => {
    const host = readStripped('src/app/AppUpdateHost.tsx');
    expect(host).toMatch(/from '\.\.\/ui\/Dialog'/);
    expect(host).toMatch(/size="md"/);
    expect(host).toMatch(/closeOnScrim=\{false\}/);
    expect(host).not.toMatch(/electron-updater/);

    const settings = readStripped('src/pages/settings/SettingsPage.tsx');
    expect(settings).toMatch(/section === 'about'/);
    expect(settings).toMatch(/settings\.section\.about/);
    expect(settings).not.toMatch(/electron-updater/);
    expect(readStripped('src/app/appUpdate.ts')).not.toMatch(/electron-updater/);
    expect(readStripped('electron/appUpdate.cjs')).toMatch(/setFeedURL/);
    expect(readStripped('electron/appUpdate.cjs')).toMatch(/provider: 'generic'/);
  });

  it('发行说明走 markdown 子集渲染组件，不裸贴文本、不走 innerHTML', () => {
    const host = readStripped('src/app/AppUpdateHost.tsx');
    expect(host).toMatch(/from '\.\/ReleaseNotes'/);
    expect(host).toMatch(/<ReleaseNotes markdown=\{notes\} \/>/);
    expect(host).not.toMatch(/\{notes \|\| undefined\}/);

    // 渲染链（组件 + 解析器）只产 React 元素：XSS 面不给 dangerouslySetInnerHTML 留门
    for (const file of ['src/app/ReleaseNotes.tsx', 'src/app/releaseNotesParser.ts']) {
      const src = readStripped(file);
      expect(src, file).not.toMatch(/dangerouslySetInnerHTML/);
      expect(src, file).not.toMatch(/innerHTML/);
    }
  });
});
