import { describe, expect, it } from 'vitest';
import { readStripped } from '@/tests/support/source';

describe('票 03 · 三层 boundary 接线', () => {
  it('main.tsx 在 createRoot 之前安装全局 handler', () => {
    const src = readStripped('src/main.tsx');
    expect(src).toMatch(/installGlobalErrorHandlers\(/);
    const installAt = src.search(/installGlobalErrorHandlers\(/);
    const rootAt = src.search(/createRoot\(/);
    expect(installAt).toBeGreaterThanOrEqual(0);
    expect(rootAt).toBeGreaterThan(installAt);
  });

  it('App.tsx 用 CrashBoundaryHost scope=app 包住 AppShell', () => {
    const src = readStripped('src/App.tsx');
    expect(src).toMatch(/CrashBoundaryHost/);
    expect(src).toMatch(/scope=["']app["']/);
    expect(src).toMatch(/<CrashBoundaryHost[\s\S]*<AppShell\s*\/>/);
  });

  it('PageSlot 用 CrashBoundaryHost scope=page 包住页面组件', () => {
    const src = readStripped('src/pages/PageRegistry.tsx');
    expect(src).toMatch(/CrashBoundaryHost/);
    expect(src).toMatch(/scope=["']page["']/);
    expect(src).toMatch(/pageId=\{id\}/);
  });

  it('WorkspacePage 在 FinalVirtualCanvas 调用点外包 canvas boundary', () => {
    const src = readStripped('src/pages/workspace/WorkspacePage.tsx');
    expect(src).toMatch(/CrashBoundaryHost/);
    expect(src).toMatch(/scope=["']canvas["']/);
    expect(src).toMatch(/<CrashBoundaryHost[\s\S]*<FinalVirtualCanvas/);
  });
});
