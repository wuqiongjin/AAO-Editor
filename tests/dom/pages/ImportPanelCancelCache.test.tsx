// @vitest-environment jsdom
// 票 57：首次打开官方 / 社区导入面板时，等待 >= 2s 且本地磁盘有完整缓存才在 .off-blank 下方显示「取消」按钮；
// 点击「取消」立即中止在途拉取、切换到上次缓存结果、弹出 warn Toast，并在本会话内重开秒开。
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { ConfigProvider } from '@/src/app/providers/ConfigProvider';
import { AppNavProvider, type PageId } from '@/src/layouts/AppNav';
import ProjectsPage from '@/src/pages/projects/ProjectsPage';
import { ChartProjectStore } from '@/src/project/ChartProject';
import { clearSongCatalogCache } from '@/src/community/bestdori/songs';
import { clearPostPageCache } from '@/src/community/bestdori/posts';
import ToastHost from '@/src/ui/Toast';
import { installIntersectionObserverStub } from '@/tests/support/intersection';
import { makeMemoryProjectBackend, renderWithProviders } from '@/tests/support/providers';
import { seedZhSettings } from '@/tests/support/storage';

const SONGS_INDEX = {
  '29': {
    tag: 'normal',
    bandId: 5,
    jacketImage: ['blackshout'],
    musicTitle: ['BLACK SHOUT', 'BLACK SHOUT', 'BLACK SHOUT', 'BLACK SHOUT', 'BLACK SHOUT'],
    publishedAt: ['1462071600000', '1462104000000', '1507003200000', '1462075200000', '1462071600000'],
    difficulty: { 3: { playLevel: 25 } },
  },
};

const BANDS_INDEX = {
  '5': { bandName: ['Roselia', 'Roselia', 'Roselia', 'Roselia', 'Roselia'] },
};

const POSTS_PAGE = {
  result: true,
  count: 1,
  posts: [
    {
      id: 248468,
      categoryId: 'chart',
      categoryName: 'SELF_POST',
      title: 'Cached Community Chart',
      time: 1700000000000,
      author: { username: 'charter', nickname: 'Charter' },
      artists: 'Artist',
      diff: 3,
      level: 25,
      song: { type: 'custom', audio: 'https://bestdori.com/api/upload/file/aaa' },
    },
  ],
};

type ReqPayload = { url: string; responseType?: string; cacheOnly?: boolean; requestId?: string };

function setupEnv(opts: { hasSongs?: boolean; hasBands?: boolean; hasPostPage?: boolean }) {
  const cancelledIds: string[] = [];
  let resolveLiveSongs: ((v: unknown) => void) | null = null;
  let resolveLivePosts: ((v: unknown) => void) | null = null;

  const request = vi.fn((payload: ReqPayload) => {
    if (payload.cacheOnly) {
      if (payload.url.endsWith('/api/songs/all.5.json')) {
        return Promise.resolve(opts.hasSongs ? { ok: true, responseType: 'json', status: 200, data: SONGS_INDEX, fromCache: true } : { ok: false, error: { kind: 'cache-miss', message: 'miss' } });
      }
      if (payload.url.endsWith('/api/bands/all.1.json')) {
        return Promise.resolve(opts.hasBands ? { ok: true, responseType: 'json', status: 200, data: BANDS_INDEX, fromCache: true } : { ok: false, error: { kind: 'cache-miss', message: 'miss' } });
      }
      if (payload.url.endsWith('/api/post/list')) {
        return Promise.resolve(opts.hasPostPage ? { ok: true, responseType: 'json', status: 200, data: POSTS_PAGE, fromCache: true } : { ok: false, error: { kind: 'cache-miss', message: 'miss' } });
      }
      return Promise.resolve({ ok: false, error: { kind: 'cache-miss', message: 'miss' } });
    }

    if (payload.url.endsWith('/api/songs/all.5.json')) {
      return new Promise((resolve) => { resolveLiveSongs = resolve; });
    }
    if (payload.url.endsWith('/api/bands/all.1.json')) {
      return new Promise(() => {});
    }
    if (payload.url.endsWith('/api/post/list')) {
      return new Promise((resolve) => { resolveLivePosts = resolve; });
    }
    return Promise.resolve({ ok: false, error: { kind: 'invalid-response', message: 'unexpected' } });
  });

  const cancel = vi.fn((requestId: string) => {
    cancelledIds.push(requestId);
  });

  (window as unknown as { electronAPI: unknown }).electronAPI = {
    communityNet: { request, cancel },
  };

  return {
    request,
    cancel,
    cancelledIds,
    resolveLiveSongs: (v: unknown) => resolveLiveSongs?.(v),
    resolveLivePosts: (v: unknown) => resolveLivePosts?.(v),
  };
}

const navValue = {
  activePage: 'projects' as PageId,
  setActivePage: () => {},
  pageScope: null,
  navCollapsed: true,
  setNavCollapsed: () => {},
};

function renderProjects() {
  const store = new ChartProjectStore(makeMemoryProjectBackend([]));
  return renderWithProviders(
    <ConfigProvider>
      <AppNavProvider value={navValue}>
        <ProjectsPage />
        <ToastHost />
      </AppNavProvider>
    </ConfigProvider>,
    { store },
  );
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
}

