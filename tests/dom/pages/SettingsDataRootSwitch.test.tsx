// @vitest-environment jsdom
// 票 39：设置页切换 / 认领数据根成功后，渲染侧必须**即时联动**。
//
// 与 38 的分层：38 的激活 reload 只盖住「切回工程页时列表重读」这一条**导航时序**；
// 本票锁的是**换根本身**的通知与结算——
//   锁 1：通知本身（切根成功后 catalogEpoch 递增 / Provider 收到通知），而非只看列表；
//   锁 2：会话安全回落（旧工程在新目录不存在 → reset，不抛异常、不白屏）；
//   补锁：单例失效（背景皮肤重新装载 + 缓存统计按新根重拉）；
//   守卫：根没变（「打开数据目录」/ 取消）不惊动各消费者。
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ChartProjectStore, type ChartProject } from '@/src/project/ChartProject';
import { ConfigProvider } from '@/src/app/providers/ConfigProvider';
import { useCurrentProject } from '@/src/app/providers/CurrentProjectProvider';
import { CURRENT_PROJECT_POINTER_KEY } from '@/src/project/currentProjectPointer';
import { createUnnamedProject } from '@/src/project/workspaceProject';
import { backgroundSkinStore } from '@/src/rendering/skin/backgroundSkin';
import SettingsPage from '@/src/pages/settings/SettingsPage';
import { makeMemoryProjectBackend, renderWithProviders } from '@/tests/support/providers';
import { stubPageShellEnv } from '@/tests/support/domEnv';
import { seedZhSettings } from '@/tests/support/storage';

const OLD_PATH = 'D:\\music\\bangdream-data';
const NEW_PATH = 'D:\\music\\other-data';

type DataRootResult = { ok: boolean; cancelled?: boolean; path: string; message?: string };

/** 目录消费者探针：catalogEpoch（通知）+ 当前工程指针（会话重置） */
function CatalogProbe() {
  const { catalogEpoch, projectId } = useCurrentProject();
  return (
    <div>
      <span data-testid="probe-epoch">{catalogEpoch}</span>
      <span data-testid="probe-project">{projectId ?? 'none'}</span>
    </div>
  );
}

function project(id: string, lastOpened = 100): ChartProject {
  return createUnnamedProject({ id, chartId: `c-${id}`, now: lastOpened });
}

/** 装 dataRoot 桥；claim/change 的行为由调用方给（默认原样成功、不换路径） */
function installDataRootBridge(handlers: {
  claim?: () => Promise<DataRootResult>;
  change?: () => Promise<DataRootResult>;
  open?: () => Promise<DataRootResult>;
} = {}) {
  const getFn = vi.fn(async () => ({ path: OLD_PATH }));
  const openFn = vi.fn(handlers.open ?? (async () => ({ ok: true, path: OLD_PATH })));
  const changeFn = vi.fn(handlers.change ?? (async () => ({ ok: true, cancelled: false, path: NEW_PATH })));
  const claimFn = vi.fn(handlers.claim ?? (async () => ({ ok: true, cancelled: false, path: NEW_PATH })));
  const current = (window as unknown as { electronAPI?: Record<string, unknown> }).electronAPI ?? {};
  (window as unknown as { electronAPI?: unknown }).electronAPI = {
    ...current,
    dataRoot: { get: getFn, open: openFn, change: changeFn, claim: claimFn },
  };
  return { getFn, openFn, changeFn, claimFn };
}

function installCacheBridge() {
  const statsFn = vi.fn(async () => ({ totalBytes: 1024, count: 1, byKind: { json: { bytes: 1024, count: 1 } } }));
  const clearFn = vi.fn(async () => ({ freedBytes: 1024 }));
  const configureFn = vi.fn(async () => ({ maxAgeMs: 0, maxBytes: 0 }));
  const current = (window as unknown as { electronAPI?: Record<string, unknown> }).electronAPI ?? {};
  (window as unknown as { electronAPI?: unknown }).electronAPI = {
    ...current,
    assetCache: { stats: statsFn, clear: clearFn, configure: configureFn },
  };
  return { statsFn };
}

/** 渲染设置页 + 探针；store 的后端即「当前数据根」的盘 */
function renderSettings(store: ChartProjectStore) {
  return renderWithProviders(
    <>
      <ConfigProvider>
        <SettingsPage />
      </ConfigProvider>
      <CatalogProbe />
    </>,
    { store },
  );
}

async function openDataSection() {
  fireEvent.click(await screen.findByRole('button', { name: '存储与数据' }));
}

/** 等首屏把当前目录路径读出来（切根守卫要跟这个状态比） */
async function waitForPath() {
  await waitFor(() => expect(screen.getByText(OLD_PATH)).toBeInTheDocument());
}

beforeEach(() => {
  seedZhSettings();
  localStorage.removeItem(CURRENT_PROJECT_POINTER_KEY);
  stubPageShellEnv();
});

afterEach(() => {
  localStorage.removeItem(CURRENT_PROJECT_POINTER_KEY);
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  vi.restoreAllMocks();
});

