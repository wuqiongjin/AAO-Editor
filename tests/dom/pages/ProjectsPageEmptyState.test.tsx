// @vitest-environment jsdom
// issue 09：工程启动台空状态与引导横幅。
// 0 工程 → 横幅位是引导横幅（占 hero 同一节点）+ 网格区 EmptyState（主行动 = 新建空白工程）；
// 有工程（哪怕全已完成）→ hero 仍渲染（防「横幅没了」回归）。
// 视觉几何（占位等高）jsdom 测不了 → 人工门票：0 工程 vs 1 工程并列截图对比 hero 区高度一致。
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { AppNavProvider, type PageId } from '@/src/layouts/AppNav';
import { ConfigProvider } from '@/src/app/providers/ConfigProvider';
import ProjectsPage from '@/src/pages/ProjectsPage';
import {
  ChartProjectStore, type ChartProject, type ProjectChart,
} from '@/src/chart/project/ChartProject';
import { makeMemoryProjectBackend, renderWithProviders } from '@/tests/support/providers';
import { seedZhSettings } from '@/tests/support/storage';

beforeEach(() => {
  seedZhSettings();
});

const AT = 1_700_000_000_000;

const navValue = {
  activePage: 'projects' as PageId,
  setActivePage: () => {},
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

function makeProject(id: string, charts: ProjectChart[]): ChartProject {
  return {
    id,
    name: `工程 ${id}`,
    artist: null,
    source: { type: 'custom' },
    durationSeconds: 30,
    lastOpened: AT,
    charts,
    audioName: null,
    coverName: null,
  };
}

function renderStartView(projects: ChartProject[]) {
  return renderWithProviders(
    <ConfigProvider>
      <AppNavProvider value={navValue}>
        <ProjectsPage />
      </AppNavProvider>
    </ConfigProvider>,
    { store: new ChartProjectStore(makeMemoryProjectBackend(projects)) },
  );
}

describe('issue 09 · 工程管理页空状态与引导横幅', () => {
  it('list=[]：横幅位渲染引导横幅，网格区 EmptyState 引导，主行动打开新建弹窗', async () => {
    renderStartView([]);

    // 引导横幅占住 hero 节点：内容按文案查，节点归属按 spec「占位 hero 同一节点」锁结构
    const bannerHeading = await screen.findByRole('heading', { name: '从第一个工程开始' });
    expect(bannerHeading.closest('section')).toHaveClass('pb-hero', 'pb-hero--guide');
    // 网格区 EmptyState 引导文案
    expect(screen.getByText('还没有工程')).toBeInTheDocument();
    // 主行动 = 新建空白工程：点击后弹出「新建谱面工程」
    fireEvent.click(screen.getByRole('button', { name: '创建第一个工程' }));
    expect(screen.getByRole('heading', { name: '新建谱面工程' })).toBeInTheDocument();
  });

  it('list=[单个已完成工程]：hero 仍渲染（防「横幅没了」回归），引导横幅不出现', async () => {
    renderStartView([makeProject('pDone', [makeChart('c1', true)])]);

    expect(await screen.findByText('继续创作')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '进入工作台' })).toBeInTheDocument();
    expect(screen.queryByText('从第一个工程开始')).toBeNull();
    expect(screen.queryByText('还没有工程')).toBeNull();
  });
});
