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
  (window as unknown as { electronAPI?: unknown }).electronAPI = {
    assetCache: { stats: statsFn, clear: clearFn, configure: configureFn },
  };
  return { statsFn, clearFn, configureFn };
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

describe('票 14 + 18 · 设置页社区素材缓存块', () => {
  it('占用来自主进程；点清除后归零并给出释放量', async () => {
    const { statsFn, clearFn } = installCacheBridge();
    renderSettings();
    await openDataSection();

    expect(await screen.findByText('社区素材缓存')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('占用 5.0 MB · 3 个文件')).toBeInTheDocument());
    // 分桶照落地：json/text → 索引与文本；binary → 封面与音频
    expect(screen.getByText('索引与文本 1.0 MB · 封面与音频 4.0 MB')).toBeInTheDocument();
    expect(statsFn).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /清除缓存/ }));
    await waitFor(() => expect(clearFn).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('已清除（释放 5.0 MB）')).toBeInTheDocument();
  });

  it('回收策略可设：默认 30 天 / 1024 MB，启动时先拨一次给主进程', async () => {
    const { configureFn } = installCacheBridge();
    renderSettings();
    await openDataSection();

    expect(await screen.findByText('社区素材缓存')).toBeInTheDocument();
    const days = screen.getByLabelText('闲置超过（天）就清除') as HTMLInputElement;
    const size = screen.getByLabelText('占用上限（MB）') as HTMLInputElement;
    expect(days.value).toBe('30');
    expect(size.value).toBe('1024');
    // 启动时把已存策略推给主进程（天 → ms、MB → 字节）
    await waitFor(() => expect(configureFn).toHaveBeenCalledWith({ maxAgeMs: 30 * DAY, maxBytes: 1024 * MB }));
  });

  it('改了就推给主进程并落进设置（不用重启）', async () => {
    const { configureFn } = installCacheBridge();
    renderSettings();
    await openDataSection();

    const days = await screen.findByLabelText('闲置超过（天）就清除');
    fireEvent.change(days, { target: { value: '7' } });
    await waitFor(() =>
      expect(configureFn).toHaveBeenLastCalledWith({ maxAgeMs: 7 * DAY, maxBytes: 1024 * MB }),
    );

    const size = screen.getByLabelText('占用上限（MB）');
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

  it('静态演示版（没有这条桥）：整块不出现', async () => {
    renderSettings();
    await openDataSection();

    expect(screen.queryByText('社区素材缓存')).toBeNull();
    expect(screen.queryByRole('button', { name: /清除缓存/ })).toBeNull();
  });
});
