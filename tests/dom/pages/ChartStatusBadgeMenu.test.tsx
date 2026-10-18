// @vitest-environment jsdom
// 票 41：谱面状态徽标就地状态菜单 —— 撤掉独立「标为完成」文字按钮后，
// 详情页谱面行的状态徽标成为唯一状态入口：点开垂直小菜单（未完成 / 已完成，当前态标活），
// 选中即提交；已上传谱面 inert（点不出菜单、记录不变）；点当前态不翻转。
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { ConfigProvider } from '@/src/app/providers/ConfigProvider';
import { AppNavProvider, type AppNavValue } from '@/src/layouts/AppNav';
import ProjectsPage from '@/src/pages/projects/ProjectsPage';
import { ChartProjectStore, type ChartProject, type ProjectChart } from '@/src/project/ChartProject';
import {
  useCurrentProject,
  type CurrentProjectContextValue,
} from '@/src/app/providers/CurrentProjectProvider';
import { makeMemoryProjectBackend, renderWithProviders, type MemoryProjectBackend } from '@/tests/support/providers';
import { seedZhSettings } from '@/tests/support/storage';

const AT = 1_700_000_000_000;

function chart(id: string, patch: Partial<ProjectChart> = {}): ProjectChart {
  return {
    id,
    notes: [{ beat: 0, type: 'BPM', bpm: 120 }],
    title: null,
    diff: 3,
    level: null,
    completed: false,
    upload: null,
    lastModified: AT,
    appliedChartCodeText: null,
    chartCodePristine: false,
    ...patch,
  };
}

function project(id: string, name: string, patch: Partial<ChartProject> = {}): ChartProject {
  return {
    id,
    name,
    artist: 'AYA',
    source: { type: 'custom' },
    durationSeconds: 30,
    lastOpened: AT,
    charts: [chart(`c-${id}`)],
    audioName: null,
    coverName: null,
    ...patch,
  };
}

/** 一张未完成（Expert 27）+ 一张已上传（Hard 15）：两种态在同一页对拍 */
const SEED = project('p1', '甲工程', {
  charts: [
    chart('c-a', { diff: 3, level: 27 }),
    chart('c-b', { diff: 2, level: 15, upload: { postId: 7, at: AT } }),
  ],
});

let backend: MemoryProjectBackend;
let setActivePage: ReturnType<typeof vi.fn>;
let ctx: { current: CurrentProjectContextValue | null };

beforeEach(() => {
  seedZhSettings();
  backend = makeMemoryProjectBackend([{ ...SEED, charts: [...SEED.charts] }]);
  setActivePage = vi.fn();
  ctx = { current: null };
});

function Probe() {
  ctx.current = useCurrentProject();
  return null;
}

function Harness({ children }: { children: React.ReactNode }) {
  const nav: AppNavValue = {
    activePage: 'projects',
    setActivePage: setActivePage as unknown as AppNavValue['setActivePage'],
    pageScope: null,
    navCollapsed: true,
    setNavCollapsed: () => {},
  };
  return (
    <ConfigProvider>
      <AppNavProvider value={nav}>
        <Probe />
        {children}
      </AppNavProvider>
    </ConfigProvider>
  );
}

async function renderDetail(): Promise<HTMLElement[]> {
  renderWithProviders(<Harness><ProjectsPage /></Harness>, { store: new ChartProjectStore(backend) });
  // 等的是**真卡片**而不是页头：目录 list() 未回来时网格是微光占位（pb-pending-*），
  // 此刻页头已在——按页头就开工会在慢机器上点空（全量并行跑批实测复现）。
  // 也不能「先 querySelector 抓住网格再 within 它等」：数据到位时骨架网格被真网格
  // **换掉**（节点身份变），抓住的是 detached 节点，within 它永远等不到。
  // findAllByText 每轮重新查，不受节点换血影响；超时放到 5s 抗并行负载。
  const cards = await screen.findAllByText('甲工程', undefined, { timeout: 5000 });
  fireEvent.click(cards.find((el) => el.closest('.pb-grid'))!); // 进工程详情
  await screen.findByRole('heading', { name: '甲工程' }); // 详情就绪
  return Array.from(document.querySelectorAll<HTMLElement>('.pc-chart'));
}

