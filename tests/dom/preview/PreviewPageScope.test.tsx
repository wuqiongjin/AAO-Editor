// @vitest-environment jsdom
// chart-preview 02：预览页在**壳的作用域规则**下的行为（ADR-0016 §4 / 票 22 定案 2）。
//
// 七个页面里除 preview 都在 jsdom 里挂不起来（工作台画布 / 工程页数据），所以把 PageRegistry
// 换成探针：只有 preview 是真身（照 PageScopeLifecycle.test.tsx 的做法）。
// 要锁的六件事：
//   1. 带 scope 进入 → 预览页读到「工程 + 谱面」，且当前工程不被切走；
//   2. 左栏入口清 scope → 回到「当前工程 + 当前谱面」（二级的"当前谱面"这一级回落）；
//   3. scope 只带工程 → 非当前工程取首张；
//   4. scope 的谱面被删 → 只清二级、回落该工程 + 一条提示；
//   5. scope 的工程被删 → 整条清掉、回落当前工程 + 一条提示；
//   6. 无工程无 scope → 空态，且**不新建工程**；
//   另有：页面内换谱面只改这一屏，不写作用域、不动当前工程。
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';

vi.mock('@/src/pages/PageRegistry', async () => {
  const React = await import('react');
  const { useAppNav } = await import('@/src/layouts/AppNav');
  const PreviewPage = (await import('@/src/pages/preview/PreviewPage')).default;
  const stub = () => null;
  return {
    PAGE_REGISTRY: {
      projects: stub, workspace: stub, audio: stub, assets: stub, settings: stub, shortcuts: stub,
      preview: PreviewPage,
    },
    // 探针槽：projects 槽给三枚按钮，模拟两条**带 scope** 的真实入口
    // （工作台「预览当前谱面」→ { projectId, chartId }；工程详情谱面行「预览」同形），
    // 外加一枚"作用域只带工程"的跳转（作用域条换工程时就是这个形状）。
    PageSlot: ({ id, active }: { id: string; active: boolean }) => {
      const { setActivePage } = useAppNav();
      if (id === 'preview') {
        return React.createElement(
          'div',
          { 'data-testid': 'slot-preview', 'data-active': String(active) },
          React.createElement(PreviewPage, { active }),
        );
      }
      const children = id === 'projects'
        ? [
          React.createElement('button', {
            key: 'jump',
            type: 'button',
            onClick: () => setActivePage('preview', { scope: { projectId: 'pB', chartId: 'c-b2' } }),
          }, '跳转 Beta 2'),
          React.createElement('button', {
            key: 'jumpProjectOnly',
            type: 'button',
            onClick: () => setActivePage('preview', { scope: { projectId: 'pB' } }),
          }, '只带工程跳 Beta'),
        ]
        : null;
      return React.createElement(
        'div',
        { 'data-testid': `slot-${id}`, 'data-active': String(active) },
        children,
      );
    },
  };
});

import AppShell from '@/src/layouts/AppShell';
import ToastHost from '@/src/ui/Toast';
import { ConfigProvider } from '@/src/app/providers/ConfigProvider';
import { UIProvider } from '@/src/app/providers/UIProvider';
import { ChartProjectStore, type ChartDifficulty, type ChartProject, type ProjectChart } from '@/src/project/ChartProject';
import { createUnnamedProject } from '@/src/project/workspaceProject';
import {
  useCurrentProject,
  type CurrentProjectContextValue,
} from '@/src/app/providers/CurrentProjectProvider';
import {
  makeMemoryProjectBackend,
  renderWithProviders,
  type MemoryProjectBackend,
} from '@/tests/support/providers';
import { stubPageShellEnv } from '@/tests/support/domEnv';
import { seedZhSettings } from '@/tests/support/storage';

const NOW = 1_700_000_000_000;

stubPageShellEnv();

function chart(id: string, title: string, diff: ChartDifficulty): ProjectChart {
  return {
    id,
    notes: [],
    title,
    diff,
    level: null,
    completed: false,
    upload: null,
    lastModified: NOW,
    appliedChartCodeText: null,
    chartCodePristine: false,
  };
}

function project(id: string, name: string, charts: ProjectChart[]): ChartProject {
  return { ...createUnnamedProject({ id, chartId: charts[0].id, now: NOW }), name, charts };
}

/** 读写记账的替身后端：验「读之前先 flush」的次序（issue 11 #2） */
function tracedBackend(backend: MemoryProjectBackend, log: string[]): MemoryProjectBackend {
  const get = backend.get.bind(backend);
  const list = backend.list.bind(backend);
  return {
    ...backend,
    get: async (id) => { log.push(`get:${id}`); return get(id); },
    list: async () => { log.push('list'); return list(); },
  };
}

