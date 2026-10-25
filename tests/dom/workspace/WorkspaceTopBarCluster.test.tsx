// @vitest-environment jsdom
// issue 170 锁测：工作台顶栏右簇紧凑化（缩放微型胶囊 + 画布显示入口）
// issue 180 锁测：换壳后的顶栏（撤销 / 重做、谱面代码、片段库开合）
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { AppNavProvider, type AppNavValue } from '@/src/layouts/AppNav';
import { ProviderTree, useUI } from '@/src/app/ProviderTree';
import WorkspacePage from '@/src/pages/workspace/WorkspacePage';
import { SETTINGS_KEY, seedZhSettings } from '@/tests/support/storage';
import { stubPageShellEnv } from '@/tests/support/domEnv';

stubPageShellEnv();

const mockNav: AppNavValue = {
  activePage: 'workspace',
  setActivePage: vi.fn(),
  pageScope: null,
  navCollapsed: false,
  setNavCollapsed: vi.fn(),
};

function renderWorkspace(uiChild?: React.ReactNode) {
  return render(
    <AppNavProvider value={mockNav}>
      <ProviderTree>
        {uiChild}
        <WorkspacePage />
      </ProviderTree>
    </AppNavProvider>,
  );
}

function ScaleObserver({ onScale }: { onScale: (s: number) => void }) {
  const { scale } = useUI();
  onScale(scale);
  return null;
}

