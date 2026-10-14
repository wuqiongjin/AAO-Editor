// @vitest-environment jsdom
// issue 23 #1 / #3：创建与复制工程的落点。
//
// 定案口径（用户 2026-09-28）：创建 / 复制完成后
//   ① 留在工程管理页（不跳工作台）
//   ② 新工程成为当前工程
//   ③ 详情视图切到新工程（不播滑入动画——详情内换工程本就不重放，票 19 #1）
// 三条缺一不可：少 ② 就是"徽标还在老工程"，少 ③ 就是"人还站在老工程的详情页"。
//
// 触发点（chart-projects 票 32，用户 2026-10-14 定案）：复制是低频「以旧工程为模板新建」
// 动作、归 hub——详情页常驻钮已撤，两条复制用例改走 hub 卡片 ⋯ 菜单的「复制工程」项。
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ConfigProvider } from '@/src/app/providers/ConfigProvider';
import { AppNavProvider, type PageId } from '@/src/layouts/AppNav';
import ProjectsPage from '@/src/pages/projects/ProjectsPage';
import { ChartProjectStore, type ChartProject, type ProjectChart } from '@/src/project/ChartProject';
import { makeMemoryProjectBackend, renderWithProviders } from '@/tests/support/providers';
import { seedZhSettings } from '@/tests/support/storage';

const setActivePage = vi.fn();

const navValue = {
  activePage: 'projects' as PageId,
  setActivePage,
  pageScope: null,
  navCollapsed: true,
  setNavCollapsed: () => {},
};

function makeChart(id: string): ProjectChart {
  return {
    id,
    notes: [{ beat: 0, type: 'BPM', bpm: 120 }],
    title: null, diff: 3, level: null, completed: false, upload: null,
    lastModified: 1_700_000_000_000, appliedChartCodeText: null, chartCodePristine: false,
  };
}

function makeProject(id: string, name: string, lastOpened: number): ChartProject {
  return {
    id, name, artist: null, source: { type: 'custom' },
    durationSeconds: 30, lastOpened,
    charts: [makeChart(`c-${id}`)],
    audioName: null, coverName: null,
  };
}

const PROJECTS = [makeProject('p1', '甲工程', 200), makeProject('p2', '乙工程', 100)];

beforeEach(() => {
  seedZhSettings();
  setActivePage.mockClear();
});

function renderPage() {
  const backend = makeMemoryProjectBackend(PROJECTS);
  const result = renderWithProviders(
    <ConfigProvider>
      <AppNavProvider value={navValue}><ProjectsPage /></AppNavProvider>
    </ConfigProvider>,
    { store: new ChartProjectStore(backend) },
  );
  return { ...result, backend };
}

/** 详情视图当前的工程名（右侧主标题） */
const detailTitle = () => document.querySelector('.pc-detail__head h2')?.textContent ?? '';
/** 左栏带「当前」徽标的工程名 */
const currentTagName = () =>
  document.querySelector('.pc-item .pp-current-tag')?.closest('b')?.textContent?.replace('当前', '') ?? '';

async function openDetailOf(name: string) {
  await screen.findByText('全部工程');
  const card = [...document.querySelectorAll('.pb-card')]
    .find((el) => el.textContent?.includes(name)) as HTMLElement;
  fireEvent.click(card);
  await screen.findByRole('heading', { name });
}

/** 卡片名会同时出现在 hero h2 与网格卡片 <b> 里 → 圈定在 .pb-grid 内查询（同 ProjectDeleteConfirm 口径） */
function cardOf(name: string): HTMLElement {
  const grid = document.querySelector('.pb-grid');
  if (!grid) throw new Error('找不到卡片网格');
  return within(grid as HTMLElement).getByText(name).closest('.pb-card') as HTMLElement;
}

/** 票 32：复制的触发点——hub 卡片 ⋯ 菜单的「复制工程」项（详情页常驻钮已撤） */
async function copyViaCardMenu(name: string) {
  await screen.findByText('全部工程');
  const card = cardOf(name);
  fireEvent.click(within(card).getByTitle('更多'));
  fireEvent.click(screen.getByRole('button', { name: '复制工程' }));
}

