// @vitest-environment jsdom
// issue 40：横幅锚跟随排序键 + 打开工程后不滞留老工程（用户 2026-10-18 报，定案同日）。
// 定案（用户 2026-10-18，采纳推荐口径）：
//   A  锚 = 排序头活派生（lastOpened → 最近打开、lastModified → 最近修改，其余键回落最近打开）；
//   Q2 手动浏览焦点（方向键）是临时覆盖——排序切换 / 打开工程都清空、回落排序头；
//   Q3 眉题「继续创作」不动。
// a / b / b2 是两条报症状的复现形态；c ~ f 锁定定案的边界（防只修一半）。
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ConfigProvider } from '@/src/app/providers/ConfigProvider';
import { AppNavProvider, type PageId } from '@/src/layouts/AppNav';
import ProjectsPage from '@/src/pages/projects/ProjectsPage';
import { ChartProjectStore, type ChartProject, type ProjectChart } from '@/src/project/ChartProject';
import { makeMemoryProjectBackend, renderWithProviders } from '@/tests/support/providers';
import { seedZhSettings } from '@/tests/support/storage';

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

const T = Date.now();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// a) 种子：p1「Old」= 当前最近打开（30 分钟前），p2「Other」更早（2 小时前）。
// 点 p2 播放角标 = 从主页直接进工作台（保活，hub 全程不卸载——a 的复现前提）。
const OPEN_PROJECTS = [
  makeProject('p1', 'Old', T - 30 * MIN, [T - 2 * DAY]),
  makeProject('p2', 'Other', T - 2 * HOUR, [T - 3 * DAY]),
];

// c) 种子：三工程——浏览到最老的 p3，再打开 p2，手动焦点须让位。
const BROWSE_PROJECTS = [
  makeProject('p1', 'Old', T - 30 * MIN, [T - 2 * DAY]),
  makeProject('p2', 'Middle', T - 2 * HOUR, [T - 3 * DAY]),
  makeProject('p3', 'Oldest', T - 4 * HOUR, [T - 5 * DAY]),
];

// b) 种子：复刻 issue 37 的错档设计——打开序与修改序的头不是同一个工程。
// 打开 p2,p1,p3 ｜ 修改 p3,p1,p2 ｜ 数量 p3,p2,p1（p3 两张谱面）。
const TIME_PROJECTS = [
  makeProject('p1', 'Zulu', T - 5 * HOUR, [T - 2 * DAY]),
  makeProject('p2', 'Alpha', T - 30 * MIN, [T - 10 * DAY]),
  makeProject('p3', 'Mike', T - 4 * DAY, [T - 1 * HOUR, T - 1 * HOUR]),
];

beforeEach(() => {
  seedZhSettings();
});

function renderHub(projects: ChartProject[]) {
  return renderWithProviders(
    <ConfigProvider>
      <AppNavProvider value={navValue}><ProjectsPage /></AppNavProvider>
    </ConfigProvider>,
    { store: new ChartProjectStore(makeMemoryProjectBackend(projects)) },
  );
}

/** 卡片显示序：`data-project-id`（DOM 顺序即展示序） */
function cardOrder(): (string | undefined)[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.pb-card')).map((c) => c.dataset.projectId);
}

const heroName = () => screen.getByRole('heading', { level: 2 });

function sortSelect(): HTMLSelectElement {
  return screen.getByRole('combobox', { name: '排序' }) as HTMLSelectElement;
}

/** 卡片播放角标：从主页直接进工作台的那条路（保活，hub 不卸载） */
function playOf(id: string): HTMLElement {
  const play = document.querySelector<HTMLElement>(`.pb-card[data-project-id="${id}"] .pb-card__play`);
  if (!play) throw new Error(`card ${id} 的播放角标不在 DOM 里`);
  return play;
}

/** 让「列数实测」effect 先提交：jsdom 无布局，直接按键会读到列数=1 的旧监听闭包（同 ProjectGridKeyboard 口径） */
async function settleColumns() {
  await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 0); }); });
}

