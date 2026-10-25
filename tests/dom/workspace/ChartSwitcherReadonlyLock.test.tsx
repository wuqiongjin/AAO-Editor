// @vitest-environment jsdom
// issue 175：已上传谱面顶栏只留锁图标，复制走下拉与改谱浮条。
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import ChartSwitcher from '@/src/pages/workspace/ChartSwitcher';
import { AppNavProvider, type AppNavValue } from '@/src/layouts/AppNav';
import {
  useCurrentProject,
  type CurrentProjectContextValue,
} from '@/src/app/providers/CurrentProjectProvider';
import { ChartProjectStore, type ChartProject, type ProjectChart } from '@/src/project/ChartProject';
import { makeMemoryProjectBackend, renderWithProviders } from '@/tests/support/providers';

const AT = 1_700_000_000_000;

function chart(id: string, upload: ProjectChart['upload'], title: string | null): ProjectChart {
  return {
    id, notes: [{ beat: 0, type: 'BPM', bpm: 120 }], title, diff: 3, level: 27,
    completed: false, upload, lastModified: AT, appliedChartCodeText: null, chartCodePristine: false,
  };
}

function project(upload: ProjectChart['upload'], title: string | null = '测试谱面'): ChartProject {
  return {
    id: 'p1', name: '甲工程', artist: null, source: { type: 'custom' }, durationSeconds: 90, lastOpened: AT,
    charts: [chart('c-p1', upload, title)], audioName: 'a.mp3', coverName: null,
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

async function mount(upload: ProjectChart['upload'], title: string | null = '测试谱面') {
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
    { store: new ChartProjectStore(makeMemoryProjectBackend([project(upload, title)])) },
  );
  await act(async () => { await ctx.current!.open('p1'); });
}

describe('issue 175 · 工作台顶栏只读锁', () => {
  it('已上传：顶栏无芯片复制键，当前钮带锁，下拉仍有复制当前谱面', async () => {
    await mount({ postId: 7, at: AT });

    expect(screen.queryByRole('button', { name: '复制这张谱面来改' })).not.toBeInTheDocument();
    expect(document.querySelector('.chart-switcher__readonly')).not.toBeInTheDocument();
    const trigger = document.querySelector('.chart-switcher__current') as HTMLElement;
    expect(trigger.querySelector('.chart-switcher__lock')).toBeInTheDocument();
    expect(trigger.getAttribute('title')).toBe('测试谱面 · 已上传 · 只读');

    fireEvent.click(trigger);
    expect(await screen.findByRole('button', { name: /复制当前谱面/ })).toBeInTheDocument();
  });

  it('未上传：当前钮没有锁，title 只要谱面名', async () => {
    await mount(null);
    const trigger = document.querySelector('.chart-switcher__current') as HTMLElement;
    expect(trigger.querySelector('.chart-switcher__lock')).not.toBeInTheDocument();
    expect(trigger.getAttribute('title')).toBe('测试谱面');
  });

  it('空谱面名回落工程名，title 不含色块短码', async () => {
    await mount(null, null);
    const trigger = document.querySelector('.chart-switcher__current') as HTMLElement;
    expect(trigger.querySelector('.chart-switcher__current-name')).toHaveTextContent('甲工程');
    expect(trigger.getAttribute('title')).toBe('甲工程');
    expect(trigger.querySelector('.pp-pill__diff')?.textContent ?? '').toMatch(/^EX/);
  });
});
