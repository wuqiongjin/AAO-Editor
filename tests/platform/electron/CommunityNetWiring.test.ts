// 票 07：IPC 契约与 preload 白名单（跨进程语义）+ 下载暂存接在数据根下。
// 静态断言照既有惯例（ChartCodeExportSaveAs.test.ts / ElectronDataRoot.test.ts）：
// 读源码锁接线事实，真函数跑行为。
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BINARY_TIMEOUT_MS,
  DEFAULT_USER_AGENT,
  JSON_TIMEOUT_MS,
  createCommunityGateway,
  registerCommunityNetIpc,
} from '@/electron/communityNet.cjs';
import {
  CACHE_DIRNAME,
  cacheDir,
  legacyDownloadsDir,
  loadDataRootSync,
  removeLegacyDownloads,
} from '@/electron/dataRoot.cjs';
import { ASSET_SCHEME, THUMB_HOST } from '@/electron/assetProtocol.cjs';
import {
  ASSET_SCHEME as RENDERER_ASSET_SCHEME,
  ASSET_THUMB_HOST as RENDERER_THUMB_HOST,
  assetThumbUrl,
} from '@/src/community/assetUrls';
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
const assetCacheSrc = readStripped('electron/assetCache.cjs');

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

describe('票 07 + 14 · preload 白名单：网络一条、缓存两条', () => {
  it('暴露 communityNet.request，且只走 communityNet:request', () => {
    expect(preloadSrc).toMatch(/communityNet\s*:/);
    expect(preloadSrc).toMatch(/invoke\(\s*['"]communityNet:request['"]/);
    expect(preloadSrc).toMatch(/exposeInMainWorld\(\s*'electronAPI'/);
    expect(preloadSrc).not.toMatch(/nodeIntegration/);
  });

  it('缓存只开三条：占用查询 / 清除 / 回收策略推送（不暴露缓存内容）', () => {
    expect(preloadSrc).toMatch(/assetCache\s*:/);
    expect(preloadSrc).toMatch(/invoke\(\s*['"]assetCache:stats['"]/);
    expect(preloadSrc).toMatch(/invoke\(\s*['"]assetCache:clear['"]/);
    // 票 18：界面改的回收参数经这条推给主进程（只递两个数，不递缓存内容）
    expect(preloadSrc).toMatch(/invoke\(\s*['"]assetCache:configure['"]/);
  });

  it('主进程注册同一条通道，形态照既有桥（一个命名空间一条 invoke）', () => {
    expect(gatewaySrc).toMatch(/ipcMain\.handle\(\s*['"]communityNet:request['"]/);
    expect(mainSrc).toMatch(/registerCommunityNetIpc\(ipcMain,\s*communityGateway\)/);
  });

  it('注册到假 ipcMain 后，handler 真的走网关（正常与越界各一条）', async () => {
    const { ipcMain, handlers } = fakeIpcMain();
    registerCommunityNetIpc(ipcMain, createCommunityGateway({ fetchImpl: okFetch }));

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

  it('素材缓存目录接在数据根下、每次现取（数据根能被搬家）', () => {
    expect(mainSrc).toMatch(/createAssetCache\(\{\s*dir:\s*\(\)\s*=>\s*cacheDir\(currentDataRoot\(\)\),/);
    expect(mainSrc).toMatch(/assetCache,\s*\}\);/);
  });

  it('启动扫缓存（30 天 / 1GB / 半截文件）；07 的下载暂存退役，残留顺手清掉', () => {
    const ready = mainSrc.slice(mainSrc.indexOf('app.whenReady()'));
    expect(ready).toMatch(/assetCache\.sweep\(\)/);
    expect(ready).toMatch(/removeLegacyDownloads\(currentDataRoot\(\)\)/);
    expect(mainSrc).not.toMatch(/resetCommunityStaging/);
  });

  it('设置页的两条缓存 IPC 在主进程与 preload 各就各位', () => {
    expect(mainSrc).toMatch(/registerAssetCacheIpc\(ipcMain,\s*assetCache\)/);
    expect(assetCacheSrc).toMatch(/ipcMain\.handle\(\s*['"]assetCache:stats['"]/);
    expect(assetCacheSrc).toMatch(/ipcMain\.handle\(\s*['"]assetCache:clear['"]/);
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

describe('票 14 · 素材缓存目录（<数据根>/cache/community/）', () => {
  it('目录名与路径都从数据根算', () => {
    expect(CACHE_DIRNAME).toBe('cache');
    expect(cacheDir('/data')).toBe(join('/data', 'cache', 'community'));
  });

  it('数据根布局带上 cache/community/（首次用即存在）', () => {
    const userData = tmpDir('aao-cache-root-');
    try {
      const root = loadDataRootSync(userData);
      expect(existsSync(cacheDir(root))).toBe(true);
    } finally {
      rmSync(userData, { recursive: true, force: true });
    }
  });

  it('不再预建 downloads/（暂存退役，票 14）', () => {
    const userData = tmpDir('aao-cache-no-downloads-');
    try {
      const root = loadDataRootSync(userData);
      expect(existsSync(legacyDownloadsDir(root))).toBe(false);
    } finally {
      rmSync(userData, { recursive: true, force: true });
    }
  });

  it('removeLegacyDownloads 清掉旧根残留；本来就没有也不报错', async () => {
    const userData = tmpDir('aao-cache-legacy-');
    try {
      const root = loadDataRootSync(userData);
      mkdirSync(join(legacyDownloadsDir(root), 'inner'), { recursive: true });
      writeFileSync(join(legacyDownloadsDir(root), 'inner', 'old.bin'), 'old');

      await removeLegacyDownloads(root);
      expect(existsSync(legacyDownloadsDir(root))).toBe(false);

      await expect(removeLegacyDownloads(root)).resolves.toBeUndefined();
    } finally {
      rmSync(userData, { recursive: true, force: true });
    }
  });
});

describe('票 15 · 本机素材协议接线（aao-asset://）', () => {
  it('scheme 特权在 app ready 之前登记，处理器挂进去（Electron 的硬要求）', () => {
    const privilegedAt = mainSrc.indexOf('registerAssetSchemePrivileges(protocol)');
    const readyAt = mainSrc.indexOf('app.whenReady()');
    expect(privilegedAt).toBeGreaterThan(-1);
    expect(readyAt).toBeGreaterThan(-1);
    expect(privilegedAt).toBeLessThan(readyAt);
    expect(mainSrc.slice(readyAt)).toMatch(/registerAssetProtocol\(protocol,\s*assetCache\)/);
  });

  it('缩略图产出器接在缓存上，nativeImage 由 main 注入（协议 / 缓存模块不 require electron）', () => {
    expect(mainSrc).toMatch(/const makeThumb = createThumbMaker\(nativeImage\);/);
    expect(mainSrc).toMatch(/makeThumb,/);
    for (const file of ['electron/assetProtocol.cjs', 'electron/assetThumbnails.cjs', 'electron/assetCache.cjs']) {
      expect(readStripped(file), file).not.toMatch(/require\(\s*['"]electron['"]\s*\)/);
    }
  });

  it('协议是只读的：不联网、不自己取数（取数仍归网关）', () => {
    const protocolSrc = readStripped('electron/assetProtocol.cjs');
    expect(protocolSrc).not.toMatch(/fetch\s*\(/);
    expect(protocolSrc).not.toMatch(/communityNet|net\.fetch/);
    expect(protocolSrc).toMatch(/kind:\s*'binary'/);
  });

  it('渲染侧那份 URL 形态与主进程同值（CJS 引不到 TS，只能互锁）', () => {
    expect(ASSET_SCHEME).toBe(RENDERER_ASSET_SCHEME);
    expect(THUMB_HOST).toBe(RENDERER_THUMB_HOST);
    expect(assetThumbUrl('https://example.com/x.png')).toBe(
      `${ASSET_SCHEME}://${THUMB_HOST}/?url=${encodeURIComponent('https://example.com/x.png')}`,
    );
  });

  it('读缓存不走 IPC 桥：preload 不为它开通道', () => {
    // 用常量做子串断言：scheme 再改名也不用在两处同步
    expect(preloadSrc).not.toMatch(ASSET_SCHEME);
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

  it('回退页判定（text/html）主进程与端点文件同规则（各写一份，改一边另一条要跟上）', () => {
    expect(gatewaySrc).toContain('text\\/html');
    expect(readSource('src/community/bestdori/endpoints.ts')).toContain('text\\/html');
  });
});
