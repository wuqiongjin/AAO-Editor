// @vitest-environment jsdom
// issue 14：全部工程卡片网格的方向键导航 + 横幅跟随。
// 按 role/text 查询、断言行为；「浏览焦点」暂无对应 role/text 可查，
// 选中态以 .pb-grid 圈定 + is-selected class 锁结构（同 issue 09 的节点归属断言口径）。
// 列数实测（offsetTop）与自动滚入视口是布局行为，jsdom 无布局引擎 → 人工门票（见票）。
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { AppNavProvider, type PageId } from '@/src/layouts/AppNav';
import { ConfigProvider } from '@/src/app/providers/ConfigProvider';
import ProjectsPage from '@/src/pages/projects/ProjectsPage';
import {
  ChartProjectStore, type ChartProject, type ProjectChart,
} from '@/src/project/ChartProject';
import { makeMemoryProjectBackend, renderWithProviders } from '@/tests/support/providers';
import { seedZhSettings } from '@/tests/support/storage';

beforeEach(() => {
  seedZhSettings();
});

const AT = 1_700_000_000_000;

const navValue = {
  activePage: 'projects' as PageId,
  setActivePage: () => {},
  pageScope: null,
  navCollapsed: true,
  setNavCollapsed: () => {},
};

function makeChart(id: string, completed = false): ProjectChart {
  return {
    id,
    notes: [{ beat: 0, type: 'BPM', bpm: 120 }],
    title: null,
    diff: 3,
    level: null,
    completed,
    upload: null,
    lastModified: AT,
    appliedChartCodeText: null,
    chartCodePristine: false,
  };
}

function makeProject(id: string, name: string, lastOpened: number, completed = false): ChartProject {
  return {
    id,
    name,
    artist: null,
    source: { type: 'custom' },
    durationSeconds: 30,
    lastOpened,
    charts: [makeChart(`c-${id}`, completed)],
    audioName: null,
    coverName: null,
  };
}

// 排序 = sortProjectsByLastOpened（lastOpened 降序）：最近工程(未完成) → 已完成工程 → 更早工程
const PROJECTS = [
  makeProject('p1', '最近工程', AT + 3000),
  makeProject('p2', '已完成工程', AT + 2000, true),
  makeProject('p3', '更早工程', AT + 1000),
];

function renderStartView(nav = navValue) {
  return renderWithProviders(
    <ConfigProvider>
      <AppNavProvider value={nav}>
        <ProjectsPage />
      </AppNavProvider>
    </ConfigProvider>,
    { store: new ChartProjectStore(makeMemoryProjectBackend(PROJECTS)) },
  );
}

// 卡片名会同时出现在 hero h2 与网格卡片 <b> 里 → 圈定在 .pb-grid 内查询
function cardOf(name: string): HTMLElement {
  const grid = document.querySelector('.pb-grid');
  expect(grid).toBeTruthy();
  return within(grid as HTMLElement).getByText(name).closest('.pb-card') as HTMLElement;
}

const pressKey = (key: string) => fireEvent.keyDown(window, { key });

/** 渲染并等待默认选中（最近打开）就位——hero 标题由渲染兜底先出，is-selected 随自愈 effect 提交 */
async function renderAndSelectFirst(nav = navValue) {
  renderStartView(nav);
  await screen.findByRole('heading', { name: /最近工程/ });
  await waitFor(() => expect(cardOf('最近工程')).toHaveClass('is-selected'));
  // 再让出一次宏任务：is-selected 现在由渲染期投影给出，可能先于「列数实测」那次 effect 提交，
  // 直接按键会读到"列数=1"的旧监听闭包（issue 19 #4 改选中口径后暴露；jsdom 无布局，列数只能实测）
  await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 0); }); });
}

describe('issue 14 · 工程卡片网格方向键导航与横幅跟随', () => {
  it('默认选中第一个卡片（最近打开），横幅是它的投影', async () => {
    await renderAndSelectFirst();
    expect(cardOf('已完成工程')).not.toHaveClass('is-selected');
    expect(screen.getByRole('heading', { name: /最近工程/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '进入工作台' })).toBeInTheDocument();
  });

  it('按 → 后框定卡片高亮转移，横幅内容同步更新', async () => {
    await renderAndSelectFirst();
    pressKey('ArrowRight');
    expect(cardOf('最近工程')).not.toHaveClass('is-selected');
    expect(cardOf('已完成工程')).toHaveClass('is-selected');
    expect(screen.getByRole('heading', { name: /已完成工程/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /最近工程/ })).toBeNull();
    // jsdom 无布局：3 张卡 offsetTop 相同 → 列数实测为 3，↓ 越界停在原地
    pressKey('ArrowDown');
    expect(cardOf('已完成工程')).toHaveClass('is-selected');
  });

  it('Enter 打开选中工程的详情层', async () => {
    await renderAndSelectFirst();
    pressKey('ArrowRight'); // 选中第二张：已完成工程
    pressKey('Enter');
    expect(await screen.findByRole('heading', { name: '已完成工程' })).toBeInTheDocument();
  });

  it('双击卡片打开该工程详情', async () => {
    await renderAndSelectFirst();
    fireEvent.dblClick(cardOf('更早工程'));
    expect(await screen.findByRole('heading', { name: '更早工程' })).toBeInTheDocument();
  });

  it('弹窗打开时不响应方向键', async () => {
    await renderAndSelectFirst();
    fireEvent.click(screen.getByRole('button', { name: /空白新建/ }));
    expect(screen.getByRole('heading', { name: '新建谱面工程' })).toBeInTheDocument();
    pressKey('ArrowRight');
    expect(cardOf('最近工程')).toHaveClass('is-selected');
  });

  it('Esc 无副作用：不移动选中、不弹任何东西', async () => {
    await renderAndSelectFirst();
    pressKey('Escape');
    expect(cardOf('最近工程')).toHaveClass('is-selected');
    expect(screen.queryByRole('heading', { name: '新建谱面工程' })).toBeNull();
  });

  it('非当前页（workspace 激活）不响应方向键', async () => {
    await renderAndSelectFirst({ ...navValue, activePage: 'workspace' as PageId });
    pressKey('ArrowRight');
    expect(cardOf('最近工程')).toHaveClass('is-selected');
  });
});
