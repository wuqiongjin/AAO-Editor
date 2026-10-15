// @vitest-environment jsdom
// issue 38：回工程页时列表不重读 —— 激活（保活页从隐藏变可见）时先 flushPersist 再 reload。
//
// 现场（issue 36 验收，用户 2026-10-15）：工作台编辑谱面后回到工程管理页，卡片 / 详情谱面行的
// 音符数还是上次编辑后的数量。根因是工程页保活挂载、列表只在 catalogEpoch 变化时 reload，
// 而工作台的音符编辑走 800ms 防抖落盘、防抖那笔落地**不通知目录**，切页也不 flush。
//
// 本锁两件事（照票的「锁测」段）：
//   1. 行为：激活工程页 → 先落盘在飞的编辑、再重读，谱面行音符数即时更新；
//      不激活（保活隐藏）→ 列表纹丝不动（哪怕盘上记录已经变了）。
//   2. 次序的**行为侧**：编辑只在 flush 里才落盘（模拟工作台防抖那笔）—— 只重读不 flush 的话，
//      读到的是防抖窗口前的旧记录，音符数不会变。次序的静态锁见
//      tests/static/ProjectsActiveReload.test.ts（flushPersist 先于 reload，撤一即红）。
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
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
});
