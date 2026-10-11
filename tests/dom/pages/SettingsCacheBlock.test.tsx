// @vitest-environment jsdom
// 票 14：设置页「存储与数据」里的「社区素材缓存」块 —— 占用展示 + 清除。
// 锁界面接线：桥在 → 数字来自主进程 IPC、清除后归零；桥不在（静态演示版）→ 整块不出现。
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ConfigProvider } from '@/src/app/providers/ConfigProvider';
import SettingsPage from '@/src/pages/settings/SettingsPage';
import { renderWithProviders } from '@/tests/support/providers';
import { stubPageShellEnv } from '@/tests/support/domEnv';
import { seedZhSettings } from '@/tests/support/storage';

const MB = 1024 * 1024;
const DAY = 24 * 60 * 60 * 1000;

interface CacheStatsFixture {
  totalBytes: number;
  count: number;
  byKind: Record<string, { bytes: number; count: number }>;
}

function installCacheBridge(
  stats: CacheStatsFixture = {
    totalBytes: 5 * MB,
    count: 3,
    byKind: { json: { bytes: MB, count: 1 }, binary: { bytes: 4 * MB, count: 2 } },
  },
  cleared: { freedBytes: number } = { freedBytes: 5 * MB },
) {
  const statsFn = vi.fn(async () => stats);
  const clearFn = vi.fn(async () => cleared);
  const configureFn = vi.fn(async () => ({ maxAgeMs: 0, maxBytes: 0 }));
  const current = (window as unknown as { electronAPI?: Record<string, unknown> }).electronAPI ?? {};
  (window as unknown as { electronAPI?: unknown }).electronAPI = {
    ...current,
    assetCache: { stats: statsFn, clear: clearFn, configure: configureFn },
  };
  return { statsFn, clearFn, configureFn };
}

interface DataRootFixture {
  path: string;
}

function installDataRootBridge(
  data: DataRootFixture = { path: 'D:\\music\\bangdream-data' },
) {
  const getFn = vi.fn(async () => ({ path: data.path }));
  const openFn = vi.fn(async () => ({ ok: true, path: data.path }));
  const changeFn = vi.fn(async () => ({ ok: true, path: data.path }));
  const claimFn = vi.fn(async () => ({ ok: true, path: data.path }));

  const current = (window as unknown as { electronAPI?: Record<string, unknown> }).electronAPI ?? {};
  (window as unknown as { electronAPI?: unknown }).electronAPI = {
    ...current,
    dataRoot: { get: getFn, open: openFn, change: changeFn, claim: claimFn },
  };
  return { getFn, openFn, changeFn, claimFn };
}

function renderSettings() {
  return renderWithProviders(
    <ConfigProvider>
      <SettingsPage />
    </ConfigProvider>,
  );
}

/** 切到「存储与数据」分区（侧栏按钮与分区标题同名，这里只点按钮） */
async function openDataSection() {
  fireEvent.click(await screen.findByRole('button', { name: '存储与数据' }));
}

