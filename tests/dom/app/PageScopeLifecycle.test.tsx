// @vitest-environment jsdom
// 票 22 定案 2 / 4 / 9：**作用域的生命周期归应用壳**。
//
//   - 左栏页面入口（含切页快捷键）= 先清 scope 再激活（语义：去当前工程的这一页）；
//   - 带 scope 的跳转 = 先写 scope 再激活；
//   - scope 指向的工程被删 → 回落当前工程 + 一条提示（"状态被动失效"）；
//   - 音频页不在 NEEDS_CURRENT_PROJECT 里：进音频页**不**新建 / 打开工程（票 15 定案 4）。
//
// 六个真实页面（尤其工作台）在 jsdom 里挂不起来，所以这里把 PageRegistry 换成探针：
// 探针读 useAppNav()，把"这一页此刻的 active / scope"渲染成属性，于是壳的规则可观察。
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';

vi.mock('@/src/pages/PageRegistry', async () => {
  const React = await import('react');
  const { useAppNav } = await import('@/src/layouts/AppNav');
  const stub = () => null;
  return {
    PAGE_REGISTRY: {
      projects: stub, workspace: stub, audio: stub, settings: stub, shortcuts: stub, assets: stub,
    },
    // 探针：把壳发给每一页的 active / scope 摊成可查询属性；工程页另给一枚按钮模拟
    // "带 scope 的跳转"（真身是工程详情的「设置音频」chip）
    PageSlot: ({ id, active }: { id: string; active: boolean }) => {
      const { pageScope, setActivePage } = useAppNav();
      const children = id === 'projects'
        ? [
          React.createElement('button', {
            key: 'jump',
            type: 'button',
            onClick: () => setActivePage('audio', { scope: { projectId: 'pGhost' } }),
          }, '带作用域跳转'),
        ]
        : null;
      return React.createElement(
        'div',
        { 'data-testid': `slot-${id}`, 'data-active': String(active), 'data-scope': pageScope?.projectId ?? '' },
        children,
      );
    },
  };
});

import AppShell from '@/src/layouts/AppShell';
import ToastHost from '@/src/ui/Toast';
import { ConfigProvider } from '@/src/app/providers/ConfigProvider';
import { ChartProjectStore } from '@/src/project/ChartProject';
import { createUnnamedProject } from '@/src/project/workspaceProject';
import {
  makeMemoryProjectBackend,
  renderWithProviders,
  type MemoryProjectBackend,
} from '@/tests/support/providers';
import { seedZhSettings } from '@/tests/support/storage';

const NOW = 1_700_000_000_000;

let backend: MemoryProjectBackend;

beforeEach(() => {
  window.localStorage.clear();
  seedZhSettings();
  backend = makeMemoryProjectBackend([
    createUnnamedProject({ id: 'pGhost', chartId: 'c-pGhost', now: NOW }),
  ]);
});

function mountShell() {
  renderWithProviders(<ConfigProvider><ToastHost /><AppShell /></ConfigProvider>, {
    store: new ChartProjectStore(backend),
  });
}

const slot = (id: string) => screen.getByTestId(`slot-${id}`);
const scopeOf = (id: string) => slot(id).getAttribute('data-scope');
const navButton = (label: string) => screen.getByRole('button', { name: new RegExp(`^${label}`) });

describe('票 22 · 作用域生命周期（壳层）', () => {
  it('左栏入口清作用域：带 scope 跳到音频页后再点左栏「音频」，回到"当前工程"', async () => {
    mountShell();

    fireEvent.click(navButton('音频')); // 进音频页（清 scope）
    expect(slot('audio')).toHaveAttribute('data-active', 'true');
    expect(scopeOf('audio')).toBe('');

    // 模拟"工程详情 → 管理音频"那种带 scope 的跳转
    fireEvent.click(navButton('工程')); // 回工程管理页
    fireEvent.click(screen.getByRole('button', { name: '带作用域跳转' }));
    await waitFor(() => expect(scopeOf('audio')).toBe('pGhost'));
    expect(slot('audio')).toHaveAttribute('data-active', 'true');

    // 出口 = 再点一次左栏入口（定案 8：不给"回到当前工程"按钮）
    fireEvent.click(navButton('音频'));
    expect(scopeOf('audio')).toBe('');
    expect(screen.queryByText('该工程已被删除，已切回当前工程')).toBeNull();
  });

  it('作用域指向的工程被删 → 回落当前工程 + 一条提示', async () => {
    backend.disk.clear(); // 记录没了，"作用域失效"就发生在这一刻
    mountShell();

    fireEvent.click(navButton('工程'));
    fireEvent.click(screen.getByRole('button', { name: '带作用域跳转' }));

    expect(await screen.findByText('该工程已被删除，已切回当前工程')).toBeInTheDocument();
    await waitFor(() => expect(scopeOf('audio')).toBe(''));
  });

  it('进音频页不新建 / 不打开工程（音频页不在 NEEDS_CURRENT_PROJECT 里）', async () => {
    backend.disk.clear(); // 空库：没有任何工程可作用于当前工程
    mountShell();
    expect(backend.disk.size).toBe(0);

    fireEvent.click(navButton('音频'));
    await act(async () => { await Promise.resolve(); });

    expect(slot('audio')).toHaveAttribute('data-active', 'true');
    expect(backend.disk.size).toBe(0);
  });

  it('对照：进工作台仍会确保当前工程（flag 只把音频页摘出去）', async () => {
    backend.disk.clear();
    mountShell();

    fireEvent.click(navButton('工作台'));

    await waitFor(() => expect(backend.disk.size).toBe(1));
  });
});
