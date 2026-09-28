// @vitest-environment jsdom
// issue 23 #4：工程详情页左栏工程列表的 ↑↓ 翻看。
//
// 口径（用户 2026-09-28 拍板 / 修订）：
//   - ↑↓ 只**翻看**（切详情视图），**永不碰当前工程** —— "把 ↑↓ 接到当前工程上"
//     是「当前工程怎么切换」的交互模型问题（票 24），不在本票顺手加。
//   - 守卫照抄 hub 那份（弹窗/菜单开着不响应、输入框放行、非本页不响应）。
//   - 列表顺序 = 展示排序（sortProjects），↑↓ 按展示序走。
//     **导航用的必须是与渲染同一个 `list`**（曾误用 store 原始序 `projects`，
//     表现为"切到一个工程后就没法继续移动"——用户报「行为非常诡异」的根因）。
//   - **首尾循环**（用户 2026-09-28 拍板）：走到底再按同方向绕回另一端。
//   - ←→ 在单列列表里无意义 → 忽略（不吞键）。
// 自动滚入视口（scrollIntoView）是布局行为，jsdom 无布局引擎 → 票内人工门票。
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ConfigProvider } from '@/src/app/providers/ConfigProvider';
import { AppNavProvider, type PageId } from '@/src/layouts/AppNav';
import ProjectsPage from '@/src/pages/ProjectsPage';
import { ChartProjectStore, type ChartProject, type ProjectChart } from '@/src/chart/project/ChartProject';
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

const AT = 1_700_000_000_000;

