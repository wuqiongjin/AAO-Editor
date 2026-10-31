// issue 139 锁测 2：播放 RAF 不每帧写 React 时间码；播放中 setScrollY 不 setViewport。
import { describe, it, expect } from 'vitest';
import { readStripped } from '@/tests/support/source';

const coord = readStripped('src/playback/usePlaybackCoordinator.ts');
const canvas = readStripped('src/chart/components/canvas/FinalVirtualCanvas.tsx');

const rafBody = coord.slice(
  coord.indexOf('const startPlaybackLoop'),
  coord.indexOf('const togglePlay'),
);

const implStart = canvas.lastIndexOf('setScrollY: (scrollY: number) => {');
const setScrollYBody = canvas.slice(
  implStart,
  canvas.indexOf('setPlaybackActive:', implStart),
);

describe('issue 139 · 播放 RAF 不进 React', () => {
  it('切片成功', () => {
    expect(rafBody).toContain('const startPlaybackLoop');
    expect(setScrollYBody).toContain('setScrollY:');
  });

  it('RAF 循环不每帧 setCurrentSeconds（须时间门）', () => {
    expect(rafBody).toMatch(/PLAYBACK_HUD_PERIOD_MS|lastHudAt/);
    const unguarded = /setCurrentSeconds\(\s*current\s*\)/;
    const idx = rafBody.search(unguarded);
    expect(idx).toBeGreaterThan(-1);
    const window = rafBody.slice(Math.max(0, idx - 180), idx);
    expect(window).toMatch(/lastHudAt|HUD|Period/);
  });

  it('RAF 仍每帧 tick 且不关 vsync', () => {
    expect(rafBody).toContain('e.tick()');
    expect(rafBody).toContain('requestAnimationFrame');
  });

  it('播放中 setScrollY 不经 setViewport（imperative 绘制）', () => {
    expect(setScrollYBody).toMatch(/playbackActiveRef/);
    expect(setScrollYBody).toMatch(/scrollYRef/);
    const playIf = setScrollYBody.match(/if\s*\(\s*playbackActiveRef\.current\)\s*\{[\s\S]*?return;?\s*\}/);
    expect(playIf).not.toBeNull();
    expect(playIf![0]).not.toContain('setViewport');
    expect(playIf![0]).toMatch(/renderCanvas|paint/);
  });
});

describe('issue 188 · 播放期 80ms HUD 更新与工作台重组件隔离', () => {
  const playbackProvider = readStripped('src/app/providers/PlaybackProvider.tsx');
  const toolbar = readStripped('src/pages/workspace/Toolbar.tsx');
  const noteInfo = readStripped('src/chart/components/side-panel/NoteInfoPanel.tsx');
  const switcher = readStripped('src/pages/workspace/ChartSwitcher.tsx');
  const displayPanel = readStripped('src/pages/workspace/WorkspaceDisplayPanel.tsx');
  const markerCard = readStripped('src/playback/PlaybackMarkerCard.tsx');

  it('PlaybackProvider 拆分 PlaybackStateContext 与 currentSeconds，提供 usePlaybackState 免受 80ms 时间码重渲染', () => {
    expect(playbackProvider).toContain('PlaybackStateContext');
    expect(playbackProvider).toContain('export function usePlaybackState');
  });

  it('FinalVirtualCanvas 主体走 usePlaybackState + memo，底部时间码 HUD 抽为独立子组件 CanvasPlayheadHud', () => {
    expect(canvas).toContain('usePlaybackState()');
    expect(canvas).toContain('CanvasPlayheadHud');
    expect(canvas).toMatch(/memo\(\s*FinalVirtualCanvas\s*\)|memo\(\s*forwardRef/);
  });

  it('工作台侧栏与顶栏子组件均用 memo 包裹，避免 Editor 80ms 传递 playheadSeconds 时连带整树重跑', () => {
    expect(toolbar).toMatch(/memo\(/);
    expect(noteInfo).toMatch(/memo\(/);
    expect(switcher).toMatch(/memo\(/);
    expect(displayPanel).toMatch(/memo\(/);
    expect(markerCard).toMatch(/memo\(/);
  });
});

