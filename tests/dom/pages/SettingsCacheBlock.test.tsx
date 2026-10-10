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
  (window as unknown as { electronAPI?: unknown }).electronAPI = { assetCache: { stats: statsFn, clear: clearFn } };
  return { statsFn, clearFn };
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

describe('票 14 · 设置页社区素材缓存块', () => {
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
