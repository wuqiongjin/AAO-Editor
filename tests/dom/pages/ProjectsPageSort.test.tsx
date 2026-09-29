// @vitest-environment jsdom
// issue 19 #4：启动台排序界面 —— 换排序后卡片顺序变且写回 settings.projects.sort；
// 排序从设置对象读回（跨会话沿用）；hero 的默认选中恒为「最近打开」，不随排序走。
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ConfigProvider } from '@/src/app/providers/ConfigProvider';
import { AppNavProvider, type PageId } from '@/src/layouts/AppNav';
import ProjectsPage from '@/src/pages/projects/ProjectsPage';
import { ChartProjectStore, type ChartProject, type ProjectChart } from '@/src/project/ChartProject';
import { makeMemoryProjectBackend, renderWithProviders } from '@/tests/support/providers';
import { SETTINGS_KEY, seedZhSettings } from '@/tests/support/storage';

const navValue = {
  activePage: 'projects' as PageId,
  setActivePage: () => {},
  pageScope: null,
  navCollapsed: true,
  setNavCollapsed: () => {},
};

function makeChart(id: string, lastModified: number): ProjectChart {
  return {
    id,
    notes: [{ beat: 0, type: 'BPM', bpm: 120 }],
    title: null, diff: 3, level: null, completed: false, upload: null,
    lastModified, appliedChartCodeText: null, chartCodePristine: false,
  };
}

function makeProject(id: string, name: string, lastOpened: number, lastModifieds: number[]): ChartProject {
  return {
    id, name, artist: null, source: { type: 'custom' },
    durationSeconds: 30, lastOpened,
    charts: lastModifieds.map((n, i) => makeChart(`c-${id}-${i}`, n)),
    audioName: null, coverName: null,
  };
}

// 四个键互有胜负（与 projectSort 单测同构）：
//   最近打开 p2,p1,p3 ｜ 最近修改 p3,p1,p2 ｜ 谱面数量 p2,p3,p1 ｜ 名称 p2,p3,p1
const PROJECTS = [
  makeProject('p1', 'Zulu', 200, [500]),
  makeProject('p2', 'Alpha', 300, [100, 100, 100]),
  makeProject('p3', 'Mike', 100, [900, 900]),
];

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

/** 卡片显示序：`data-project-id`（DOM 顺序即展示序） */
function cardOrder(): (string | undefined)[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.pb-card')).map((c) => c.dataset.projectId);
}

function sortSelect(): HTMLSelectElement {
  return screen.getByRole('combobox', { name: '排序' }) as HTMLSelectElement;
}

function storedSort(): unknown {
  return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}').projects?.sort;
}

const heroName = () => screen.getByRole('heading', { level: 2 });

describe('issue 19 #4 · 启动台排序', () => {
  it('默认「最近打开」：卡片按 lastOpened 降序，hero 默认选中最近打开', async () => {
    renderHub();
    await screen.findByText('全部工程');

    await waitFor(() => expect(cardOrder()).toEqual(['p2', 'p1', 'p3']));
    expect(sortSelect().value).toBe('lastOpened');
    expect(heroName()).toHaveTextContent('Alpha');
  });

  it('切成「谱面数量」：卡片重排 + 写回 settings.projects.sort；hero 仍是最最近打开', async () => {
    renderHub();
    await screen.findByText('全部工程');
    await waitFor(() => expect(cardOrder()).toEqual(['p2', 'p1', 'p3']));

    fireEvent.change(sortSelect(), { target: { value: 'chartCount' } });

    await waitFor(() => expect(cardOrder()).toEqual(['p2', 'p3', 'p1']));
    expect(storedSort()).toBe('chartCount');
    // 排序不影响「继续创作」的默认选中口径（issue 19 #4 定案）
    expect(heroName()).toHaveTextContent('Alpha');
  });

  it('启动时读回设置对象里的排序：seed「最近修改」→ 首屏即按它排', async () => {
    seedZhSettings({ projects: { sort: 'lastModified' } });
    renderHub();

    await waitFor(() => expect(cardOrder()).toEqual(['p3', 'p1', 'p2']));
    expect(sortSelect().value).toBe('lastModified');
    expect(heroName()).toHaveTextContent('Alpha');
  });
});
