// @vitest-environment jsdom
// issue 38：回工程页时列表不重读 —— 激活（保活页从隐藏变可见）时先 flushPersist 再 reload。
//
// 现场（issue 36 验收，用户 2026-10-15）：工作台编辑谱面后回到工程管理页，卡片 / 详情谱面行的
// 音符数还是上次编辑后的数量。根因是工程页保活挂载、列表只在 catalogEpoch 变化时 reload，
// 而工作台的音符编辑走 800ms 防抖落盘、防抖那笔落地**不通知目录**，切页也不 flush。
//
// 本锁三件事（照票的「锁测」段）：
//   1. 行为：激活工程页 → 先落盘在飞的编辑、再重读，谱面行音符数即时更新；
//      不激活（保活隐藏）→ 列表纹丝不动（哪怕盘上记录已经变了）。
//   2. 次序的**行为侧**：编辑只在 flush 里才落盘（模拟工作台防抖那笔）—— 只重读不 flush 的话，
//      读到的是防抖窗口前的旧记录，音符数不会变。次序的静态锁见
//      tests/static/ProjectsActiveReload.test.ts（flushPersist 先于 reload，撤一即红）。
//   3. **生产接线**（2026-10-15 复验补）：前两条用手写 flush 回调模拟工作台，但生产里注册
//      flush 的是 WorkspacePage 的 useChartProjectPersistence。复验发现激活 effect 的
//      flushPersist() 会打到**空注册柄**上：React 一个 commit 内先跑完整个 cleanup 阶段再跑
//      setup 阶段，而 setup 按树序（工程页在工作台之前）——导航提交里工作台注册 effect 的
//      cleanup（registerPersistFlush(null)）先跑，工程页激活 effect 后跑，重新注册又晚于它。
//      本条用**真 persistence hook** + 照生产旧接线注册的假工作台（树序排在工程页之后、
//      随 active 翻转重渲染）锁住这条链路：防抖窗口内离开也必须即时更新。
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { ConfigProvider } from '@/src/app/providers/ConfigProvider';
import { AppNavProvider, type PageId } from '@/src/layouts/AppNav';
import {
  useCurrentProject,
  type CurrentProjectContextValue,
} from '@/src/app/providers/CurrentProjectProvider';
import ProjectsPage from '@/src/pages/projects/ProjectsPage';
import {
  ChartProjectStore, type ChartProject, type ProjectChart,
} from '@/src/project/ChartProject';
import { useChartProjectPersistence } from '@/src/project/useChartProjectPersistence';
import type { ChartNote } from '@/src/chart/types';
import {
  makeMemoryProjectBackend, renderWithProviders, type MemoryProjectBackend,
} from '@/tests/support/providers';
import { seedZhSettings } from '@/tests/support/storage';

const AT = 1_700_000_000_000;

const navValue = {
  activePage: 'projects' as PageId,
  setActivePage: () => {},
  pageScope: null,
  navCollapsed: true,
  setNavCollapsed: () => {},
};

beforeEach(() => {
  // 当前工程指针落在 localStorage：不清会让上一个用例的工程被下一个用例"恢复"
  window.localStorage.clear();
  seedZhSettings();
});

function tap(beat: number): ChartNote {
  return { beat, lane: 2, type: 'Single' };
}

/** n 个可击打音符（BPM 等系统音符不计入 countChartNotes，这里只用 Single） */
function notes(n: number): ChartNote[] {
  return Array.from({ length: n }, (_, i) => tap(i + 1));
}

function makeChart(id: string, noteCount: number): ProjectChart {
  return {
    id,
    notes: notes(noteCount),
    title: null,
    diff: 3,
    level: null,
    completed: false,
    upload: null,
    lastModified: AT,
    appliedChartCodeText: null,
    chartCodePristine: false,
  };
}

