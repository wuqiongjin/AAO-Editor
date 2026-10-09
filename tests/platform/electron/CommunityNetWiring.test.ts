// 票 07：IPC 契约与 preload 白名单（跨进程语义）+ 下载暂存接在数据根下。
// 静态断言照既有惯例（ChartCodeExportSaveAs.test.ts / ElectronDataRoot.test.ts）：
// 读源码锁接线事实，真函数跑行为。
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BINARY_TIMEOUT_MS,
  DEFAULT_USER_AGENT,
  JSON_TIMEOUT_MS,
  createCommunityGateway,
  registerCommunityNetIpc,
  resetCommunityStaging,
} from '@/electron/communityNet.cjs';
import { DOWNLOADS_DIRNAME, downloadsDir, loadDataRootSync } from '@/electron/dataRoot.cjs';
import {
  BESTDORI_BINARY_TIMEOUT_MS,
  BESTDORI_JSON_TIMEOUT_MS,
  BESTDORI_RETRY_POLICY,
  BESTDORI_USER_AGENT,
} from '@/src/community/bestdori/endpoints';
import { backoffDelayMs } from '@/src/community/rateLimit';
import { readSource, readStripped } from '@/tests/support/source';
import { tmpDir } from '@/tests/support/fs';

const mainSrc = readStripped('electron/main.cjs');
const preloadSrc = readStripped('electron/preload.js');
const gatewaySrc = readStripped('electron/communityNet.cjs');

type IpcListener = (event: unknown, payload: unknown) => unknown;

/** 假 ipcMain：收下注册进来的 handler，测试直接调它 —— 跨进程语义的进程内替身 */
function fakeIpcMain() {
  const handlers = new Map<string, IpcListener>();
  return {
    handlers,
    ipcMain: {
      // listener 用 any：与 .cjs 侧 JSDoc 的 Function 签名对齐，测试替身不抠这个
      handle: (channel: string, listener: any) => {
        handlers.set(channel, listener as IpcListener);
      },
    },
  };
}

const okFetch = async () => ({
  status: 200,
  headers: { get: () => null, getSetCookie: () => [] },
  text: async () => '{"result":true}',
});

