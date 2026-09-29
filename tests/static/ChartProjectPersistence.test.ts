// 谱面工程持久化 hook 的**时序不变量**（issue 64 回归锁）。
// node 环境无法渲染 React，沿用仓库既有的"源级回归测试"手法（见 EditorAudioSessionRefactor.test.ts）：
// 把"落盘实例绝不能被 notes 依赖的 effect 销毁"这条钉死——旧实现正是这么把自动保存打死，
// 表现为"编辑完刷新页面，谱面内容全丢"。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { repoRoot } from '@/tests/support/source';

const hookSrc = readFileSync(
  join(repoRoot, 'src/project/useChartProjectPersistence.ts'),
  'utf-8',
);
const codeOnly = hookSrc.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

describe('useChartProjectPersistence · 落盘实例生命周期（issue 64）', () => {
  it('全程不调用 merger.destroy()（销毁 = 打死后续所有 schedule/saveNow）', () => {
    expect(codeOnly).not.toMatch(/\.destroy\s*\(/);
  });

  it('不把 mergerRef 置回 null（置 null 后 render 顶部捕获与 effect 使用时机会错位）', () => {
    expect(codeOnly).not.toMatch(/mergerRef\.current\s*=\s*null/);
  });

  it('merger 一律经 ensureMerger() 取用（被销毁过会自动重建）', () => {
    expect(codeOnly).toMatch(/ensureMerger\(\)\.schedule/);
    expect(codeOnly).toMatch(/ensureMerger\(\)\.saveNow/);
    expect(codeOnly).toMatch(/existing\.isDestroyed/);
  });

  it('结算走 flush（ADR-0005 §6"切页时写入"），不是静默丢弃 pending', () => {
    expect(codeOnly).toMatch(/\.flush\(/);
  });

  it('恢复未落地前不得回写（否则初始空谱面会把已存工程覆盖掉）', () => {
    expect(codeOnly).toMatch(/if\s*\(\s*!restoreSettledRef\.current\s*\)\s*return/);
  });

  it('刷新/切后台前强制结算（pagehide + visibilitychange，收掉 800ms 窗口）', () => {
    expect(codeOnly).toMatch(/addEventListener\('pagehide'/);
    expect(codeOnly).toMatch(/addEventListener\('visibilitychange'/);
  });

  it('恢复不得用 cleanup 取消（StrictMode 的 setup→cleanup→setup 会让恢复整轮跳过，dev 下刷新必丢）', () => {
    expect(codeOnly).not.toMatch(/cancelled/);
  });

  it('音频字段进自动保存依赖（导入音频不改 notes，只靠它会永远不落盘）', () => {
    expect(codeOnly).toMatch(/audioName, audioBlob/);
  });

  it('读写当前工程 id，不再写死单一 workspace 工程', () => {
    expect(codeOnly).toMatch(/projectId/);
    expect(codeOnly).not.toMatch(/WORKSPACE_PROJECT_ID|'workspace'/);
  });
});