function makeProject(id: string, noteCount: number): ChartProject {
  return {
    id,
    name: `工程 ${id}`,
    artist: null,
    source: { type: 'custom' },
    durationSeconds: 30,
    lastOpened: AT,
    charts: [makeChart(`c-${id}`, noteCount)],
    audioName: null,
    coverName: null,
  };
}

/** 谱面行的元信息行（`{{count}} 音符 · {{time}}`，时间档不关心，只锁音符数） */
function chartRowMeta(count: number): RegExp {
  return new RegExp(`^${count} 音符 · `);
}

function renderPage(backend: MemoryProjectBackend) {
  const ctx: { current: CurrentProjectContextValue | null } = { current: null };
  function Probe() {
    ctx.current = useCurrentProject();
    return null;
  }
  const tree = (active: boolean): ReactElement => (
    <ConfigProvider>
      <AppNavProvider value={navValue}>
        <Probe />
        <ProjectsPage active={active} />
      </AppNavProvider>
    </ConfigProvider>
  );
  const view = renderWithProviders(tree(true), { store: new ChartProjectStore(backend) });
  return { view, ctx, tree };
}

/** 进 p1 的详情层：音符数只在详情谱面行上看得见（hub 卡片不显示它） */
async function enterDetail() {
  // 首帧目录还没读回来（reload 是异步的）：等卡片就位再点
  const card = await waitFor(() => {
    const el = document.querySelector<HTMLElement>('.pb-card[data-project-id="p1"]');
    expect(el).toBeTruthy();
    return el!;
  });
  fireEvent.click(card);
  expect(await screen.findByText(chartRowMeta(2))).toBeInTheDocument();
}

