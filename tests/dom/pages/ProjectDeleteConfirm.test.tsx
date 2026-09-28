// @vitest-environment jsdom
// issue 13：工程管理页的删除确认走自绘弹窗，不再是系统 window.confirm。
// 断言「弹的是自绘弹窗」+「确认后真的删掉」两件事；顺带锁住 window.confirm 一次都没被调用
// （那条总闸在 tests/static/NoWindowConfirm.test.ts，这里锁的是页面这一处的实际行为）。
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { AppNavProvider, type PageId } from '@/src/layouts/AppNav';
import { ConfigProvider } from '@/src/app/providers/ConfigProvider';
import ProjectsPage from '@/src/pages/ProjectsPage';
import {
  ChartProjectStore, type ChartProject, type ProjectChart,
} from '@/src/chart/project/ChartProject';
import {
  makeMemoryProjectBackend, renderWithProviders, type MemoryProjectBackend,
} from '@/tests/support/providers';
import { seedZhSettings } from '@/tests/support/storage';

const AT = 1_700_000_000_000;

const navValue = {
  activePage: 'projects' as PageId,
  setActivePage: () => {},
  navCollapsed: true,
  setNavCollapsed: () => {},
};

function makeChart(id: string): ProjectChart {
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
  };
}

function makeProject(id: string, name: string, lastOpened: number, charts: ProjectChart[]): ChartProject {
  return {
    id,
    name,
    artist: null,
    source: { type: 'custom' },
    durationSeconds: 30,
    lastOpened,
    charts,
    audioName: null,
    coverName: null,
  };
}

// 排序 = lastOpened 降序：p1（2 张谱面）→ p2（1 张谱面）
const PROJECTS = [
  makeProject('p1', '甲工程', AT + 2000, [makeChart('c-1a'), makeChart('c-1b')]),
  makeProject('p2', '乙工程', AT + 1000, [makeChart('c-2a')]),
];

let backend: MemoryProjectBackend;

beforeEach(() => {
  seedZhSettings();
  backend = makeMemoryProjectBackend(PROJECTS.map((p) => ({ ...p, charts: [...p.charts] })));
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderPage() {
  const store = new ChartProjectStore(backend);
  renderWithProviders(
    <ConfigProvider>
      <AppNavProvider value={navValue}>
        <ProjectsPage />
      </AppNavProvider>
    </ConfigProvider>,
    { store },
  );
  return store;
}

/** 卡片名会同时出现在 hero h2 与网格卡片 <b> 里 → 圈定在 .pb-grid 内查询 */
function cardOf(name: string): HTMLElement {
  const grid = document.querySelector('.pb-grid');
  if (!grid) throw new Error('找不到卡片网格');
  return within(grid as HTMLElement).getByText(name).closest('.pb-card') as HTMLElement;
}

/** 卡片菜单：第一张卡片的「更多」 */
async function openMenuOfFirstCard() {
  await screen.findByRole('heading', { name: /甲工程/ });
  fireEvent.click(screen.getAllByTitle('更多')[0]);
}

describe('issue 13 · 工程删除走自绘确认弹窗', () => {
  it('点删除工程 → 弹自绘确认（非 window.confirm），确认后工程真被删掉', async () => {
    renderPage();
    await openMenuOfFirstCard();

    fireEvent.click(screen.getByRole('button', { name: '删除工程' }));

    // 标题负责问（带对象名），正文只说后果 —— 两行各司其职（issue 16 文案定案）
    const dialog = await screen.findByRole('alertdialog', { name: '删除工程「甲工程」？' });
    expect(dialog).toHaveTextContent('注意：音频、封面和 2 张谱面都会删除。');
    expect(window.confirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '删除' }));

    await waitFor(() => expect(backend.disk.has('p1')).toBe(false));
    expect(backend.disk.has('p2')).toBe(true);
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it('点取消 → 弹窗关闭，工程还在', async () => {
    renderPage();
    await openMenuOfFirstCard();
    fireEvent.click(screen.getByRole('button', { name: '删除工程' }));
    await screen.findByRole('alertdialog', { name: '删除工程「甲工程」？' });

    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(backend.disk.has('p1')).toBe(true);
  });

  it('删除单张谱面同样弹自绘确认，确认后该谱面消失', async () => {
    renderPage();
    await screen.findByRole('heading', { name: /甲工程/ });
    fireEvent.click(cardOf('甲工程')); // 进工程详情
    const deleteChartButtons = await screen.findAllByTitle('删除谱面');
    expect(deleteChartButtons).toHaveLength(2); // 甲工程 2 张谱面

    fireEvent.click(deleteChartButtons[0]);

    await screen.findByRole('alertdialog', { name: '删除这张谱面？' });
    expect(window.confirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '删除' }));

    await waitFor(() => expect(backend.disk.get('p1')?.charts).toHaveLength(1));
  });
});