function makeChart(id: string): ProjectChart {
  return {
    id,
    notes: [{ beat: 0, type: 'BPM', bpm: 120 }],
    title: null, diff: 3, level: null, completed: false, upload: null,
    lastModified: AT, appliedChartCodeText: null, chartCodePristine: false,
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

// 展示序（默认最近打开）：最近工程 > 中间工程 > 更早工程
const PROJECTS = [
  makeProject('p1', '最近工程', AT + 3000),
  makeProject('p2', '中间工程', AT + 2000),
  makeProject('p3', '更早工程', AT + 1000),
];

beforeEach(() => {
  seedZhSettings();
  setActivePage.mockClear();
});

function renderPage(nav = navValue) {
  const backend = makeMemoryProjectBackend(PROJECTS);
  const result = renderWithProviders(
    <ConfigProvider>
      <AppNavProvider value={nav}><ProjectsPage /></AppNavProvider>
    </ConfigProvider>,
    { store: new ChartProjectStore(backend) },
  );
  return { ...result, backend };
}

const pressKey = (key: string) => fireEvent.keyDown(window, { key });

/** 详情视图主标题（右侧） */
const detailTitle = () => document.querySelector('.pc-detail__head h2')?.textContent ?? '';
/** 左栏带「当前」徽标的工程名 */
const currentTagName = () =>
  document.querySelector('.pc-item .pp-current-tag')?.closest('b')?.textContent?.replace('当前', '') ?? '';

/** 进详情：从 hub 点「最近工程」的卡片 */
async function openDetailOf(name: string) {
  await screen.findByText('全部工程');
  const card = [...document.querySelectorAll('.pb-card')]
    .find((el) => el.textContent?.includes(name)) as HTMLElement;
  fireEvent.click(card);
  await screen.findByRole('heading', { name });
}

/** 详情页左栏条目顺序（工程名） */
const listNames = () =>
  [...document.querySelectorAll('.pc-item')].map((el) => el.querySelector('b')?.textContent ?? '');

describe('issue 23 #4 · 详情页左栏 ↑↓ 翻看', () => {
  it('按 ↓ 把详情视图移到下一项，当前工程不动', async () => {
    renderPage();
    await openDetailOf('最近工程');
    expect(detailTitle()).toBe('最近工程');

    pressKey('ArrowDown');
    await waitFor(() => expect(detailTitle()).toBe('中间工程'));
    // 只翻看：没人为这次按键改当前工程，也没跳工作台
    expect(currentTagName()).toBe('');
    expect(setActivePage).not.toHaveBeenCalled();
  });

  it('按 ↑ 回到上一项，到首项再 ↑ 循环到末项', async () => {
    renderPage();
    await openDetailOf('中间工程');

    pressKey('ArrowUp');
    await waitFor(() => expect(detailTitle()).toBe('最近工程'));
    // 已在首项，再 ↑ → 循环到末项
    pressKey('ArrowUp');
    await waitFor(() => expect(detailTitle()).toBe('更早工程'));
  });

  it('到末项再按 ↓ 循环回首项', async () => {
    renderPage();
    await openDetailOf('最近工程');
    pressKey('ArrowDown');
    await waitFor(() => expect(detailTitle()).toBe('中间工程'));
    pressKey('ArrowDown');
    await waitFor(() => expect(detailTitle()).toBe('更早工程'));
    // 末项再 ↓ → 循环回首项
    pressKey('ArrowDown');
    await waitFor(() => expect(detailTitle()).toBe('最近工程'));
  });

  // 回归锁：导航顺序必须用渲染用的 `list`（展示序），不能用 store 原始序 `projects`。
  // 造一份"store 序 ≠ 展示序"的数据（p1 最旧、p3 最新），若实现退回用 `projects`，
  // 按 ↓ 会走到 store 序的邻居而不是左栏的下一项 → 本用例红。
  it('列表顺序按展示排序，↑↓ 走的就是左栏看到的顺序（不是 store 原始序）', async () => {
    const backend = makeMemoryProjectBackend([
      makeProject('p1', '商店序第一', AT),
      makeProject('p2', '商店序第二', AT + 1000),
      makeProject('p3', '商店序第三', AT + 2000),
    ]);
    renderWithProviders(
      <ConfigProvider>
        <AppNavProvider value={navValue}><ProjectsPage /></AppNavProvider>
      </ConfigProvider>,
      { store: new ChartProjectStore(backend) },
    );
    await screen.findByText('全部工程');
    // 展示序 = 最近打开降序 = 商店序第三 > 第二 > 第一（与 store 序相反）
    const card = [...document.querySelectorAll('.pb-card')]
      .find((el) => el.textContent?.includes('商店序第三')) as HTMLElement;
    fireEvent.click(card);
    await screen.findByRole('heading', { name: '商店序第三' });

    expect(listNames()).toEqual(['商店序第三', '商店序第二', '商店序第一']);
    // 按展示序的下一项：第三 → 第二（store 原始序的下一项会是"无"或错位）
    pressKey('ArrowDown');
    await waitFor(() => expect(detailTitle()).toBe('商店序第二'));
    pressKey('ArrowDown');
    await waitFor(() => expect(detailTitle()).toBe('商店序第一'));
    pressKey('ArrowDown');
    await waitFor(() => expect(detailTitle()).toBe('商店序第三'));
  });

  it('弹窗开着时不响应 ↑↓', async () => {
    renderPage();
    await openDetailOf('最近工程');

    // 「编辑工程信息」既是行尾按钮名也是弹窗标题（同一份文案）→ 圈定在动作组里点
    const actions = document.querySelector('.pc-detail__actions') as HTMLElement;
    fireEvent.click(within(actions).getByRole('button', { name: '编辑工程信息' }));
    await screen.findByRole('heading', { name: '编辑工程信息' });

    pressKey('ArrowDown');
    expect(detailTitle()).toBe('最近工程');
  });

  it('焦点在输入框里时放行原生行为（不改详情视图）', async () => {
    renderPage();
    await openDetailOf('最近工程');

    const actions = document.querySelector('.pc-detail__actions') as HTMLElement;
    fireEvent.click(within(actions).getByRole('button', { name: '编辑工程信息' }));
    await screen.findByRole('heading', { name: '编辑工程信息' });
    const nameInput = document.querySelector('.dialog input') as HTMLInputElement;

    fireEvent.keyDown(nameInput, { key: 'ArrowDown' });
    expect(detailTitle()).toBe('最近工程');
  });

  it('非工程管理页（workspace 激活）不响应 ↑↓', async () => {
    renderPage({ ...navValue, activePage: 'workspace' as PageId });
    await openDetailOf('最近工程');

    pressKey('ArrowDown');
    expect(detailTitle()).toBe('最近工程');
  });

  it('带修饰键的 ↓ 不参与翻看（交给全局快捷键）', async () => {
    renderPage();
    await openDetailOf('最近工程');

    fireEvent.keyDown(window, { key: 'ArrowDown', metaKey: true });
    expect(detailTitle()).toBe('最近工程');
  });

  it('←→ 在单列列表里被忽略（不移动、不吞键）', async () => {
    renderPage();
    await openDetailOf('中间工程');

    // ←→ 对单列列表无意义：直接忽略，视图不动
    pressKey('ArrowRight');
    expect(detailTitle()).toBe('中间工程');
    pressKey('ArrowLeft');
    expect(detailTitle()).toBe('中间工程');
  });

  it('左栏点击仍是进工作台之外的路径：双击进工作台，单击只切详情', async () => {
    renderPage();
    await openDetailOf('最近工程');

    const item = [...document.querySelectorAll('.pc-item')]
      .find((el) => el.textContent?.includes('中间工程')) as HTMLElement;
    fireEvent.click(item);
    await waitFor(() => expect(detailTitle()).toBe('中间工程'));
    expect(setActivePage).not.toHaveBeenCalledWith('workspace');

    fireEvent.doubleClick(item);
    await waitFor(() => expect(setActivePage).toHaveBeenCalledWith('workspace'));
  });
});