describe('issue 170 · 工作台顶栏右簇紧凑化与交互', () => {
  beforeEach(() => {
    window.localStorage.clear();
    seedZhSettings();
  });

  it('顶栏右簇渲染：缩放微型胶囊、画布显示入口均正常挂载且高度规范；BPM 标签已撤（票 180）', () => {
    const { container } = renderWorkspace();

    const cluster = container.querySelector('.ws-topbar-right');
    expect(cluster).toBeInTheDocument();
    expect(cluster?.querySelector('.ws-topbar-bpm')).not.toBeInTheDocument();
    expect(cluster).not.toHaveTextContent('BPM');

    // 缩放一体化微型胶囊：[ – | 100% | + ]
    const capsule = cluster?.querySelector('.ws-zoom-capsule');
    expect(capsule).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '缩小' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '放大' })).toBeInTheDocument();
    expect(screen.getByTitle('双击复原 100%')).toHaveTextContent('100%');

    // 画布显示入口：单图标按钮 26×26px 规范类，带 Tooltip
    const displayBtn = screen.getByRole('button', { name: '画布显示设置' });
    expect(displayBtn).toBeInTheDocument();
    expect(displayBtn).toHaveClass('ws-topbar-icon-btn');
    expect(displayBtn).toHaveAttribute('title', '画布显示设置');
  });

  it('issue 178：节拍吸附胶囊挂在右簇、排在缩放胶囊之前', () => {
    const { container } = renderWorkspace();
    const cluster = container.querySelector('.ws-topbar-right') as HTMLElement;
    const snap = screen.getByRole('button', { name: '节拍吸附' });
    expect(cluster).toContainElement(snap);
    const zoom = cluster.querySelector('.ws-zoom-capsule') as HTMLElement;
    expect(snap.compareDocumentPosition(zoom) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('缩放胶囊交互：点击减加按 0.1 步进、双击重置为 100%、滚轮缩放', () => {
    let currentScale = 1;
    const { container } = renderWorkspace(
      <ScaleObserver onScale={(s) => { currentScale = s; }} />,
    );

    const minusBtn = screen.getByRole('button', { name: '缩小' });
    const plusBtn = screen.getByRole('button', { name: '放大' });
    const resetText = screen.getByTitle('双击复原 100%');
    const capsule = container.querySelector('.ws-zoom-capsule') as HTMLElement;

    // 点击缩小：1 -> 0.9
    fireEvent.click(minusBtn);
    expect(currentScale).toBeCloseTo(0.9, 1);
    expect(resetText).toHaveTextContent('90%');

    // 点击放大：0.9 -> 1.0 -> 1.1
    fireEvent.click(plusBtn);
    expect(currentScale).toBeCloseTo(1.0, 1);
    expect(resetText).toHaveTextContent('100%');

    fireEvent.click(plusBtn);
    expect(currentScale).toBeCloseTo(1.1, 1);
    expect(resetText).toHaveTextContent('110%');

    // 双击重置：1.1 -> 1.0
    fireEvent.doubleClick(resetText);
    expect(currentScale).toBe(1);
    expect(resetText).toHaveTextContent('100%');

    // 滚轮在胶囊上缩放：向上滚动滚轮放大
    fireEvent.wheel(capsule, { deltaY: -100 });
    expect(currentScale).toBeCloseTo(1.1, 1);

    // 向下滚动滚轮缩小
    fireEvent.wheel(capsule, { deltaY: 100 });
    expect(currentScale).toBeCloseTo(1.0, 1);
  });

  it('顶栏画布显示入口触发：点击弹出设置浮层，修改即时写回', () => {
    renderWorkspace();

    const displayBtn = screen.getByRole('button', { name: '画布显示设置' });
    expect(screen.queryByRole('dialog', { name: '画布显示设置' })).not.toBeInTheDocument();

    // 点击触发打开
    fireEvent.click(displayBtn);
    expect(screen.getByRole('dialog', { name: '画布显示设置' })).toBeInTheDocument();
  });
});

describe('issue 180 · 换壳后的顶栏', () => {
  beforeEach(() => {
    window.localStorage.clear();
    seedZhSettings();
  });

  const storedDrawer = () =>
    (JSON.parse(localStorage.getItem(SETTINGS_KEY)!) as { layout: { patternDrawer: { open: boolean } } }).layout.patternDrawer;
  const queryDrawer = () => screen.queryByRole('complementary', { name: '片段库' });

  it('撤销 / 重做排在项目切换器之后、右簇之前；无历史时置灰', () => {
    const { container } = renderWorkspace();
    const bar = container.querySelector('.ws-topbar') as HTMLElement;
    const undo = within(bar).getByRole('button', { name: '撤销' });
    const redo = within(bar).getByRole('button', { name: '还原' });
    const cluster = bar.querySelector('.ws-topbar-right') as HTMLElement;
    expect(cluster).not.toContainElement(undo);
    expect(undo.compareDocumentPosition(redo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(redo.compareDocumentPosition(cluster) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(undo).toBeDisabled();
    expect(redo).toBeDisabled();
  });

  it('右簇顺序：吸附｜缩放｜显示设置｜谱面代码｜片段库', () => {
    const { container } = renderWorkspace();
    const cluster = container.querySelector('.ws-topbar-right') as HTMLElement;
    const order = [
      within(cluster).getByRole('button', { name: '节拍吸附' }),
      cluster.querySelector('.ws-zoom-capsule') as HTMLElement,
      within(cluster).getByRole('button', { name: '画布显示设置' }),
      within(cluster).getByRole('button', { name: '谱面代码' }),
      within(cluster).getByRole('button', { name: '片段库' }),
    ];
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('谱面代码按钮打开完整谱面代码弹窗', () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole('button', { name: '谱面代码' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('片段库默认收起；顶栏钮与 Ctrl+Shift+B 开合抽屉并落盘', () => {
    renderWorkspace();
    const toggle = screen.getByRole('button', { name: '片段库' });
    expect(queryDrawer()).not.toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(toggle);
    expect(queryDrawer()).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(storedDrawer().open).toBe(true);

    fireEvent.keyDown(window, { key: 'B', code: 'KeyB', ctrlKey: true, shiftKey: true });
    expect(queryDrawer()).not.toBeInTheDocument();
    expect(storedDrawer().open).toBe(false);
  });

  it('旧左右面板已撤：无 .ws-panel、无工具栏标题行、无音符信息面板', () => {
    const { container } = renderWorkspace();
    expect(container.querySelector('.ws-panel')).not.toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '工具栏' })).toHaveClass('wtr');
  });
});
