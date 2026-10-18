// @vitest-environment jsdom
// issue 19 #4：启动台排序界面 —— 换排序后卡片顺序变且写回 settings.projects.sort；
// 排序从设置对象读回（跨会话沿用）。
// issue 37：列表时间戳跟随排序键 —— 卡片 / hero 显示哪个工程时间戳由 sort 决定，
// 且贴短标签（打开 / 修改）；「最近修改」下眼睛看到的必须就是排序依据本身。
// issue 40：横幅锚跟随排序键（定案 A）—— 时间键取该键的头，其余键回落最近打开；
// 手动浏览焦点在排序切换 / 打开工程时让位（见 ProjectHeroAnchor.test.tsx）。
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ConfigProvider } from '@/src/app/providers/ConfigProvider';
import { AppNavProvider, type PageId } from '@/src/layouts/AppNav';
import ProjectsPage from '@/src/pages/projects/ProjectsPage';
import { ChartProjectStore, type ChartProject, type ProjectChart } from '@/src/project/ChartProject';
import { relTime } from '@/src/pages/projects/projectFormat';
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

// 时间跟随专用种子（issue 37）：每个工程的 lastOpened 与谱面 lastModified 落在
// **不同时间档**——同档就分不出卡片显示的到底是哪个时间戳（都渲染成同一句话）。
// 档位：打开 30 分钟 / 5 小时 / 4 天前；修改 1 小时 / 2 天 / 10 天前。
// 排序序与共享 PROJECTS 同构：打开 p2,p1,p3 ｜ 修改 p3,p1,p2 ｜ 数量 p2,p3,p1 ｜ 名称 p2,p3,p1。
const T = Date.now();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const TIME_PROJECTS = [
  makeProject('p1', 'Zulu', T - 5 * HOUR, [T - 2 * DAY]),
  makeProject('p2', 'Alpha', T - 30 * MIN, [T - 10 * DAY]),
  makeProject('p3', 'Mike', T - 4 * DAY, [T - 1 * HOUR]),
];

beforeEach(() => {
  seedZhSettings();
});

function renderHub(projects: ChartProject[] = PROJECTS) {
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

/** 某张卡片的副行（歌手 · 标签 时间） */
function cardSubline(id: string): HTMLElement {
  const sub = document.querySelector<HTMLElement>(`.pb-card[data-project-id="${id}"] small.pp-muted`);
  if (!sub) throw new Error(`card ${id} 的副行不在 DOM 里`);
  return sub;
}

/** hero 的元信息行（歌手 · 上次打开/上次修改 时间） */
function heroMeta(): HTMLElement {
  const p = document.querySelector<HTMLElement>('.pb-hero__body p.pp-muted');
  if (!p) throw new Error('hero 元信息行不在 DOM 里');
  return p;
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
    // 非时间键不改 resume 语义（issue 19 #4 定案，issue 40 定案 A 沿用）：横幅回落最近打开
    expect(heroName()).toHaveTextContent('Alpha');
  });

  it('启动时读回设置对象里的排序：seed「最近修改」→ 首屏即按它排', async () => {
    seedZhSettings({ projects: { sort: 'lastModified' } });
    renderHub();

    await waitFor(() => expect(cardOrder()).toEqual(['p3', 'p1', 'p2']));
    expect(sortSelect().value).toBe('lastModified');
    // issue 40 定案 A：时间键下横幅 = 该键的头——最近修改 → p3（Mike）
    expect(heroName()).toHaveTextContent('Mike');
  });
});

// issue 37：列表时间戳跟随排序键。期望文案用 relTime(时间戳, Date.now()) 现算——
// 共享 ticker 的 now 取渲染时刻，与断言时刻只差毫秒级，floor 到档位后同一句；
// 不用假计时器（本仓实测 waitFor 在假计时器下会挂死，见 OfficialPickerPreview 注释）。
describe('issue 37 · 列表时间戳跟随排序键', () => {
  it('seed「最近修改」：卡片显示派生修改时间，且带「修改」短标签', async () => {
    seedZhSettings({ projects: { sort: 'lastModified' } });
    renderHub(TIME_PROJECTS);
    await screen.findByText('全部工程');
    await waitFor(() => expect(cardOrder()).toEqual(['p3', 'p1', 'p2']));

    // p1 打开于 5 小时前、谱面改于 2 天前：顺序按修改排，眼睛看到的也必须是修改时间
    expect(cardSubline('p1')).toHaveTextContent(`修改 ${relTime(T - 2 * DAY, Date.now())}`);
    expect(cardSubline('p3')).toHaveTextContent(`修改 ${relTime(T - HOUR, Date.now())}`);
    // 打开时间不许出现在副行里（错位复发的形状）
    expect(cardSubline('p1')).not.toHaveTextContent(relTime(T - 5 * HOUR, Date.now()));
  });

  it('默认「最近打开」：卡片显示 lastOpened，且带「打开」短标签', async () => {
    renderHub(TIME_PROJECTS);
    await screen.findByText('全部工程');
    await waitFor(() => expect(cardOrder()).toEqual(['p2', 'p1', 'p3']));

    expect(cardSubline('p1')).toHaveTextContent(`打开 ${relTime(T - 5 * HOUR, Date.now())}`);
    expect(cardSubline('p2')).toHaveTextContent(`打开 ${relTime(T - 30 * MIN, Date.now())}`);
  });

  it('hero 标签与展示工程都随排序切换：上次打开 / 上次修改（issue 40）', async () => {
    renderHub(TIME_PROJECTS);
    await screen.findByText('全部工程');
    await waitFor(() => expect(cardOrder()).toEqual(['p2', 'p1', 'p3']));

    // 默认键：hero = 最近打开的 p2，标签「上次打开」+ 它的打开时间
    expect(heroName()).toHaveTextContent('Alpha');
    expect(heroMeta()).toHaveTextContent(`上次打开 ${relTime(T - 30 * MIN, Date.now())}`);

    fireEvent.change(sortSelect(), { target: { value: 'lastModified' } });

    await waitFor(() => expect(cardOrder()).toEqual(['p3', 'p1', 'p2']));
    // issue 40 定案 A：锚随排序走——hero 换成修改序的头 p3，标签与时间都是它的修改口径
    expect(heroName()).toHaveTextContent('Mike');
    expect(heroMeta()).toHaveTextContent(`上次修改 ${relTime(T - 1 * HOUR, Date.now())}`);
  });
});