/** 浮层 portal 到 body，按类名取（与 DiffLevelBadge / Menu 的既有测试取法一致） */
function menuPanel(): HTMLElement {
  return document.querySelector('.pp-menu__panel') as HTMLElement;
}

describe('票 41 · 谱面状态徽标就地状态菜单', () => {
  it('点徽标出垂直菜单：未完成 / 已完成两项，当前态标活', async () => {
    const rows = await renderDetail();

    fireEvent.click(within(rows[0]).getByRole('button', { name: '未完成' }));

    const panel = menuPanel();
    expect(panel).not.toBeNull();
    expect(within(panel).getByRole('button', { name: '未完成' })).toHaveClass('is-active');
    expect(within(panel).getByRole('button', { name: '已完成' })).not.toHaveClass('is-active');
    // 验收反馈（Q1=A）：每行图标表意——○ 未完成 / ✓ 已完成，与触发徽标同一套
    // ChartStatusIcon 图标学；当前态只由 is-active 标活，勾回到"已完成"本义。
    expect(within(panel).getByRole('button', { name: '未完成' }).querySelector('svg.pp-st--unfinished')).not.toBeNull();
    expect(within(panel).getByRole('button', { name: '已完成' }).querySelector('svg.pp-st--completed')).not.toBeNull();
    // 已上传是派生态，不进选项
    expect(within(panel).queryByRole('button', { name: '已上传' })).toBeNull();
  });

  it('选「已完成」→ 徽标与记录同步切换；可选回「未完成」', async () => {
    const rows = await renderDetail();

    fireEvent.click(within(rows[0]).getByRole('button', { name: '未完成' }));
    await act(async () => {
      fireEvent.click(within(menuPanel()).getByRole('button', { name: '已完成' }));
    });
    expect(within(rows[0]).getByRole('button', { name: '已完成' })).toBeInTheDocument();
    expect(backend.disk.get('p1')!.charts[0].completed).toBe(true);
    // 左栏完成比例即时跟变（锁测段要求）：1/2（已上传那张计入）→ 2/2
    expect(within(document.querySelector('.pc-item') as HTMLElement).getByText(/2\/2 完成/)).toBeInTheDocument();

    fireEvent.click(within(rows[0]).getByRole('button', { name: '已完成' }));
    await act(async () => {
      fireEvent.click(within(menuPanel()).getByRole('button', { name: '未完成' }));
    });
    expect(within(rows[0]).getByRole('button', { name: '未完成' })).toBeInTheDocument();
    expect(backend.disk.get('p1')!.charts[0].completed).toBe(false);
    expect(within(document.querySelector('.pc-item') as HTMLElement).getByText(/1\/2 完成/)).toBeInTheDocument();
  });

  it('点当前态不翻转记录，只收起菜单', async () => {
    const rows = await renderDetail();

    fireEvent.click(within(rows[0]).getByRole('button', { name: '未完成' }));
    await act(async () => {
      fireEvent.click(within(menuPanel()).getByRole('button', { name: '未完成' }));
    });

    expect(backend.disk.get('p1')!.charts[0].completed).toBe(false);
    expect(menuPanel()).toBeNull();
  });

  it('已上传谱面徽标 inert：点不出菜单、记录不变', async () => {
    const rows = await renderDetail();

    //  inert = 连按钮都不是，只是展示
    expect(within(rows[1]).queryByRole('button', { name: '已上传' })).toBeNull();
    fireEvent.click(within(rows[1]).getByText('已上传'));

    expect(menuPanel()).toBeNull();
    const uploaded = backend.disk.get('p1')!.charts[1];
    expect(uploaded.completed).toBe(false);
    expect(uploaded.upload).not.toBeNull();
  });
});