async function openSourceDialog(label: RegExp) {
  await screen.findByText('全部工程');
  fireEvent.click(screen.getByRole('button', { name: /空白新建/ }));
  const dialog = await screen.findByRole('dialog');
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  fireEvent.click(within(dialog).getByRole('button', { name: label }));
  await flush();
  return dialog;
}

describe('票 57 · 首次打开导入面板有缓存时允许取消主动拉取', () => {
  beforeEach(() => {
    seedZhSettings();
    clearSongCatalogCache();
    clearPostPageCache();
    installIntersectionObserverStub();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearSongCatalogCache();
    clearPostPageCache();
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    vi.restoreAllMocks();
  });

  it('官方面板无完整磁盘缓存（缺任一份或全无）时，等再久也不显示取消按钮', async () => {
    setupEnv({ hasSongs: true, hasBands: false });
    renderProjects();
    const dialog = await openSourceDialog(/从官方谱面导入/);

    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    await flush();
    expect(within(dialog).getByText('正在拉取官方曲库')).toBeInTheDocument();
    expect(dialog.querySelector('.off-blank .off-blank__cancel')).toBeNull();
  });

  it('官方面板等待 >= 2s 且两份索引都有缓存：出现取消按钮，点击立即切缓存 + warn Toast + 中止请求 + 重开秒出', async () => {
    const env = setupEnv({ hasSongs: true, hasBands: true });
    renderProjects();
    let dialog = await openSourceDialog(/从官方谱面导入/);

    await act(async () => { await vi.advanceTimersByTimeAsync(1999); });
    await flush();
    expect(dialog.querySelector('.off-blank .off-blank__cancel')).toBeNull();

    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    await flush();
    const cancelBtn = within(dialog.querySelector('.off-blank') as HTMLElement).getByRole('button', { name: '取消' });
    expect(cancelBtn).toBeInTheDocument();

    fireEvent.click(cancelBtn);
    await flush();
    expect(within(dialog).getByText('BLACK SHOUT')).toBeInTheDocument();
    expect(env.cancel).toHaveBeenCalled();
    expect(screen.getByText('已取消拉取，使用上次拉取结果')).toBeInTheDocument();

    // 迟到的旧响应不再覆盖列表或重弹 Toast
    await act(async () => {
      env.resolveLiveSongs({
        ok: true,
        responseType: 'json',
        status: 200,
        data: { '99': { ...SONGS_INDEX['29'], musicTitle: ['LATE SONG'] } },
      });
    });
    await flush();
    expect(within(dialog).queryByText('LATE SONG')).toBeNull();
    expect(within(dialog).getByText('BLACK SHOUT')).toBeInTheDocument();
    expect(screen.getAllByText('已取消拉取，使用上次拉取结果')).toHaveLength(1);

    // 关闭弹窗再重新打开官方面板：同会话直接秒开
    fireEvent.click(within(dialog.querySelector('.dialog__foot') as HTMLElement).getByRole('button', { name: '取消' }));
    vi.useRealTimers();
    dialog = await openSourceDialog(/从官方谱面导入/);
    expect(within(dialog).getByText('BLACK SHOUT')).toBeInTheDocument();
  });

  it('社区面板无第 0 页缓存时不显示取消；有第 0 页缓存等待 >= 2s 可取消并秒开复用', async () => {
    const missEnv = setupEnv({ hasPostPage: false });
    const { unmount } = renderProjects();
    let dialog = await openSourceDialog(/从社区谱面导入/);

    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    await flush();
    expect(dialog.querySelector('.off-blank .off-blank__cancel')).toBeNull();
    expect(missEnv.cancel).not.toHaveBeenCalled();
    unmount();
    vi.useRealTimers();

    clearSongCatalogCache();
    clearPostPageCache();
    const hitEnv = setupEnv({ hasPostPage: true });
    renderProjects();
    dialog = await openSourceDialog(/从社区谱面导入/);

    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    await flush();
    const cancelBtn = within(dialog.querySelector('.off-blank') as HTMLElement).getByRole('button', { name: '取消' });
    fireEvent.click(cancelBtn);
    await flush();

    expect(within(dialog).getByText('Cached Community Chart')).toBeInTheDocument();
    expect(hitEnv.cancel).toHaveBeenCalled();
    expect(screen.getByText('已取消拉取，使用上次拉取结果')).toBeInTheDocument();

    await act(async () => {
      hitEnv.resolveLivePosts({
        ok: true,
        responseType: 'json',
        status: 200,
        data: { result: true, count: 1, posts: [{ ...POSTS_PAGE.posts[0], id: 999, title: 'Late Live Post' }] },
      });
    });
    await flush();
    expect(within(dialog).queryByText('Late Live Post')).toBeNull();

    fireEvent.click(within(dialog.querySelector('.dialog__foot') as HTMLElement).getByRole('button', { name: '取消' }));
    vi.useRealTimers();
    dialog = await openSourceDialog(/从社区谱面导入/);
    expect(within(dialog).getByText('Cached Community Chart')).toBeInTheDocument();
  });
});
