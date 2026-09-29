// @vitest-environment jsdom
// issue 10：ensure 新建未命名工程时必须通知工程目录（catalogEpoch 递增）——
// ProjectsPage 是保活挂载、只认 catalogEpoch，不通知的话列表里就看不到这个已落盘的工程。
// 反向也锁住：单纯打开已有工程不通知，否则每次进工作台都白拉一次列表。
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { act, screen } from '@testing-library/react';
import { ChartProjectStore } from '@/src/project/ChartProject';
import {
  useCurrentProject,
  type CurrentProjectContextValue,
} from '@/src/app/providers/CurrentProjectProvider';
import { createUnnamedProject } from '@/src/project/workspaceProject';
import {
  makeMemoryProjectBackend,
  renderWithProviders,
  type MemoryProjectBackend,
} from '@/tests/support/providers';

/** 探针：把目录版本与当前工程渲染成可查询文本，并把上下文交给测试驱动。 */
function CatalogProbe({ capture }: { capture: { current: CurrentProjectContextValue | null } }) {
  const ctx = useCurrentProject();
  capture.current = ctx;
  return (
    <div>
      <span>{`目录版本 ${ctx.catalogEpoch}`}</span>
      <span>{ctx.projectId ?? '未打开工程'}</span>
    </div>
  );
}

function mountProbe(backend: MemoryProjectBackend) {
  const capture: { current: CurrentProjectContextValue | null } = { current: null };
  renderWithProviders(<CatalogProbe capture={capture} />, { store: new ChartProjectStore(backend) });
  return capture;
}

describe('issue 10 · 当前工程与工程目录同步', () => {
  it('无工程时 ensure 新建未命名工程并递增目录版本（工程管理页列表跟着刷新）', async () => {
    const backend = makeMemoryProjectBackend();
    const capture = mountProbe(backend);

    expect(screen.getByText('目录版本 0')).toBeInTheDocument();
    expect(screen.getByText('未打开工程')).toBeInTheDocument();

    await act(async () => {
      await capture.current!.ensure();
    });

    expect(screen.getByText('目录版本 1')).toBeInTheDocument();
    expect(backend.disk.size).toBe(1);
  });

  it('打开已有的未完成工程不通知目录（避免每次进工作台都重拉列表）', async () => {
    const existing = createUnnamedProject({ id: 'pSong', chartId: 'cEx', now: 1_700_000_000_000 });
    const backend = makeMemoryProjectBackend([existing]);
    const capture = mountProbe(backend);

    await act(async () => {
      await capture.current!.ensure();
    });

    expect(screen.getByText('目录版本 0')).toBeInTheDocument();
    expect(screen.getByText('pSong')).toBeInTheDocument();
    expect(backend.disk.size).toBe(1);
  });

  it('同一会话再次 ensure 复用当前工程，目录版本不再递增', async () => {
    const backend = makeMemoryProjectBackend();
    const capture = mountProbe(backend);

    await act(async () => {
      await capture.current!.ensure();
      await capture.current!.ensure();
    });

    expect(screen.getByText('目录版本 1')).toBeInTheDocument();
    expect(backend.disk.size).toBe(1);
  });
});
