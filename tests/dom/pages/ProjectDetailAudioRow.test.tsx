// @vitest-environment jsdom
// 票 15 定案 2/6：工程详情那一行音频**只读展示 + 带作用域跳转**，不开第二个管理面。
//
// 详情侧只做两件事：把"这个工程有什么音频、锁没锁、锁在谁身上"说清楚，以及给一枚
// 「设置音频」chip 跳到音频页去改——跳过去时把 scope 带上，当前工程不许被切走（票 22 §6）。
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

/** 已上传谱面 → 锁定，且锁源（谱面）要能报得出名字与难度等级 */
const LOCKED = project('p1', '甲工程', {
  audioName: '甲.mp3',
  durationSeconds: 96,
  charts: [chart('c-p1', { diff: 3, level: 27, upload: { postId: 7, at: AT } })],
});
const PLAIN = project('p2', '乙工程');

let backend: MemoryProjectBackend;
let setActivePage: ReturnType<typeof vi.fn>;
let ctx: { current: CurrentProjectContextValue | null };

beforeEach(() => {
  seedZhSettings();
  backend = makeMemoryProjectBackend([{ ...LOCKED, charts: [...LOCKED.charts] }, { ...PLAIN }]);
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

async function renderDetail(projectName: string) {
  renderWithProviders(<Harness><ProjectsPage /></Harness>, { store: new ChartProjectStore(backend) });
  await screen.findByText('全部工程'); // 启动台就绪
  const grid = document.querySelector('.pb-grid') as HTMLElement;
  fireEvent.click(within(grid).getByText(projectName)); // 进工程详情
  return screen.findByRole('button', { name: /设置音频/ });
}

describe('票 15 · 工程详情音频行（只读展示 + 带作用域跳转）', () => {
  it('只读展示文件名与时长，不给任何管理控件', async () => {
    await renderDetail('甲工程');

    expect(screen.getByText(/甲\.mp3/)).toBeInTheDocument();
    // 管理动作一律不在这一页（唯一管理入口是音频页）
    expect(screen.queryByRole('button', { name: '更换音频' })).toBeNull();
    expect(screen.queryByRole('button', { name: '清除' })).toBeNull();
    expect(screen.queryByRole('button', { name: '导入音频' })).toBeNull();
  });

  it('锁定文案点名是哪张（已上传的）谱面，不是一句"已锁定"', async () => {
    await renderDetail('甲工程');

    expect(screen.getByText('已上传谱面 甲工程（Expert 27），音频与时长已锁定')).toBeInTheDocument();
  });

  it('「设置音频」chip 带 scope 跳到音频页（不切当前工程）', async () => {
    const chip = await renderDetail('甲工程');

    expect(chip).toHaveAttribute('title', '前往音频页设置此工程的音频（不切换当前工程）');
    fireEvent.click(chip);

    expect(setActivePage).toHaveBeenCalledWith('audio', { scope: { projectId: 'p1' } });
    // 跳转不是"切当前工程"：没有任何 open 调用（当前工程仍是启动时那一个）
    expect(ctx.current!.projectId).not.toBe('p1');
  });

  it('音频在别处被改（音频页）→ 目录版本一涨，详情行跟着刷新（两处显示一致）', async () => {
    await renderDetail('甲工程');
    expect(screen.getByText(/甲\.mp3/)).toBeInTheDocument();

    await act(async () => {
      backend.disk.set('p1', { ...(backend.disk.get('p1') as ChartProject), audioName: '甲-改.mp3' });
      ctx.current!.notifyCatalogChanged();
    });

    expect(await screen.findByText(/甲-改\.mp3/)).toBeInTheDocument();
    expect(screen.queryByText(/甲\.mp3/)).toBeNull();
  });
});