/** 两个工程各两张谱面：谱面标题各不相同，才断言得出"在看哪张" */
function seed(): MemoryProjectBackend {
  return makeMemoryProjectBackend([
    project('pA', 'Alpha', [chart('c-a1', 'Alpha 1', 3), chart('c-a2', 'Alpha 2', 4)]),
    project('pB', 'Beta', [chart('c-b1', 'Beta 1', 1), chart('c-b2', 'Beta 2', 2)]),
  ]);
}

function Probe({ ctx }: { ctx: { current: CurrentProjectContextValue | null } }) {
  ctx.current = useCurrentProject();
  return null;
}

/** 挂真壳（含真 AppShell 的切页 / 作用域规则）；`open` = 先立一个当前工程 */
async function mountShell(
  backend: MemoryProjectBackend,
  open?: { projectId: string; chartId?: string },
) {
  const ctx: { current: CurrentProjectContextValue | null } = { current: null };
  renderWithProviders(
    <>
      <Probe ctx={ctx} />
      {/* 预览页自 03 起读 `useUI().beatDisplay`（细分档决定 subBeat 的真实拍位）与 settings.display，
          故这里补 Config + UI 两层 Provider（照 ProviderTree 的嵌套次序） */}
      <ConfigProvider><UIProvider><ToastHost /><AppShell /></UIProvider></ConfigProvider>
    </>,
    { store: new ChartProjectStore(backend) },
  );
  if (open) {
    await act(async () => { await ctx.current!.open(open.projectId, open.chartId); });
  }
  return { backend, ctx };
}

/** 左栏导航项：可访问名 = 「标签⇧⌘N」（名字里带快捷键），带上 `⇧⌘` 才不会被页内同前缀的按钮撞上 */
const navButton = (label: string) => screen.getByRole('button', { name: new RegExp(`^${label}⇧⌘`) });
/** 作用域条触发钮（可访问名带作用域工程名） */
const scopeTrigger = () => screen.getByRole('button', { name: /^作用域工程：/ });
/** 谱面切换器触发钮（可访问名带"这一屏在看的那张谱面"的标题） */
const chartTrigger = () => screen.getByRole('button', { name: /^预览中的谱面：/ });
const scopeTag = () => document.querySelector('.scope-picker__tag');

beforeEach(() => {
  // 当前工程指针落在 localStorage：不清会让上一个用例的工程被下一个用例"恢复"
  window.localStorage.clear();
  seedZhSettings();
});

