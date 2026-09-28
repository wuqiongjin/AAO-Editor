// @vitest-environment jsdom
// 票 15 定案 5：工作台谱面切换器菜单里的「管理音频」——把"我要管这个工程的音频"这个
// 念头落在工作台里（进工作台的入口 + 左栏「音频」之外，工作台自己给一条直达）。
//
// 不带 scope：与左栏「音频」同义（= 当前工程的音频页），"当前"这个词在这里不产生歧义。
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import ChartSwitcher from '@/src/pages/WorkspacePage/ChartSwitcher';
import { AppNavProvider, type AppNavValue } from '@/src/layouts/AppNav';
import {
  useCurrentProject,
  type CurrentProjectContextValue,
} from '@/src/app/providers/CurrentProjectProvider';
import { ChartProjectStore, type ChartProject, type ProjectChart } from '@/src/chart/project/ChartProject';
import { makeMemoryProjectBackend, renderWithProviders } from '@/tests/support/providers';

const AT = 1_700_000_000_000;

function chart(id: string): ProjectChart {
  return {
    id, notes: [{ beat: 0, type: 'BPM', bpm: 120 }], title: '测试谱面', diff: 3, level: 27,
    completed: false, upload: null, lastModified: AT, appliedChartCodeText: null, chartCodePristine: false,
  };
}

function project(id: string, name: string): ChartProject {
  return {
    id, name, artist: null, source: { type: 'custom' }, durationSeconds: 90, lastOpened: AT,
    charts: [chart(`c-${id}`)], audioName: 'a.mp3', coverName: null,
  };
}

let setActivePage: ReturnType<typeof vi.fn>;
let ctx: { current: CurrentProjectContextValue | null };

beforeEach(() => {
  window.localStorage.clear();
  setActivePage = vi.fn();
  ctx = { current: null };
});

function Probe() {
  ctx.current = useCurrentProject();
  return null;
}

async function mountSwitcher() {
  const nav: AppNavValue = {
    activePage: 'workspace',
    setActivePage: setActivePage as unknown as AppNavValue['setActivePage'],
    pageScope: null,
    navCollapsed: true,
    setNavCollapsed: () => {},
  };
  renderWithProviders(
    <AppNavProvider value={nav}>
      <Probe />
      <ChartSwitcher />
    </AppNavProvider>,
    { store: new ChartProjectStore(makeMemoryProjectBackend([project('p1', '甲工程')])) },
  );
  await act(async () => { await ctx.current!.open('p1'); });
}

/** 菜单触发钮（.chart-switcher__current）——它没有可访问名，按结构取 */
const menuTrigger = () => document.querySelector('.chart-switcher__current') as HTMLElement;

describe('票 15 · 工作台里的音频管理入口', () => {
  it('切换器菜单里有「管理音频」，点了去音频页（当前工程的音频页）', async () => {
    await mountSwitcher();

    fireEvent.click(menuTrigger());

    const entry = await screen.findByRole('button', { name: /管理音频/ });
    fireEvent.click(entry);

    expect(setActivePage).toHaveBeenCalledWith('audio');
  });

  it('它和「回工程管理页」并列在工程级动作组里（不是谱面级动作）', async () => {
    await mountSwitcher();
    fireEvent.click(menuTrigger());

    const entry = await screen.findByRole('button', { name: /管理音频/ });
    const back = screen.getByRole('button', { name: /回工程管理页/ });
    // 两者在同一个菜单面板内，且顺序：管理音频在前
    const panel = document.querySelector('.chart-switcher__panel') as HTMLElement;
    expect(panel).toContainElement(entry);
    expect(panel).toContainElement(back);
    expect(entry.compareDocumentPosition(back) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
