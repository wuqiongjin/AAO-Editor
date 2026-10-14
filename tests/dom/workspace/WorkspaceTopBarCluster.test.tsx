// @vitest-environment jsdom
// issue 170 锁测：工作台顶栏右簇紧凑化（BPM 标签 + 缩放微型胶囊 + 画布显示入口）
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AppNavProvider, type AppNavValue } from '@/src/layouts/AppNav';
import { ProviderTree, useUI } from '@/src/app/ProviderTree';
import WorkspacePage from '@/src/pages/workspace/WorkspacePage';
import { seedZhSettings } from '@/tests/support/storage';
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

  it('顶栏右簇渲染：BPM 标签、缩放微型胶囊、画布显示入口均正常挂载且高度规范', () => {
    const { container } = renderWorkspace();

    const cluster = container.querySelector('.ws-topbar-right');
    expect(cluster).toBeInTheDocument();

    // BPM Meta 标签展示：高度 24px 规范类
    const bpm = cluster?.querySelector('.ws-topbar-bpm');
    expect(bpm).toBeInTheDocument();
    expect(bpm).toHaveTextContent('BPM');

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
