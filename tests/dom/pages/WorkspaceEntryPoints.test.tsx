// @vitest-environment jsdom
// issue 23 #1 的正面半边（规格 L51）：拆分 `openWorkspace` 后，**5 个"要跳页"的入口
// 必须逐个仍然跳工作台** —— 防止拆分时漏改一个，把人变成"点了没反应"。
//
// 与 ProjectCreateCopyLanding.test.tsx 互补：那边锁"创建/复制不跳"，这边锁"其余全跳"。
// 只做静态断言（setActivePage('workspace') 全仓一处）是不够的：那能证明入口没有重复实现，
// 但证明不了 5 个入口各自的接线还连着 —— 删掉调用同样会让静态闸变绿。
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
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

const PROJECTS = [makeProject('p1', '甲工程', 200), makeProject('p2', '乙工程', 100)];

beforeEach(() => {
  seedZhSettings();
  setActivePage.mockClear();
});

function renderPage() {
  return renderWithProviders(
    <ConfigProvider>
      <AppNavProvider value={navValue}><ProjectsPage /></AppNavProvider>
    </ConfigProvider>,
    { store: new ChartProjectStore(makeMemoryProjectBackend(PROJECTS)) },
  );
}

/** 等到"跳工作台"这件事发生（或超时失败） */
const expectWorkspace = async () => {
  await waitFor(() => expect(setActivePage).toHaveBeenCalledWith('workspace'));
};

async function openDetail() {
  await screen.findByText('全部工程');
  fireEvent.click(document.querySelector('.pb-card') as HTMLElement);
  await screen.findByRole('heading', { name: '甲工程' });
}

describe('issue 23 #1 · 5 个跳工作台入口逐个仍在跳', () => {
  it('① 启动台 hero 的「进入工作台」', async () => {
    renderPage();
    await screen.findByText('全部工程');
    fireEvent.click(screen.getByRole('button', { name: /进入工作台/ }));
    await expectWorkspace();
  });

  it('② 启动台卡片的播放按钮', async () => {
    renderPage();
    await screen.findByText('全部工程');
    const play = document.querySelector('.pb-card__play') as HTMLElement;
    expect(play, '卡片播放按钮没渲染').toBeTruthy();
    fireEvent.click(play);
    await expectWorkspace();
  });

  it('③ 详情头部（原「在工作台打开」）', async () => {
    renderPage();
    await openDetail();
    fireEvent.click(screen.getByRole('button', { name: /在工作台打开/ }));
    await expectWorkspace();
  });

  it('④ 谱面行的「打开」', async () => {
    renderPage();
    await openDetail();
    fireEvent.click(screen.getByRole('button', { name: /^打开$/ }));
    await expectWorkspace();
  });

  it('⑤ 详情左栏工程条目双击', async () => {
    renderPage();
    await openDetail();
    const item = [...document.querySelectorAll('.pc-item')]
      .find((el) => el.textContent?.includes('乙工程')) as HTMLElement;
    fireEvent.doubleClick(item);
    await expectWorkspace();
  });

  it('左栏单击只切视图，**不**跳工作台（单击 ≠ 双击）', async () => {
    renderPage();
    await openDetail();
    const item = [...document.querySelectorAll('.pc-item')]
      .find((el) => el.textContent?.includes('乙工程')) as HTMLElement;
    fireEvent.click(item);
    await screen.findByRole('heading', { name: '乙工程' });
    expect(setActivePage).not.toHaveBeenCalledWith('workspace');
  });
});
