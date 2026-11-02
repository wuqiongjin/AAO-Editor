// @vitest-environment jsdom
// issue 209：工作台顶栏谱面工程与谱面切换器样式与自适应优化（crumb title 与下拉箭头旋转）。
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent } from '@testing-library/react';
import ChartSwitcher from '@/src/pages/workspace/ChartSwitcher';
import { AppNavProvider, type AppNavValue } from '@/src/layouts/AppNav';
import {
  useCurrentProject,
  type CurrentProjectContextValue,
} from '@/src/app/providers/CurrentProjectProvider';
import { ChartProjectStore, type ChartProject, type ProjectChart } from '@/src/project/ChartProject';
import { makeMemoryProjectBackend, renderWithProviders } from '@/tests/support/providers';

const AT = 1_700_000_000_000;

function chart(id: string, title: string | null = '测试谱面'): ProjectChart {
  return {
    id, notes: [{ beat: 0, type: 'BPM', bpm: 120 }], title, diff: 3, level: 27,
    completed: false, upload: null, lastModified: AT, appliedChartCodeText: null, chartCodePristine: false,
  };
}

function project(name = '甲工程 · 完整超长标题示例'): ChartProject {
  return {
    id: 'p1', name, artist: null, source: { type: 'custom' }, durationSeconds: 90, lastOpened: AT,
    charts: [chart('c-p1', '测试谱面')], audioName: 'a.mp3', coverName: null,
  };
}

let ctx: { current: CurrentProjectContextValue | null };

beforeEach(() => {
  window.localStorage.clear();
  ctx = { current: null };
});

function Probe() {
  ctx.current = useCurrentProject();
  return null;
}

async function mount(projectName = '甲工程 · 完整超长标题示例') {
  const nav: AppNavValue = {
    activePage: 'workspace',
    setActivePage: vi.fn() as unknown as AppNavValue['setActivePage'],
    pageScope: null,
    navCollapsed: true,
    setNavCollapsed: () => {},
  };
  renderWithProviders(
    <AppNavProvider value={nav}>
      <Probe />
      <ChartSwitcher />
    </AppNavProvider>,
    { store: new ChartProjectStore(makeMemoryProjectBackend([project(projectName)])) },
  );
  await act(async () => { await ctx.current!.open('p1'); });
}

describe('issue 209 · 工作台顶栏切换器视觉与动效', () => {
  it('工程名 crumb 呈现专用 crumb-name，title 携带完整工程名与回工程管理页', async () => {
    await mount('Retribution ~ Cycle of Redemption');

    const crumb = document.querySelector('.chart-switcher__crumb') as HTMLElement;
    expect(crumb).toBeInTheDocument();
    expect(crumb.getAttribute('title')).toBe('Retribution ~ Cycle of Redemption · 回工程管理页');

    const crumbName = crumb.querySelector('.chart-switcher__crumb-name');
    expect(crumbName).toBeInTheDocument();
    expect(crumbName).toHaveTextContent('Retribution ~ Cycle of Redemption');
  });

  it('下拉箭头初始无 is-open，点击打开后带 is-open，再次点击或点击蒙层关闭后类名撤除', async () => {
    await mount();

    const trigger = document.querySelector('.chart-switcher__current') as HTMLElement;
    const caret = trigger.querySelector('.chart-switcher__caret');
    expect(caret).toBeInTheDocument();
    expect(caret).not.toHaveClass('is-open');

    // 点击打开
    fireEvent.click(trigger);
    expect(caret).toHaveClass('is-open');

    // 再次点击关闭
    fireEvent.click(trigger);
    expect(caret).not.toHaveClass('is-open');

    // 再次打开并通过点击 scrim 关闭
    fireEvent.click(trigger);
    expect(caret).toHaveClass('is-open');
    const scrim = document.querySelector('.pp-menu__scrim') as HTMLElement;
    expect(scrim).toBeInTheDocument();
    fireEvent.click(scrim);
    expect(caret).not.toHaveClass('is-open');
  });
});
