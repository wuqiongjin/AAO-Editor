// @vitest-environment jsdom
// 票 04：组包前必须等轨迹 flush 真正落盘（IPC 保序），
// 否则主进程读 logs 目录时可能拿到不完整的轨迹。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportDiagnostics } from '@/src/diagnostics/exportDiagnostics';
import { trail } from '@/src/diagnostics/trail';

const ORDER: string[] = [];
let releaseTrail: () => void = () => {};

function installFakeBridge(): void {
  ORDER.length = 0;
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    log: {
      write: () => {
        ORDER.push('log:write');
        return Promise.resolve();
      },
      trail: () => {
        ORDER.push('log:trail');
        return new Promise<void>((resolve) => {
          releaseTrail = resolve;
        });
      },
    },
    diagnostics: {
      export: () => {
        ORDER.push('diagnostics:export');
        return Promise.resolve({ cancelled: true });
      },
    },
  };
}

describe('票 04 · 导出前轨迹落盘保序', () => {
  afterEach(async () => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    releaseTrail();
    await trail.flush();
    ORDER.length = 0;
  });

  it('flush 的全部轨迹落盘后才发起 diagnostics:export', async () => {
    installFakeBridge();
    trail.record({ module: 'test', action: 'export-start' });

    const done = exportDiagnostics({
      pageId: 'settings',
      projectId: null,
      settings: { theme: 'dark' },
      includeChart: false,
      getProject: async () => null,
    });

    // 轨迹 IPC 已发但未落盘：导出必须还没发起（旧实现这里已经调了 bridge.export）
    expect(ORDER).toEqual(['log:trail']);

    releaseTrail();
    await done;
    expect(ORDER).toEqual(['log:trail', 'diagnostics:export']);
  });

  it('谱面读取失败的 warn 也赶在导出之前落盘', async () => {
    installFakeBridge();
    trail.record({ module: 'test', action: 'read-chart' });
    const done = exportDiagnostics({
      pageId: 'workspace',
      projectId: 'p1',
      settings: {},
      includeChart: true,
      getProject: async () => {
        throw new Error('disk full');
      },
    });

    // warn（log:write）与轨迹（log:trail）都已发出，导出还没发起
    await vi.waitFor(() => {
      expect(ORDER).toEqual(['log:write', 'log:trail']);
    });
    releaseTrail();
    await done;
    expect(ORDER).toEqual(['log:write', 'log:trail', 'diagnostics:export']);
  });
});