describe('issue 23 #1 · 空白新建后的落点', () => {
  it('留在工程管理页，且新工程同时成为当前工程与详情视图', async () => {
    const { backend } = renderPage();
    await screen.findByText('全部工程');

    fireEvent.click(screen.getByRole('button', { name: /空白新建/ }));
    await screen.findByRole('dialog');

    const confirm = screen.getByRole('button', { name: '创建' });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() => expect(backend.disk.size).toBe(3));
    const created = [...backend.disk.values()].find((p) => p.id !== 'p1' && p.id !== 'p2')!;

    // ① 没跳工作台
    expect(setActivePage).not.toHaveBeenCalledWith('workspace');
    // ② 新工程是当前工程
    await waitFor(() => expect(currentTagName()).toBe('未命名工程'));
    // ③ 视图切到新工程
    expect(detailTitle()).toBe('未命名工程');
    // 新建的那张谱面成为当前谱面（open 的第二参）
    expect(created.charts).toHaveLength(1);
  });

  it('底部主按钮文案已不再是「创建并打开」', async () => {
    renderPage();
    await screen.findByText('全部工程');
    fireEvent.click(screen.getByRole('button', { name: /空白新建/ }));
    await screen.findByRole('dialog');

    expect(screen.getByRole('button', { name: '创建' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '创建并打开' })).toBeNull();
  });
});

describe('issue 23 #3 · 复制工程后的落点（bug）', () => {
  it('视图与当前工程都切到副本，且不跳工作台', async () => {
    const { backend } = renderPage();
    // 票 32：触发点从详情页常驻钮搬到 hub 卡片 ⋯ 菜单（落点口径不变）
    await copyViaCardMenu('甲工程');

    await waitFor(() => expect(backend.disk.size).toBe(3));
    const copy = [...backend.disk.values()].find((p) => p.id !== 'p1' && p.id !== 'p2')!;
    const copyName = copy.name ?? '';

    // ① 没跳工作台
    expect(setActivePage).not.toHaveBeenCalledWith('workspace');
    // ② 详情视图切到副本
    await waitFor(() => expect(detailTitle()).toBe(copyName));
    // ③ 副本成为当前工程
    expect(currentTagName()).toBe(copyName);
  });

  it('复制落点不把导航方向翻成 back（hub→detail 是前进）', async () => {
    renderPage();
    await copyViaCardMenu('甲工程');
    await waitFor(() => expect(document.querySelector('.pc-detail__head h2')?.textContent).toContain('（副本）'));

    // 落点是详情视图：hub→detail 的前进导航。goDetailKeepAnimation 不置 navDir，
    // hub 初态即 forward —— 落点不会翻成 back。
    // 「详情内换工程不重挂载」不在这里锁：hub→detail 本就换包裹层节点（key hub→detail），
    // 该性质由 ProjectsViewTransition.test.tsx 经左栏切换锁定（同一套重挂载机制）。
    const view = document.querySelector('.pm-view') as HTMLElement;
    expect(view.className).toContain('pm-view--forward');
    expect(view.className).not.toContain('pm-view--back');
  });
});

// chart-projects 票 32（用户 2026-10-14 定案）：复制入口收归 hub——详情页常驻钮撤掉，
// 卡片 ⋯ 菜单（一步复制该工程）与新建弹窗（选源新建）两处保留。锁「别再长回来」。
describe('chart-projects 票 32 · 复制入口收归 hub', () => {
  it('详情页头部没有「复制工程」钮（防回潮）', async () => {
    renderPage();
    await openDetailOf('甲工程');

    expect(screen.queryByRole('button', { name: /复制工程/ })).toBeNull();
  });

  it('hub 卡片 ⋯ 菜单仍有「复制工程」项', async () => {
    renderPage();
    await screen.findByText('全部工程');

    const card = cardOf('甲工程');
    fireEvent.click(within(card).getByTitle('更多'));

    expect(screen.getByRole('button', { name: '复制工程' })).toBeInTheDocument();
  });
});