describe('chart-preview 02 · 预览页的作用域（工程 + 谱面）', () => {
  it('带 scope 进入：读到「工程 + 谱面」，当前工程不被切走', async () => {
    const { backend, ctx } = await mountShell(seed(), { projectId: 'pA', chartId: 'c-a1' });

    fireEvent.click(navButton('工程'));
    fireEvent.click(screen.getByRole('button', { name: '跳转 Beta 2' }));

    expect(await screen.findByRole('button', { name: /^作用域工程：Beta/ })).toBeInTheDocument();
    await waitFor(() => expect(chartTrigger()).toHaveTextContent('Beta 2'));
    expect(scopeTag()).toHaveTextContent('非当前工程');
    // 两个控件同住工具栏行（2026-09-30 用户验收：作用域条从窄侧栏挪到这里）
    expect(scopeTrigger().closest('.preview-toolbar')).not.toBeNull();
    expect(chartTrigger().closest('.preview-toolbar')).not.toBeNull();
    // 作用域存在的全部意义：当前工程一动不动
    expect(ctx.current!.projectId).toBe('pA');
    expect(backend.disk.get('pA')!.charts.map((c) => c.id)).toEqual(['c-a1', 'c-a2']);
  });

  it('左栏入口清 scope：回到「当前工程 + 当前谱面」', async () => {
    await mountShell(seed(), { projectId: 'pA', chartId: 'c-a2' });

    fireEvent.click(navButton('工程'));
    fireEvent.click(screen.getByRole('button', { name: '跳转 Beta 2' }));
    await waitFor(() => expect(scopeTrigger()).toHaveTextContent('Beta'));

    // 出口 = 再点一次左栏入口（票 22 定案 2：先清 scope 再激活）
    fireEvent.click(navButton('预览'));
    await waitFor(() => expect(scopeTrigger()).toHaveTextContent('Alpha'));
    expect(scopeTag()).toHaveTextContent('当前');
    // 二级回落：不带二级时取该工程的**当前谱面**（CurrentProjectSession 的 chartId）
    await waitFor(() => expect(chartTrigger()).toHaveTextContent('Alpha 2'));
  });

  it('换作用域时工具栏不断档：左侧先出同尺寸占位盒，记录回来再换成真身', async () => {
    // 锁的是"抖动"的根因（2026-09-30 用户报）：记录还在路上那一 tick 谱面切换器整块消失，
    // 工具栏矮一截 → 下面的舞台跟着上下跳。占位盒与真身同 class（同盒子），行高不变。
    await mountShell(seed(), { projectId: 'pA', chartId: 'c-a1' });

    fireEvent.click(navButton('工程'));
    fireEvent.click(screen.getByRole('button', { name: '跳转 Beta 2' }));

    // 同步断言：读记录还是 pending，占位盒已在位（且不可点、不占可访问名）
    expect(document.querySelector('.preview-chart__trigger.is-pending')).not.toBeNull();
    expect(screen.queryByRole('button', { name: /^预览中的谱面：/ })).toBeNull();

    await waitFor(() => expect(chartTrigger()).toHaveTextContent('Beta 2'));
    expect(document.querySelector('.preview-chart__trigger.is-pending')).toBeNull();
  });

  it('scope 只带工程：非当前工程取它的首张谱面', async () => {
    await mountShell(seed(), { projectId: 'pA', chartId: 'c-a2' });

    fireEvent.click(navButton('工程'));
    fireEvent.click(screen.getByRole('button', { name: '只带工程跳 Beta' }));

    await waitFor(() => expect(scopeTrigger()).toHaveTextContent('Beta'));
    await waitFor(() => expect(chartTrigger()).toHaveTextContent('Beta 1'));
  });

  it('页面内换谱面只改这一屏：不写作用域、不动当前工程', async () => {
    const { backend, ctx } = await mountShell(seed(), { projectId: 'pA', chartId: 'c-a1' });

    fireEvent.click(navButton('工程'));
    fireEvent.click(screen.getByRole('button', { name: '跳转 Beta 2' }));
    await waitFor(() => expect(chartTrigger()).toHaveTextContent('Beta 2'));

    fireEvent.click(chartTrigger());
    fireEvent.click(screen.getByRole('option', { name: /Beta 1/ }));

    await waitFor(() => expect(chartTrigger()).toHaveTextContent('Beta 1'));
    expect(scopeTrigger()).toHaveTextContent('Beta');
    expect(ctx.current!.projectId).toBe('pA');
    expect(backend.disk.get('pB')!.charts.map((c) => c.id)).toEqual(['c-b1', 'c-b2']);
  });

  it('读记录之前先落盘：工作台防抖那笔没落地也读得到刚编辑的那份（issue 11 #2）', async () => {
    const log: string[] = [];
    const { ctx } = await mountShell(tracedBackend(seed(), log), { projectId: 'pA', chartId: 'c-a1' });

    // 工作台的真实画像是"注册一个 flush 回调"（useChartProjectPersistence）；这里注入替身记账它
    // 相对读的次序——防抖落地**不通知目录**，不 flush 的话这次访问会整趟停在旧记录上
    ctx.current!.registerPersistFlush(async () => { log.push('flush'); });

    log.length = 0;
    fireEvent.click(navButton('预览'));
    await waitFor(() => expect(scopeTrigger()).toHaveTextContent('Alpha'));

    expect(log[0]).toBe('flush');
    expect(log.indexOf('flush')).toBeLessThan(log.indexOf('get:pA'));
  });

  it('左簇读作「工程 / 谱面」：两控件之间一枚纯视觉分隔符（issue 11 #5）', async () => {
    await mountShell(seed(), { projectId: 'pA', chartId: 'c-a1' });
    fireEvent.click(navButton('预览'));
    await waitFor(() => expect(chartTrigger()).toHaveTextContent('Alpha 1'));

    const left = document.querySelector('.preview-toolbar__left')!;
    expect([...left.children].map((el) => el.className.split(' ')[0]))
      .toEqual(['scope-picker', 'preview-toolbar__sep', 'preview-chart']);
    const sep = left.querySelector('.preview-toolbar__sep') as HTMLElement;
    expect(sep).toHaveAttribute('aria-hidden', 'true');   // 纯视觉：不进可访问名
    expect(sep).toHaveTextContent('/');
  });

  it('重新进入本页 = 重新按入口决定：页面内的临时选择不跨次保留', async () => {
    await mountShell(seed(), { projectId: 'pA', chartId: 'c-a1' });

    fireEvent.click(navButton('工程'));
    fireEvent.click(screen.getByRole('button', { name: '跳转 Beta 2' }));
    await waitFor(() => expect(chartTrigger()).toHaveTextContent('Beta 2'));
    fireEvent.click(chartTrigger());
    fireEvent.click(screen.getByRole('option', { name: /Beta 1/ }));
    await waitFor(() => expect(chartTrigger()).toHaveTextContent('Beta 1'));

    // 去别页再**用同一个作用域**回来：进门那一刻的定位（Beta 2）说了算
    fireEvent.click(navButton('工作台'));
    fireEvent.click(navButton('工程'));
    fireEvent.click(screen.getByRole('button', { name: '跳转 Beta 2' }));

    await waitFor(() => expect(chartTrigger()).toHaveTextContent('Beta 2'));
  });

  it('scope 的谱面被删：只清二级、回落该工程 + 一条提示', async () => {
    const { backend, ctx } = await mountShell(seed(), { projectId: 'pA', chartId: 'c-a1' });

    fireEvent.click(navButton('工程'));
    fireEvent.click(screen.getByRole('button', { name: '跳转 Beta 2' }));
    await waitFor(() => expect(chartTrigger()).toHaveTextContent('Beta 2'));

    // 谱面在别处被删（写盘 + 通知目录）：作用域还在，二级失效
    const beta = backend.disk.get('pB')!;
    backend.disk.set('pB', { ...beta, charts: [beta.charts[0]] });
    await act(async () => { ctx.current!.notifyCatalogChanged(); });

    expect(await screen.findByText('该谱面已被删除，已切回当前谱面')).toBeInTheDocument();
    await waitFor(() => expect(chartTrigger()).toHaveTextContent('Beta 1'));
    // 工程级作用域保留（不是整条清掉）
    expect(scopeTrigger()).toHaveTextContent('Beta');
  });

  it('scope 的工程被删：整条作用域清掉、回落当前工程 + 一条提示', async () => {
    const { backend } = await mountShell(seed(), { projectId: 'pA', chartId: 'c-a1' });

    backend.disk.delete('pB');
    fireEvent.click(navButton('工程'));
    fireEvent.click(screen.getByRole('button', { name: '跳转 Beta 2' }));

    expect(await screen.findByText('该工程已被删除，已切回当前工程')).toBeInTheDocument();
    await waitFor(() => expect(scopeTrigger()).toHaveTextContent('Alpha'));
    expect(scopeTag()).toHaveTextContent('当前');
  });

  it('没有当前工程也没有作用域：空态，且不因此新建 / 打开工程', async () => {
    const { backend } = await mountShell(makeMemoryProjectBackend([]));
    expect(backend.disk.size).toBe(0);

    fireEvent.click(navButton('预览'));

    expect(await screen.findByText('还没有可预览的谱面')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '去工程管理' }));
    expect(screen.getByTestId('slot-projects')).toHaveAttribute('data-active', 'true');

    await act(async () => { await Promise.resolve(); });
    expect(backend.disk.size).toBe(0);
  });

  it('布局（票 10）：模式切换当页头（标题区撤销）、不再挂内容壳', async () => {
    await mountShell(seed(), { projectId: 'pA', chartId: 'c-a1' });
    fireEvent.click(navButton('预览'));

    // 标题区整块撤销：eyebrow / 标题 / 描述都不再出现（2026-10-02 用户验收：模式名即标题）
    expect(screen.queryByText('谱面预览')).toBeNull();
    expect(screen.queryByRole('heading', { level: 2, name: '预览' })).toBeNull();
    expect(screen.queryByText(/在编辑器之外/)).toBeNull();
    expect(document.querySelector('.page-intro')).toBeNull();
    // 自渲染全幅壳：预览页不再套 AppPageShell（本测试的其余六页是探针桩）
    expect(document.querySelector('.app-page-shell')).toBeNull();

    // 模式切换升为页头级：独占一行（.preview-header），不在工具栏里；仍是 aria-pressed 的二选一
    const staticBtn = await screen.findByRole('button', { name: '静态预览' });
    expect(staticBtn.closest('.preview-header')).not.toBeNull();
    expect(staticBtn.closest('.preview-toolbar')).toBeNull();
    expect(staticBtn).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '动态预览' })).toHaveAttribute('aria-pressed', 'false');

    // 切到动态预览：这一屏的形态跟着走
    fireEvent.click(screen.getByRole('button', { name: '动态预览' }));
    expect(document.querySelector('.preview-stage')?.getAttribute('data-mode')).toBe('video');
  });
});