describe('票 39 · 切换数据目录后的即时联动', () => {
  it('认领成功：通知 Provider（catalogEpoch 递增）+ 背景皮肤重新装载 + 缓存统计重拉', async () => {
    const backend = makeMemoryProjectBackend([project('p-new')]);
    const store = new ChartProjectStore(backend);
    // DOM 层只锁「reload 被调用」这个接线；reload 语义由 unit 测试锁
    const reloadSpy = vi.spyOn(backgroundSkinStore, 'reload').mockResolvedValue(undefined);
    // 锁调用点：撤掉「切根时作废按 id 派生缓存」这条接线，本断言红
    const resetCachesSpy = vi.spyOn(store, 'resetCatalogCaches');
    installDataRootBridge({
      claim: async () => {
        // 换根：新目录里放另一个工程（后端即"盘"）
        backend.disk.clear();
        backend.disk.set('p-new', project('p-new'));
        return { ok: true, cancelled: false, path: NEW_PATH };
      },
    });
    const { statsFn } = installCacheBridge();

    renderSettings(store);
    await openDataSection();
    await waitForPath();
    expect(screen.getByTestId('probe-epoch').textContent).toBe('0');

    fireEvent.click(screen.getByRole('button', { name: /使用已有数据目录/ }));

    // 锁 1：通知本身（不依赖导航时序）
    await waitFor(() => expect(screen.getByTestId('probe-epoch').textContent).toBe('1'));
    // 补锁：单例失效
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(resetCachesSpy).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(statsFn).toHaveBeenCalledTimes(2)); // 挂载 1 次 + 切根重拉 1 次
  });

  it('切根后旧工程在新目录不存在：会话指针安全回落（reset，不抛异常、不白屏）', async () => {
    localStorage.setItem(CURRENT_PROJECT_POINTER_KEY, JSON.stringify({ projectId: 'p-old', chartId: 'c-p-old' }));
    const store = new ChartProjectStore(makeMemoryProjectBackend([project('p-new')]));
    installDataRootBridge();

    renderSettings(store);
    await openDataSection();
    await waitForPath();
    // 恢复出来的指针还指着旧目录的工程
    expect(screen.getByTestId('probe-project').textContent).toBe('p-old');

    fireEvent.click(screen.getByRole('button', { name: /使用已有数据目录/ }));

    // 锁 2：新目录没有 p-old → 指针清掉（工作台再进时会 ensure 到新目录的工程，不悬空）
    await waitFor(() => expect(screen.getByTestId('probe-project').textContent).toBe('none'));
    // 不白屏：页面与探针都还在
    expect(screen.getByText(NEW_PATH)).toBeInTheDocument();
    expect(screen.getByTestId('probe-epoch').textContent).toBe('1');
  });

  it('切根后旧工程在新目录仍存在（同 id）：会话保留，只通知不重置', async () => {
    localStorage.setItem(CURRENT_PROJECT_POINTER_KEY, JSON.stringify({ projectId: 'p1', chartId: 'c-p1' }));
    const store = new ChartProjectStore(makeMemoryProjectBackend([project('p1')]));
    installDataRootBridge();

    renderSettings(store);
    await openDataSection();
    await waitForPath();

    fireEvent.click(screen.getByRole('button', { name: /使用已有数据目录/ }));

    await waitFor(() => expect(screen.getByTestId('probe-epoch').textContent).toBe('1'));
    expect(screen.getByTestId('probe-project').textContent).toBe('p1');
  });

  it('「更改数据目录位置」与认领同路径：同样通知', async () => {
    const store = new ChartProjectStore(makeMemoryProjectBackend([project('p1')]));
    installDataRootBridge();

    renderSettings(store);
    await openDataSection();
    await waitForPath();

    fireEvent.click(screen.getByRole('button', { name: /更改数据目录位置/ }));
    await waitFor(() => expect(screen.getByTestId('probe-epoch').textContent).toBe('1'));
  });

  it('守卫：根没变（「打开数据目录」）不通知、不重拉', async () => {
    const store = new ChartProjectStore(makeMemoryProjectBackend([project('p1')]));
    const reloadSpy = vi.spyOn(backgroundSkinStore, 'reload').mockResolvedValue(undefined);
    const resetCachesSpy = vi.spyOn(store, 'resetCatalogCaches');
    installDataRootBridge(); // open 默认返回原路径
    const { statsFn } = installCacheBridge();

    renderSettings(store);
    await openDataSection();
    await waitForPath();

    const openBtn = screen.getByRole('button', { name: /打开数据目录/ });
    fireEvent.click(openBtn);
    // 等这轮 async 处理结算（busy 落幕后按钮重新可用）
    await waitFor(() => expect(openBtn).toBeEnabled());

    expect(screen.getByTestId('probe-epoch').textContent).toBe('0');
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(resetCachesSpy).not.toHaveBeenCalled();
    expect(statsFn).toHaveBeenCalledTimes(1);
  });

  it('守卫：用户取消选择不通知、不重置', async () => {
    localStorage.setItem(CURRENT_PROJECT_POINTER_KEY, JSON.stringify({ projectId: 'p-old', chartId: 'c-p-old' }));
    const store = new ChartProjectStore(makeMemoryProjectBackend([project('p-new')]));
    installDataRootBridge({
      claim: async () => ({ ok: true, cancelled: true, path: OLD_PATH }),
    });

    renderSettings(store);
    await openDataSection();
    await waitForPath();

    fireEvent.click(screen.getByRole('button', { name: /使用已有数据目录/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /使用已有数据目录/ })).toBeEnabled());

    expect(screen.getByTestId('probe-epoch').textContent).toBe('0');
    expect(screen.getByTestId('probe-project').textContent).toBe('p-old');
  });
});
