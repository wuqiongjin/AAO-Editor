// 票 39 锁测 7：站外链接出口（`shell:openExternal`）—— 本仓**第一个真会被点到**的站外链接。
//
// 形态照 CommunitySession.test.ts：真函数跑行为（假 ipcMain + 假 shell），静态断言读源码锁接线。
// 三条口径：
//   ① 合法站点 URL → `openExternal` 被调一次（且拿到的就是端点文件产的那个 URL）；
//   ② 非站点 URL（其它站 / 子域伪装 / 非 https / 非字符串）一律拒绝，且**一次都不调** openExternal；
//   ③ 域名事实只有一份：白名单取自 communityNet.cjs，main.cjs 只接线、自己不认域名。
import { describe, expect, it } from 'vitest';
import { isSiteUrl, registerExternalLinkIpc } from '@/electron/externalLink.cjs';
import { siteHomeUrl } from '@/src/community/bestdori/endpoints';
import { readSource, readStripped } from '@/tests/support/source';

const PRELOAD = 'electron/preload.js';
const MAIN = 'electron/main.cjs';
const EXTERNAL_LINK = 'electron/externalLink.cjs';

/** 假 ipcMain：收下注册进来的 handler，测试直接调它（跨进程语义的进程内替身） */
function fakeIpcMain() {
  const handlers = new Map<string, (event: unknown, payload?: unknown) => unknown>();
  return {
    handlers,
    ipcMain: {
      handle: (channel: string, listener: any) => {
        handlers.set(channel, listener);
      },
    },
  };
}

/** 假 shell：只记「被 open 了哪些 URL」 */
function fakeShell() {
  const calls: string[] = [];
  return {
    calls,
    shell: {
      openExternal: async (url: string) => {
        calls.push(url);
      },
    },
  };
}

function makeExit() {
  const { handlers, ipcMain } = fakeIpcMain();
  const { calls, shell } = fakeShell();
  registerExternalLinkIpc(ipcMain, shell);
  return { handler: handlers.get('shell:openExternal')!, calls, ipcMain };
}

/** 平台自己的地址与其子域放行；其余一律拒 */
const ALLOWED = [siteHomeUrl(), 'https://www.bestdori.com/', 'https://bestdori.com/community/charts/1'];
const REJECTED = [
  'http://evil.example/',
  'https://evil.example/bestdori.com',
  'https://bestdori.com.evil.example/',
  'http://bestdori.com/',            // 只有 https 出得去
  'javascript:alert(1)',
  'file:///etc/passwd',
  'data:text/html,<a href="https://bestdori.com/">x</a>',
  'not a url at all',
  '',
];

describe('票 39 · 站外链接出口（主进程校验）', () => {
  it('合法站点 URL：openExternal 被调一次，拿到的是端点文件产的那个地址', async () => {
    const { handler, calls } = makeExit();

    await expect(handler(null, siteHomeUrl())).resolves.toBe(true);
    expect(calls).toEqual([siteHomeUrl()]);
    // 子域同样放行（票 39 Q47：`bestdori.com` / `*.bestdori.com`）
    await expect(handler(null, 'https://www.bestdori.com/')).resolves.toBe(true);
    expect(calls).toHaveLength(2);
  });

  it('非站点 URL 一律拒绝：不 open、抛错（子域伪装与非 https 都逃不掉）', async () => {
    const { handler, calls } = makeExit();

    for (const url of REJECTED) {
      await expect(handler(null, url), url).rejects.toThrow();
    }
    // 还有「根本没给 URL」这一档（renderer 传了非字符串）
    await expect(handler(null, 42)).rejects.toThrow();
    await expect(handler(null, undefined)).rejects.toThrow();

    expect(calls).toEqual([]);
  });

  it('判定口径一处：isSiteUrl 是纯函数，只认 https + 白名单（含子域）', () => {
    for (const url of ALLOWED) expect(isSiteUrl(url), url).toBe(true);
    for (const url of REJECTED) expect(isSiteUrl(url), url).toBe(false);
    expect(isSiteUrl(undefined)).toBe(false);
    // 白名单可注入（主进程默认取 ALLOWED_HOSTS）：注入什么就只放行什么
    expect(isSiteUrl('https://example.com/', ['example.com'])).toBe(true);
    expect(isSiteUrl(siteHomeUrl(), ['example.com'])).toBe(false);
  });
});

describe('票 39 · 站外链接的接线事实', () => {
  const preloadSrc = readStripped(PRELOAD);
  const mainSrc = readStripped(MAIN);
  const linkSrc = readStripped(EXTERNAL_LINK);

  it('preload 只多这一条桥：一条 shell.openExternal，带 URL 入参', () => {
    // 本票只加这一个命名空间（凭据面的接口越小越好的同一条纪律）
    expect((preloadSrc.match(/shell\s*:\s*\{/g) ?? []).length).toBe(1);
    expect(preloadSrc).toMatch(
      /openExternal:\s*\(url\)\s*=>\s*ipcRenderer\.invoke\(\s*['"]shell:openExternal['"]\s*,\s*url\s*\)/,
    );
  });

  it('main.cjs 只接线：handler 与校验都在 externalLink.cjs（那样才能跑真函数测试）', () => {
    expect(mainSrc).toMatch(/registerExternalLinkIpc\(ipcMain,\s*shell\)/);
    // 主进程侧只有一份域名事实：白名单在 communityNet.cjs，main.cjs 不认识域名
    expect(mainSrc).not.toMatch(/bestdori/i);
    expect(linkSrc).toMatch(/ALLOWED_HOSTS/);
    expect(linkSrc).not.toMatch(/bestdori/i);
  });

  it('域名仍然只住端点文件：出口模块从 endpoints 取 URL，不自拼', () => {
    const external = readSource('src/community/externalLink.ts');
    expect(external).toMatch(/siteHomeUrl\(\)/);
    expect(external).not.toMatch(/bestdori\.com|https?:\/\//);
    // 界面侧保留 <a href>（可复制 / 键盘可达）：两条入口都指站点首页
    expect(readStripped('src/pages/projects/components/SignInDialog.tsx')).toMatch(/siteHomeUrl\(\)/);
  });
});
