// @vitest-environment jsdom
// issue 09：工程启动台空状态与引导横幅。
// issue 29：目录未就绪（list() 还没回来）≠ 0 工程 —— 未就绪不渲染空态，就绪后为空才渲染。
// 0 工程 → 横幅位是引导横幅（占 hero 同一节点）+ 网格区 EmptyState（主行动 = 新建空白工程）；
// 有工程（哪怕全已完成）→ hero 仍渲染（防「横幅没了」回归）。
// 视觉几何（占位等高）jsdom 测不了 → 人工门票：0 工程 vs 1 工程并列截图对比 hero 区高度一致。
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { AppNavProvider, type PageId } from '@/src/layouts/AppNav';
import { ConfigProvider } from '@/src/app/providers/ConfigProvider';
import ProjectsPage from '@/src/pages/projects/ProjectsPage';
import {
  ChartProjectStore, type ChartProject, type ProjectChart,
} from '@/src/project/ChartProject';
import {
  makeMemoryProjectBackend, renderWithProviders, type MemoryProjectBackend,
} from '@/tests/support/providers';
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

function renderStartViewWith(backend: MemoryProjectBackend) {
  return renderWithProviders(
    <ConfigProvider>
      <AppNavProvider value={navValue}>
        <ProjectsPage />
      </AppNavProvider>
    </ConfigProvider>,
    { store: new ChartProjectStore(backend) },
  );
}

function renderStartView(projects: ChartProject[]) {
  return renderStartViewWith(makeMemoryProjectBackend(projects));
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

describe('issue 29 · 目录未就绪 ≠ 0 工程', () => {
  it('list() 还没回来：不渲染空态 / 引导横幅 / 0 计数；放行且确实为空才轮到空态', async () => {
    const backend = makeMemoryProjectBackend([], { deferList: true });
    renderStartViewWith(backend);

    // 这一帧目录还没读回来：不能说"还没有工程"，也不能拿 0 当计数
    expect(screen.queryByText('还没有工程')).toBeNull();
    expect(screen.queryByText('从第一个工程开始')).toBeNull();
    expect(screen.queryByRole('button', { name: '创建第一个工程' })).toBeNull();
    expect(screen.queryByText('0')).toBeNull();

    backend.releaseList();

    expect(await screen.findByText('还没有工程')).toBeInTheDocument();
    expect(screen.getByText('从第一个工程开始')).toBeInTheDocument();
  });

  it('启动预载与页面挂载合并成一次读盘（页面消费同一个进行中 Promise）', async () => {
    let listCalls = 0;
    const backend = makeMemoryProjectBackend([], { deferList: true });
    const counting: MemoryProjectBackend = {
      ...backend,
      list: () => {
        listCalls += 1;
        return backend.list();
      },
    };
    renderStartViewWith(counting);

    // Provider 的预载与页面自己的 reload 落在同一个进行中的 Promise 上，只读一次盘
    expect(listCalls).toBe(1);

    backend.releaseList();

    expect(await screen.findByText('还没有工程')).toBeInTheDocument();
    expect(listCalls).toBe(1);
  });

  it('list() 还没回来但有工程：不闪空态，放行后直接出 hero', async () => {
    const backend = makeMemoryProjectBackend(
      [makeProject('pOne', [makeChart('c1')])],
      { deferList: true },
    );
    renderStartViewWith(backend);

    expect(screen.queryByText('还没有工程')).toBeNull();
    expect(screen.queryByText('从第一个工程开始')).toBeNull();

    backend.releaseList();

    expect(await screen.findByText('继续创作')).toBeInTheDocument();
    expect(screen.queryByText('还没有工程')).toBeNull();
    expect(screen.queryByText('从第一个工程开始')).toBeNull();
  });
});
