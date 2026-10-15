// @vitest-environment jsdom
// 票 41：发布入口灰化说明 + 未登录点发布续上确认。
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ConfigProvider } from '@/src/app/providers/ConfigProvider';
import { AppNavProvider, type AppNavValue } from '@/src/layouts/AppNav';
import ProjectsPage from '@/src/pages/projects/ProjectsPage';
import { resetCommunityAccount } from '@/src/community/bestdori/account';
import { userLoginUrl, userMeUrl } from '@/src/community/bestdori/endpoints';
import type { CommunityRequest, CommunityWireResult } from '@/src/community/transport';
import { ChartProjectStore, type ChartProject, type ProjectChart } from '@/src/project/ChartProject';
import { makeMemoryProjectBackend, renderWithProviders } from '@/tests/support/providers';
import { seedZhSettings } from '@/tests/support/storage';

const AT = 1_700_000_000_000;
const LOGIN_URL = userLoginUrl();
const ME_URL = userMeUrl();

function chart(id: string): ProjectChart {
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

function project(id: string, name: string): ChartProject {
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
  };
}

const okJson = (data: unknown): CommunityWireResult => ({ ok: true, responseType: 'json', status: 200, data });

function installBridges() {
  (window as unknown as { electronAPI?: unknown }).electronAPI = {
    communitySession: {
      restore: async () => ({ restored: false }),
      persist: async () => ({ persisted: true }),
      clear: async () => true,
    },
    shell: { openExternal: async () => true },
    communityNet: {
      request: async (req: CommunityRequest): Promise<CommunityWireResult> => {
        if (req.url === LOGIN_URL) return okJson({ result: true });
        if (req.url === ME_URL) return okJson({ result: true, username: 'envy09', nickname: 'Envy' });
        throw new Error(`未打桩的请求: ${req.url}`);
      },
    },
  };
}

const setActivePage = vi.fn();

function renderPage() {
  const nav: AppNavValue = {
    activePage: 'projects',
    setActivePage: setActivePage as unknown as AppNavValue['setActivePage'],
    pageScope: null,
    navCollapsed: true,
    setNavCollapsed: () => {},
  };
  return renderWithProviders(
    <ConfigProvider>
      <AppNavProvider value={nav}><ProjectsPage /></AppNavProvider>
    </ConfigProvider>,
    { store: new ChartProjectStore(makeMemoryProjectBackend([project('p1', '甲工程')])) },
  );
}

async function enterDetail() {
  renderPage();
  await screen.findByText('全部工程');
  fireEvent.click(within(document.querySelector('.pb-grid') as HTMLElement).getByText('甲工程'));
  await waitFor(() => expect(document.querySelector('.pc-account')).not.toBeNull());
}

beforeEach(() => {
  seedZhSettings();
  setActivePage.mockClear();
});

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  resetCommunityAccount();
  vi.restoreAllMocks();
});

describe('票 41 · 发布灰化与登录续上', () => {
  it('未登录：列表上方没有「登录后可发布谱面」；点发布开登录，成功后续上确认且能看见身份', async () => {
    installBridges();
    resetCommunityAccount();
    await enterDetail();

    expect(screen.queryByText('登录后可发布谱面')).toBeNull();
    const publish = screen.getByRole('button', { name: '发布' });
    expect(publish).toHaveAttribute('aria-disabled', 'true');
    expect(publish).toHaveAttribute('title', '登录后可发布谱面');
    expect(publish).not.toBeDisabled();

    fireEvent.click(publish);
    const signIn = await screen.findByRole('dialog');
    fireEvent.change(within(signIn).getByLabelText('账号'), { target: { value: 'envy09' } });
    fireEvent.change(within(signIn).getByLabelText('密码'), { target: { value: 'hunter2' } });
    fireEvent.click(within(signIn).getByRole('button', { name: '登录' }));

    const publishDialog = await screen.findByRole('dialog', { name: /发布谱面/ });
    expect(within(publishDialog).getByTitle('账号：envy09')).toBeInTheDocument();
    expect(within(publishDialog).getByText('E')).toBeInTheDocument();
  });
});