beforeEach(() => {
  seedZhSettings();
  // AppPageShell 在 useLayoutEffect 里量宽（ResizeObserver + matchMedia），jsdom 缺这两个 API
  stubPageShellEnv();
});

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe('票 14 + 18 + 19 · 设置页社区素材缓存与数据目录块', () => {
  it('占用只出总量不再出条数与分桶；点清除后归零并给出释放量', async () => {
    const { statsFn, clearFn } = installCacheBridge();
    renderSettings();
    await openDataSection();

    expect(await screen.findByText('社区素材缓存')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('占用 5.0 MB')).toBeInTheDocument());
    // 票 19：删掉条数与分桶两行
    expect(screen.queryByText(/个文件/)).toBeNull();
    expect(screen.queryByText(/索引与文本/)).toBeNull();
    expect(screen.queryByText(/封面与音频/)).toBeNull();
    expect(statsFn).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /清除缓存/ }));
    await waitFor(() => expect(clearFn).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('已清除（释放 5.0 MB）')).toBeInTheDocument();
  });

  it('回收策略项改名：缓存闲置天数 / 缓存上限（MB），各配独立 hint；启动时推送主进程', async () => {
    const { configureFn } = installCacheBridge();
    renderSettings();
    await openDataSection();

    expect(await screen.findByText('社区素材缓存')).toBeInTheDocument();
    const days = screen.getByLabelText('缓存闲置天数') as HTMLInputElement;
    const size = screen.getByLabelText('缓存上限（MB）') as HTMLInputElement;
    expect(days.value).toBe('30');
    expect(size.value).toBe('1024');

    // 票 19 独立 hint 文案
    expect(screen.getByText('超过这个天数没被使用过的素材会被自动清理掉，默认30天。')).toBeInTheDocument();
    expect(screen.getByText('超过缓存上限数值时，会自动清理缓存。默认 1024MB。')).toBeInTheDocument();
    expect(screen.queryByText('改了下次清扫就按新值算，不用重启')).toBeNull();

    // 启动时把已存策略推给主进程（天 → ms、MB → 字节）
    await waitFor(() => expect(configureFn).toHaveBeenCalledWith({ maxAgeMs: 30 * DAY, maxBytes: 1024 * MB }));
  });

  it('改了就推给主进程并落进设置（不用重启）', async () => {
    const { configureFn } = installCacheBridge();
    renderSettings();
    await openDataSection();

    const days = await screen.findByLabelText('缓存闲置天数');
    fireEvent.change(days, { target: { value: '7' } });
    await waitFor(() =>
      expect(configureFn).toHaveBeenLastCalledWith({ maxAgeMs: 7 * DAY, maxBytes: 1024 * MB }),
    );

    const size = screen.getByLabelText('缓存上限（MB）');
    fireEvent.change(size, { target: { value: '256' } });
    await waitFor(() =>
      expect(configureFn).toHaveBeenLastCalledWith({ maxAgeMs: 7 * DAY, maxBytes: 256 * MB }),
    );
    // 持久化：不读桥，只认 settings 里那两个字段
    const persisted = JSON.parse(localStorage.getItem('bangdream.settings.v1') ?? '{}');
    expect(persisted.cachePolicy).toEqual({ maxIdleDays: 7, maxMegabytes: 256 });
  });

  it('空缓存显示「还没有缓存内容」，清除按钮可点', async () => {
    installCacheBridge({ totalBytes: 0, count: 0, byKind: {} }, { freedBytes: 0 });
    renderSettings();
    await openDataSection();

    expect(await screen.findByText('还没有缓存内容')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /清除缓存/ })).toBeEnabled();
  });

  it('数据目录：有桥时渲染「打开数据目录」「更改数据目录位置」「使用已有数据目录」并可调 open 桥', async () => {
    const { openFn } = installDataRootBridge({ path: 'D:\\games\\bangdream-data' });
    renderSettings();
    await openDataSection();

    expect(await screen.findByText('谱面与素材')).toBeInTheDocument();
    expect(await screen.findByText('D:\\games\\bangdream-data')).toBeInTheDocument();

    const openBtn = screen.getByRole('button', { name: /打开数据目录/ });
    const changeBtn = screen.getByRole('button', { name: /更改数据目录位置/ });
    const claimBtn = screen.getByRole('button', { name: /使用已有数据目录/ });

    expect(openBtn).toBeInTheDocument();
    expect(changeBtn).toBeInTheDocument();
    expect(claimBtn).toBeInTheDocument();

    fireEvent.click(openBtn);
    await waitFor(() => expect(openFn).toHaveBeenCalledTimes(1));
  });

  it('静态演示版（没有桥）：数据目录与缓存块均不出现', async () => {
    renderSettings();
    await openDataSection();

    expect(screen.queryByText('谱面与素材')).toBeNull();
    expect(screen.queryByRole('button', { name: /打开数据目录/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /更改数据目录位置/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /使用已有数据目录/ })).toBeNull();
    expect(screen.queryByText('社区素材缓存')).toBeNull();
    expect(screen.queryByRole('button', { name: /清除缓存/ })).toBeNull();
  });
});
