// @vitest-environment jsdom
// issue 23 #2：左栏分隔条的拖拽与复位（规格 L69 点名的那条 DOM 锁测）。
//
// 这里能测的是**数据流**：按下 → 指针移动 → 宽度按位移增量写进 settings；
// 到边界夹住；双击复位默认值。**测不了的**：真实命中区手感、拖动时的光标与高亮观感
// —— jsdom 无布局引擎（`getBoundingClientRect` 全 0），走票内的真渲染截图 + 人工门票。
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ConfigProvider } from '@/src/app/providers/ConfigProvider';
import { AppNavProvider, type PageId } from '@/src/layouts/AppNav';
import ProjectsPage from '@/src/pages/projects/ProjectsPage';
import { ChartProjectStore, type ChartProject, type ProjectChart } from '@/src/project/ChartProject';
import { PROJECT_LIST_WIDTH, loadSettings } from '@/src/chart/config/AppSettings';
import { makeMemoryProjectBackend, renderWithProviders } from '@/tests/support/providers';
import { seedZhSettings, SETTINGS_KEY } from '@/tests/support/storage';

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

function renderDetail() {
  const result = renderWithProviders(
    <ConfigProvider>
      <AppNavProvider value={navValue}><ProjectsPage /></AppNavProvider>
    </ConfigProvider>,
    { store: new ChartProjectStore(makeMemoryProjectBackend(PROJECTS)) },
  );
  return result;
}

async function openDetail() {
  await screen.findByText('全部工程');
  fireEvent.click(document.querySelector('.pb-card') as HTMLElement);
  await screen.findByRole('heading', { name: '甲工程' });
}

/** 已落盘的左栏宽度（settings 的持久层是唯一权威） */
function persistedWidth(): number {
  return loadSettings(localStorage as unknown as Storage).layout.projectList.width;
}

/** 分隔条当前渲染出的宽度（内联 --pc-list-w） */
function renderedWidth(): number {
  const el = document.querySelector('.pc-page') as HTMLElement | null;
  const inline = el?.getAttribute('style') ?? '';
  return Number(inline.match(/--pc-list-w:\s*(\d+)px/)?.[1]);
}

function splitEl(): HTMLElement {
  const el = document.querySelector('.pc-split');
  expect(el, '分隔条没渲染出来').toBeTruthy();
  return el as HTMLElement;
}

describe('issue 23 #2 · 左栏分隔条拖拽与复位', () => {
  it('分隔条是 separator 语义，且带着当前宽度与夹取区间', async () => {
    renderDetail();
    await openDetail();

    const el = splitEl();
    expect(el).toHaveAttribute('role', 'separator');
    expect(el).toHaveAttribute('aria-orientation', 'vertical');
    expect(el).toHaveAttribute('aria-valuenow', String(PROJECT_LIST_WIDTH.default));
    expect(el).toHaveAttribute('aria-valuemin', String(PROJECT_LIST_WIDTH.min));
    expect(el).toHaveAttribute('aria-valuemax', String(PROJECT_LIST_WIDTH.max));
  });

  it('向右拖 → 宽度按位移增量变大，并立即落盘', async () => {
    renderDetail();
    await openDetail();

    fireEvent.pointerDown(splitEl(), { clientX: 300 });
    fireEvent.pointerMove(document, { clientX: 380 });
    fireEvent.pointerUp(document, { clientX: 380 });

    await waitFor(() => expect(persistedWidth()).toBe(380));
    expect(renderedWidth()).toBe(380);
  });

  it('向左拖 → 宽度变小', async () => {
    renderDetail();
    await openDetail();

    fireEvent.pointerDown(splitEl(), { clientX: 300 });
    fireEvent.pointerMove(document, { clientX: 250 });
    fireEvent.pointerUp(document, { clientX: 250 });

    await waitFor(() => expect(persistedWidth()).toBe(250));
  });

  it('拖过下限 / 上限 → 夹在区间端点，不会拖没', async () => {
    renderDetail();
    await openDetail();

    // 一路拖到远处：期望停在 max，而不是跟着指针无限变宽
    fireEvent.pointerDown(splitEl(), { clientX: 300 });
    fireEvent.pointerMove(document, { clientX: 9999 });
    fireEvent.pointerUp(document, { clientX: 9999 });
    await waitFor(() => expect(persistedWidth()).toBe(PROJECT_LIST_WIDTH.max));

    // 再反向拖穿：停在 min
    fireEvent.pointerDown(splitEl(), { clientX: 300 });
    fireEvent.pointerMove(document, { clientX: -9999 });
    fireEvent.pointerUp(document, { clientX: -9999 });
    await waitFor(() => expect(persistedWidth()).toBe(PROJECT_LIST_WIDTH.min));
  });

  it('指针抬起后不再跟随移动（拖拽已结束）', async () => {
    renderDetail();
    await openDetail();

    fireEvent.pointerDown(splitEl(), { clientX: 300 });
    fireEvent.pointerMove(document, { clientX: 350 });
    fireEvent.pointerUp(document, { clientX: 350 });
    await waitFor(() => expect(persistedWidth()).toBe(350));

    fireEvent.pointerMove(document, { clientX: 500 });
    expect(persistedWidth()).toBe(350);
  });

  it('双击复位到默认宽度', async () => {
    renderDetail();
    await openDetail();

    fireEvent.pointerDown(splitEl(), { clientX: 300 });
    fireEvent.pointerMove(document, { clientX: 410 });
    fireEvent.pointerUp(document, { clientX: 410 });
    await waitFor(() => expect(persistedWidth()).toBe(410));

    fireEvent.doubleClick(splitEl());
    await waitFor(() => expect(persistedWidth()).toBe(PROJECT_LIST_WIDTH.default));
    expect(renderedWidth()).toBe(PROJECT_LIST_WIDTH.default);
  });

  it('宽度跨会话沿用：旧设置里的宽度直接生效', async () => {
    // 预置一份已经拖过宽度的旧设置（模拟上次会话留下的）
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      schemaVersion: 1, uiLanguage: 'zh-CN', layout: { projectList: { width: 372 } },
    }));
    renderDetail();
    await openDetail();

    expect(renderedWidth()).toBe(372);
    expect(splitEl()).toHaveAttribute('aria-valuenow', '372');
  });
});