describe('issue 38 · 回工程页时列表不重读（激活 = 先 flush 再 reload）', () => {
  it('工作台防抖编辑在飞：激活工程页先落盘再重读，谱面行音符数即时更新', async () => {
    const backend = makeMemoryProjectBackend([makeProject('p1', 2)]);
    const { view, ctx, tree } = renderPage(backend);

    await enterDetail();

    // 去工作台（active=false）。工作台编辑了音符、防抖那笔还在飞：用一个 flush 回调模拟
    // 生产里 useChartProjectPersistence 注册的 persistNow —— 只有 flush 才把新记录写进盘，
    // 且**不通知目录**（防抖那笔落地不 notify，正是本 bug 的根因）。
    ctx.current!.registerPersistFlush(async () => {
      const p = backend.disk.get('p1')!;
      backend.disk.set('p1', { ...p, charts: [{ ...p.charts[0], notes: notes(3) }] });
    });
    await act(async () => { view.rerender(tree(false)); });

    // 隐藏期间：盘上的编辑没落（在防抖窗口里），列表纹丝不动
    expect(screen.getByText(chartRowMeta(2))).toBeInTheDocument();
    expect(screen.queryByText(chartRowMeta(3))).toBeNull();

    // 回工程页（active=false→true）：激活 effect 先 flushPersist（防抖那笔落地）→ 再 reload
    await act(async () => { view.rerender(tree(true)); });

    expect(await screen.findByText(chartRowMeta(3))).toBeInTheDocument();
    expect(screen.queryByText(chartRowMeta(2))).toBeNull();
  });

  it('盘上记录已更新（防抖那笔已落地）：不激活不更新，激活即重读', async () => {
    const backend = makeMemoryProjectBackend([makeProject('p1', 2)]);
    const { view, tree } = renderPage(backend);

    await enterDetail();

    // 隐藏期间，盘上记录被工作台换掉（防抖已落地 / 别的写路径），但不通知目录
    await act(async () => {
      view.rerender(tree(false));
      const p = backend.disk.get('p1')!;
      backend.disk.set('p1', { ...p, charts: [{ ...p.charts[0], notes: notes(5) }] });
    });

    // 不激活不更新：只认 catalogEpoch 的 reload 不触发（防抖落盘不通知目录）
    expect(screen.getByText(chartRowMeta(2))).toBeInTheDocument();
    expect(screen.queryByText(chartRowMeta(5))).toBeNull();

    // 激活即重读
    await act(async () => { view.rerender(tree(true)); });

    expect(await screen.findByText(chartRowMeta(5))).toBeInTheDocument();
    expect(screen.queryByText(chartRowMeta(2))).toBeNull();
  });

  it('生产接线（真 persistence hook）：防抖窗口内离开，激活 flush 也落得了盘', async () => {
    // 假工作台：树序排在工程页**之后**（与 AppShell 的 PAGE_IDS 同序），随 active 翻转重渲染；
    // 内部用**真** useChartProjectPersistence（= 生产 WorkspacePage 的持久化层），注册 effect
    // 照生产旧接线（[persistNow, registerPersistFlush]）——churn 与否正是本条的锁点：
    // 注册柄若在导航提交里被 cleanup 清空又晚于激活 effect 恢复，flush 就打空。
    function FakeWorkspace({ active }: { active: boolean }) {
      void active; // 只用来在翻转时重渲染（真工作台也因 active 重渲染）
      const { projectId, chartId, store, catalogEpoch, registerPersistFlush, registerRestoreWaiter } = useCurrentProject();
      const [wsNotes, setWsNotes] = useState<ChartNote[]>([]);
      const persistence = useChartProjectPersistence({
        projectId,
        chartId,
        catalogEpoch,
        store,
        notes: wsNotes,
        durationSeconds: 30,
        audioName: null,
        audioBlob: null,
        debounceMs: 800,
        onRestore: (_project, chart) => { setWsNotes(chart.notes); },
        registerRestoreWaiter,
      });
      const persistNow = useCallback(() => persistence.saveNow(), [persistence]);
      // 照生产旧接线注册（WorkspacePage 修复前的形状）：churn 与否正是本条的锁点
      useEffect(() => {
        registerPersistFlush(persistNow);
        return () => registerPersistFlush(null);
      }, [persistNow, registerPersistFlush]);
      return (
        <div>
          <span data-testid="ws-notes">{wsNotes.length}</span>
          <button type="button" onClick={() => setWsNotes(notes(4))}>编辑成 4 个音符</button>
        </div>
      );
    }

    const backend = makeMemoryProjectBackend([makeProject('p1', 2)]);
    const ctx: { current: CurrentProjectContextValue | null } = { current: null };
    function Probe() {
      ctx.current = useCurrentProject();
      return null;
    }
    const tree = (projectsActive: boolean): ReactElement => (
      <ConfigProvider>
        <AppNavProvider value={navValue}>
          <Probe />
          <ProjectsPage active={projectsActive} />
          <FakeWorkspace active={!projectsActive} />
        </AppNavProvider>
      </ConfigProvider>
    );
    const view = renderWithProviders(tree(true), { store: new ChartProjectStore(backend) });

    await enterDetail();

    // 进工作台（setCurrent = flush → open → notify）+ 等恢复结算
    await act(async () => {
      await ctx.current!.flushPersist();
      await ctx.current!.open('p1', 'c-p1');
      ctx.current!.notifyCatalogChanged();
      await ctx.current!.waitForRestore('p1', 'c-p1');
    });
    expect(screen.getByTestId('ws-notes')).toHaveTextContent('2');

    // 工作台编辑：2 → 4，**不等防抖**（800ms 窗口内）
    fireEvent.click(screen.getByText('编辑成 4 个音符'));
    expect(screen.getByTestId('ws-notes')).toHaveTextContent('4');

    // 去工作台再回工程页：激活 effect 的 flushPersist 必须把在飞防抖那笔写下去
    await act(async () => { view.rerender(tree(false)); });
    await act(async () => { view.rerender(tree(true)); });

    expect(await screen.findByText(chartRowMeta(4))).toBeInTheDocument();
    expect(screen.queryByText(chartRowMeta(2))).toBeNull();
  });
});
