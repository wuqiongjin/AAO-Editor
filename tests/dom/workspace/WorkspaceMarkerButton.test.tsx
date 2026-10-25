// @vitest-environment jsdom
// issue 179 锁测：播放起点按钮挂在工作台播放条时间码旁，受 settings.playbar.markerButton 控制
import '@testing-library/jest-dom/vitest';
import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, within } from '@testing-library/react';
import { AppNavProvider, type AppNavValue } from '@/src/layouts/AppNav';
import { ProviderTree, usePlayback } from '@/src/app/ProviderTree';
import WorkspacePage from '@/src/pages/workspace/WorkspacePage';
import { seedZhSettings } from '@/tests/support/storage';
import { stubPageShellEnv } from '@/tests/support/domEnv';

stubPageShellEnv();

const mockNav: AppNavValue = {
  activePage: 'workspace',
  setActivePage: vi.fn(),
  pageScope: null,
  navCollapsed: false,
  setNavCollapsed: vi.fn(),
};

function SetMarker({ seconds }: { seconds: number }) {
  const { setMarker } = usePlayback();
  useEffect(() => { setMarker(seconds); }, [setMarker, seconds]);
  return null;
}

function renderWorkspace() {
  return render(
    <AppNavProvider value={mockNav}>
      <ProviderTree>
        <WorkspacePage />
        <SetMarker seconds={4} />
      </ProviderTree>
    </AppNavProvider>,
  );
}

const playBar = () => document.querySelector('.play-bar') as HTMLElement;
const markerBtn = () => within(playBar()).queryByRole('button', { name: '跳转到播放起点并播放' });

describe('issue 179 · 工作台播放条的播放起点按钮', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('设了起点 → 按钮出现在播放条里、紧跟时间码', async () => {
    seedZhSettings();
    renderWorkspace();
    const btn = await within(playBar()).findByRole('button', { name: '跳转到播放起点并播放' });
    expect(playBar().querySelector('.play-bar__time')?.nextElementSibling).toBe(btn);
  });

  it('显示设置里关掉开关 → 不渲染', async () => {
    seedZhSettings({ playbar: { markerButton: false } });
    renderWorkspace();
    await new Promise((r) => setTimeout(r, 0));
    expect(markerBtn()).not.toBeInTheDocument();
  });
});
