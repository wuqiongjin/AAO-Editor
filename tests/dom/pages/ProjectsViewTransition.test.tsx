// @vitest-environment jsdom
// issue 19 #1：视图包裹层的方向 class 接线 + 「详情内换工程不重挂载」（动画不重放、滚动不丢）。
// 滑入观感（位移方向 / 时长）jsdom 验不了 → 票内人工门票；这里锁的是可编程的结构事实。
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { ConfigProvider } from '@/src/app/providers/ConfigProvider';
import { AppNavProvider, type PageId } from '@/src/layouts/AppNav';
import ProjectsPage from '@/src/pages/ProjectsPage';
import { ChartProjectStore, type ChartProject, type ProjectChart } from '@/src/chart/project/ChartProject';
import { makeMemoryProjectBackend, renderWithProviders } from '@/tests/support/providers';
import { seedZhSettings } from '@/tests/support/storage';

const navValue = {
  activePage: 'projects' as PageId,
  setActivePage: () => {},
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
});

function renderHub() {
  return renderWithProviders(
    <ConfigProvider>
      <AppNavProvider value={navValue}><ProjectsPage /></AppNavProvider>
    </ConfigProvider>,
    { store: new ChartProjectStore(makeMemoryProjectBackend(PROJECTS)) },
  );
}

const view = () => document.querySelector('.pm-view') as HTMLElement;

async function openDetail() {
  await screen.findByText('全部工程');
  fireEvent.click(document.querySelector('.pb-card') as HTMLElement);
  await screen.findByRole('heading', { name: '甲工程' });
}

describe('issue 19 #1 · 主页 ↔ 详情切换动效的接线', () => {
  it('默认主页：forward 包裹层里是启动台', async () => {
    renderHub();
    await screen.findByText('全部工程');

    expect(view()).toHaveClass('pm-view', 'pm-view--forward');
    expect(view().querySelector('.pb-page')).not.toBeNull();
  });

  it('点卡片进详情 → forward；点「主页」回来 → back', async () => {
    renderHub();
    await openDetail();
    expect(view()).toHaveClass('pm-view--forward');
    expect(view().querySelector('.pc-page')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '← 主页' }));
    expect(await screen.findByText('全部工程')).toBeInTheDocument();
    expect(view()).toHaveClass('pm-view--back');
    expect(view().querySelector('.pb-page')).not.toBeNull();
  });

  it('详情内切换工程不换包裹层节点（动画不重放、滚动不丢）', async () => {
    renderHub();
    await openDetail();
    const before = view();

    const list = document.querySelector('.pc-list') as HTMLElement;
    fireEvent.click(within(list).getByText('乙工程'));
    await screen.findByRole('heading', { name: '乙工程' });

    expect(view()).toBe(before); // 同一 DOM 节点 = 没重挂载
    expect(view()).toHaveClass('pm-view--forward');
  });
});