describe('issue 40 · 横幅锚跟随排序键（定案 A）', () => {
  it('b) seed「最近修改」：横幅 = 最近修改的 p3，不是最近打开的 p2', async () => {
    seedZhSettings({ projects: { sort: 'lastModified' } });
    renderHub(TIME_PROJECTS);
    await screen.findByText('全部工程');
    await waitFor(() => expect(cardOrder()).toEqual(['p3', 'p1', 'p2']));

    expect(heroName()).toHaveTextContent('Mike');
  });

  it('b2) 运行中切「最近修改」：列表重排后横幅跟着切到 p3', async () => {
    renderHub(TIME_PROJECTS);
    await screen.findByText('全部工程');
    await waitFor(() => expect(cardOrder()).toEqual(['p2', 'p1', 'p3']));
    expect(heroName()).toHaveTextContent('Alpha');

    fireEvent.change(sortSelect(), { target: { value: 'lastModified' } });

    await waitFor(() => expect(cardOrder()).toEqual(['p3', 'p1', 'p2']));
    expect(heroName()).toHaveTextContent('Mike');
  });

  it('e) 「谱面数量」排序：横幅回落「最近打开」，不跟列表头（非时间键不改 resume 语义）', async () => {
    renderHub(TIME_PROJECTS);
    await screen.findByText('全部工程');
    await waitFor(() => expect(cardOrder()).toEqual(['p2', 'p1', 'p3']));

    fireEvent.change(sortSelect(), { target: { value: 'chartCount' } });

    await waitFor(() => expect(cardOrder()).toEqual(['p3', 'p2', 'p1']));
    // 列表头是 p3（两张谱面），横幅仍是最最近打开的 p2
    expect(heroName()).toHaveTextContent('Alpha');
  });

  it('f) 「最近修改」下打开工程：锚不随打开动（打开不改谱面 lastModified）', async () => {
    seedZhSettings({ projects: { sort: 'lastModified' } });
    renderHub(TIME_PROJECTS);
    await screen.findByText('全部工程');
    await waitFor(() => expect(cardOrder()).toEqual(['p3', 'p1', 'p2']));
    expect(heroName()).toHaveTextContent('Mike');

    fireEvent.click(playOf('p2'));

    // 打开真的发生了（p2 戴上「当前」角标），但修改序没变 → 横幅仍是 p3
    await waitFor(() => {
      expect(document.querySelector('.pb-card[data-project-id="p2"]')).toHaveClass('is-current');
    });
    await waitFor(() => expect(cardOrder()).toEqual(['p3', 'p1', 'p2']));
    expect(heroName()).toHaveTextContent('Mike');
  });
});

describe('issue 40 · 打开工程后横幅不滞留老工程（症状 a）', () => {
  it('a) 主页打开 p2 再回来，横幅换成刚打开的 p2', async () => {
    renderHub(OPEN_PROJECTS);
    await screen.findByText('全部工程');
    await waitFor(() => expect(cardOrder()).toEqual(['p1', 'p2']));
    expect(heroName()).toHaveTextContent('Old');

    fireEvent.click(playOf('p2'));

    // 列表已按新 lastOpened 重排（p2 到头），横幅必须跟着走
    await waitFor(() => expect(cardOrder()).toEqual(['p2', 'p1']));
    expect(heroName()).toHaveTextContent('Other');
  });
});

describe('issue 40 · 手动浏览焦点让位（定案 Q2）', () => {
  it('c) 浏览到 p3 后打开 p2：手动焦点让位，回落后排序头（刚打开的 p2）', async () => {
    renderHub(BROWSE_PROJECTS);
    await screen.findByText('全部工程');
    await waitFor(() => expect(cardOrder()).toEqual(['p1', 'p2', 'p3']));
    await settleColumns();

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(heroName()).toHaveTextContent('Oldest');

    fireEvent.click(playOf('p2'));

    await waitFor(() => expect(cardOrder()).toEqual(['p2', 'p1', 'p3']));
    expect(heroName()).toHaveTextContent('Middle');
  });

  it('d) 浏览后切排序：手动焦点让位，横幅 = 新排序头', async () => {
    renderHub(TIME_PROJECTS);
    await screen.findByText('全部工程');
    await waitFor(() => expect(cardOrder()).toEqual(['p2', 'p1', 'p3']));
    await settleColumns();

    fireEvent.keyDown(window, { key: 'ArrowRight' }); // 浏览到 p1（Zulu）
    expect(heroName()).toHaveTextContent('Zulu');

    fireEvent.change(sortSelect(), { target: { value: 'lastModified' } });

    await waitFor(() => expect(cardOrder()).toEqual(['p3', 'p1', 'p2']));
    // 手动焦点被清：横幅 = 修改序的头 p3，不是浏览中的 p1
    expect(heroName()).toHaveTextContent('Mike');
  });

  it('e2) 编辑工程信息（hub 不卸载）：手动焦点不动，横幅仍是浏览中的工程', async () => {
    renderHub(BROWSE_PROJECTS);
    await screen.findByText('全部工程');
    await waitFor(() => expect(cardOrder()).toEqual(['p1', 'p2', 'p3']));
    await settleColumns();

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(heroName()).toHaveTextContent('Oldest');

    // 卡片 ⋯ 菜单 → 编辑工程信息，改 p1 的名字（弹窗路径：hub 不卸载，列表 reload）
    fireEvent.click(document.querySelector<HTMLElement>('.pb-card[data-project-id="p1"] .pp-menu__trigger')!);
    fireEvent.click(screen.getByRole('button', { name: '编辑工程信息' }));
    fireEvent.change(screen.getByLabelText('工程名称'), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    // 编辑真的落了（卡片名换新），且手动焦点没被编辑打跑——定案 Q2「编辑、切页回来不动它」
    const grid = document.querySelector('.pb-grid') as HTMLElement;
    await waitFor(() => {
      expect(within(grid).getByText('Renamed')).toBeInTheDocument();
    });
    expect(heroName()).toHaveTextContent('Oldest');
    expect(document.querySelector('.pb-card[data-project-id="p3"]')).toHaveClass('is-selected');
  });
});