describe('票 07 · preload 白名单只多一条网络通道', () => {
  it('暴露 communityNet.request，且只走 communityNet:request', () => {
    expect(preloadSrc).toMatch(/communityNet\s*:/);
    expect(preloadSrc).toMatch(/invoke\(\s*['"]communityNet:request['"]/);
    expect(preloadSrc).toMatch(/exposeInMainWorld\(\s*'electronAPI'/);
    expect(preloadSrc).not.toMatch(/nodeIntegration/);
  });

  it('主进程注册同一条通道，形态照既有桥（一个命名空间一条 invoke）', () => {
    expect(gatewaySrc).toMatch(/ipcMain\.handle\(\s*['"]communityNet:request['"]/);
    expect(mainSrc).toMatch(/registerCommunityNetIpc\(ipcMain,\s*communityGateway\)/);
  });

  it('注册到假 ipcMain 后，handler 真的走网关（正常与越界各一条）', async () => {
    const { ipcMain, handlers } = fakeIpcMain();
    registerCommunityNetIpc(ipcMain, createCommunityGateway({ stagingDir: '/tmp/unused-staging', fetchImpl: okFetch }));

    const handler = handlers.get('communityNet:request');
    expect(typeof handler).toBe('function');
    await expect(handler?.(null, { url: 'https://bestdori.com/api/post/list', method: 'POST', body: '{}' })).resolves.toMatchObject({
      ok: true,
      data: { result: true },
    });
    // 同一入口也兜住越界主机 —— 渲染侧那层白名单是先手，不是唯一一道
    await expect(handler?.(null, { url: 'https://evil.com/x' })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'request-rejected' },
    });
  });
});

describe('票 07 · 主进程接线与安全默认', () => {
  it('HTTP 走 Electron net.fetch（ADR-0011 §2 的 net 模块），且只在 app ready 之后才可能发', () => {
    expect(mainSrc).toMatch(/net\.fetch/);
    expect(mainSrc).toMatch(/fetchImpl:\s*\(url, init\)\s*=>\s*net\.fetch\(url, init\)/);
  });

  it('暂存目录接在数据根下、每次现取（数据根能被搬家）', () => {
    expect(mainSrc).toMatch(/stagingDir:\s*\(\)\s*=>\s*downloadsDir\(currentDataRoot\(\)\)/);
    expect(gatewaySrc).toMatch(/typeof stagingDir === 'function'/);
  });

  it('启动即清空下载暂存（过程态，不攒上一轮没导入的文件）', () => {
    const ready = mainSrc.slice(mainSrc.indexOf('app.whenReady()'));
    expect(ready).toMatch(/resetCommunityStaging\(downloadsDir\(currentDataRoot\(\)\)\)/);
  });

  it('不为网络放开渲染进程安全开关（nodeIntegration / contextIsolation 不动）', () => {
    expect(mainSrc).toMatch(/nodeIntegration:\s*false/);
    expect(mainSrc).toMatch(/contextIsolation:\s*true/);
    expect(mainSrc).not.toMatch(/webSecurity\s*:\s*false/);
    expect(gatewaySrc).not.toMatch(/webSecurity/);
  });

  it('网关自己持有主机白名单、最小间隔与禁自带凭据头（renderer 那份不是唯一一道）', () => {
    expect(gatewaySrc).toMatch(/ALLOWED_HOSTS\s*=\s*\['bestdori\.com'\]/);
    expect(gatewaySrc).toMatch(/MIN_REQUEST_INTERVAL_MS\s*=/);
    expect(gatewaySrc).toMatch(/FORBIDDEN_HEADERS\s*=\s*\['cookie'/);
  });

  it('webPreferences 的 preload 仍是 contextBridge 那个文件', () => {
    expect(mainSrc).toMatch(/preload:\s*path\.join\(__dirname,\s*'preload\.js'\)/);
  });
});

describe('票 07 · 下载暂存目录（<数据根>/downloads/）', () => {
  it('目录名与路径都从数据根算', () => {
    expect(DOWNLOADS_DIRNAME).toBe('downloads');
    expect(downloadsDir('/data')).toBe(join('/data', 'downloads'));
  });

  it('数据根布局带上 downloads/（首次用即存在）', () => {
    const userData = tmpDir('tsugu-downloads-root-');
    try {
      const root = loadDataRootSync(userData);
      expect(existsSync(downloadsDir(root))).toBe(true);
    } finally {
      rmSync(userData, { recursive: true, force: true });
    }
  });

  it('resetCommunityStaging 删旧建新（启动清空）', async () => {
    const dir = tmpDir('tsugu-staging-reset-');
    try {
      mkdirSync(join(dir, 'inner'), { recursive: true });
      writeFileSync(join(dir, 'inner', 'old.bin'), 'old');
      await resetCommunityStaging(dir);
      expect(readdirSync(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('暂存目录不存在也能补齐（rm force + mkdir recursive）', async () => {
    const parent = tmpDir('tsugu-staging-missing-');
    const missing = join(parent, 'nested');
    try {
      await expect(resetCommunityStaging(missing)).resolves.toBeUndefined();
      expect(readdirSync(missing)).toEqual([]);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});

describe('票 07 · 源码事实', () => {
  it('网关不 import renderer 侧的东西（CJS 单向依赖）', () => {
    expect(readSource('electron/communityNet.cjs')).not.toMatch(/from '@\/src|require\(['"]\.\.\/src/);
  });

  it('响应校验点都在（非 2xx / 非 JSON / 业务码 / Set-Cookie）', () => {
    for (const marker of ['status === 429', 'status === 401', 'JSON.parse', 'classifyBusiness', 'readSetCookie']) {
      expect(gatewaySrc, marker).toContain(marker);
    }
  });

  it('限流数值只有一份（平台端点文件），算法在 rateLimit', () => {
    expect(backoffDelayMs(1, BESTDORI_RETRY_POLICY, () => 0)).toBe(BESTDORI_RETRY_POLICY.baseDelayMs);
    expect(gatewaySrc).not.toMatch(/baseDelayMs|maxAttempts/);
  });

  it('主进程的兜底口径与端点文件同值：UA / 两个超时（一处改、另一处不敢忘）', () => {
    // 主进程是 CJS、引不到 TS，两份常量只能靠这条互锁（改一边另一条就红）
    expect(DEFAULT_USER_AGENT).toBe(BESTDORI_USER_AGENT);
    expect(JSON_TIMEOUT_MS).toBe(BESTDORI_JSON_TIMEOUT_MS);
    expect(BINARY_TIMEOUT_MS).toBe(BESTDORI_BINARY_TIMEOUT_MS);
  });
});
