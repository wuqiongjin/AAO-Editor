// bestdori-integration 07 锁测（issue 06 Q14）：**域名白名单 + 出口唯一**。
//
// 这两条取代 issues/03 原来那条「渲染进程源码不出现 bestdori.com」——按 Q1 定案，
// 端点、领域转换、搜索都落在 renderer，所以正确的口径是「只有端点文件能出现域名」，
// 而不是「renderer 里不许出现域名」（那条第一天就会红）。
//
// 白名单不是空集：上传记录的外链（chart-projects 04 写下的 ProjectDetail.tsx 硬编码）
// 已在票 07 改道到 endpoints.ts 的 postUrl()，不是给断言开例外 —— 一开例外，
// 「唯一出口」这个可检验的含义就没了。
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readSource, readStripped, repoRoot, sourceFiles } from '@/tests/support/source';

/** 唯一允许出现社区平台域名的文件 */
const WHITELIST = 'src/community/bestdori/endpoints.ts';
/** 全仓**唯一**的出口实现 */
const TRANSPORT_IMPL = 'src/community/electronTransport.ts';

const DOMAIN = /bestdori\.com/;
const TRANSPORT_IMPLEMENTS = /implements\s+CommunityTransport/;
/** 裸 fetch 调用（含变量 URL —— 只抓字面量域名的正则挡不住变量绕道） */
const BARE_FETCH = /\bfetch\s*\(/;
const XHR = /XMLHttpRequest/;
/**
 * 允许出现裸 fetch 的文件：都只取**本站静态资源**，不是外域请求。
 *
 * 1. 键音采样加载 —— `src/audio/KeySound.ts` 写明 `src` / `tierSrcs` 是 **Vite 内联 data-URI /
 *    打包资源**；2026-10 主分支把采样加载从 `AudioEngine` 的 private `loadSample` 抽成
 *    `src/audio/keySoundSamples.ts` 的 `KeySoundSampleBank.load`（实时引擎与离线音轨共用一份）。
 * 2. 结尾段 / 开场的游戏音效（chart-preview 52）—— `public/assets/game-ui/audio/*.mp3`，
 *    URL 由 `src/preview/video/sfx.ts` 用 `import.meta.env.BASE_URL` 拼（Electron 打包态 `file://`）。
 *    缺件就是静音，不回落任何外域。
 */
const LOCAL_FETCH_FILES = [
  'src/audio/keySoundSamples.ts',
  // 票 56：导入落盘前通过本机缓存协议（aao-asset://）读取已缓存音频做解码验真
  'src/pages/projects/chartImport.ts',
  // chart-preview 52：结尾段 / 开场游戏音效走包内路径，不回落外域
  'src/preview/video/encode/renderAudioTrack.ts',
];
/** 只有这些后缀参与扫描：src 下还有 .mp3 / .png 之类二进制，按文本读会误伤 */
const TEXT_EXT = /\.(ts|tsx|css|json)$/;

/**
 * src 下参与扫描的文件。`sourceFiles` 按目录 + 扩展名记忆化，四条扫描用例只有第一条
 * 真正走盘；把调用留在用例内，30s 超时才覆盖得到这次扫描。
 */
function srcFiles(): string[] {
  return sourceFiles(join(repoRoot, 'src'), TEXT_EXT);
}

describe('bestdori-integration 07 · 域名白名单', () => {
  // 全仓静态扫描在并行满载时会被抢到超过默认 5s（见 test-infra/02）：显式放宽，断言本身不变
  it('src 里只有端点文件出现 bestdori.com', () => {
    const offenders = srcFiles().filter((rel) => rel !== WHITELIST && DOMAIN.test(readSource(rel)));
    expect(offenders).toEqual([]);
  }, 30_000);

  it('白名单不是空集：端点文件确实拿着域名（否则这条断言谁都能过）', () => {
    expect(readStripped(WHITELIST)).toMatch(DOMAIN);
  });

  it('上传记录外链已改道：页面引用 postUrl()，自己不再拼域名', () => {
    const detail = readSource('src/pages/projects/components/ProjectDetail.tsx');
    expect(detail).toMatch(/postUrl\(c\.upload!\.postId\)/);
    expect(detail).not.toMatch(DOMAIN);
    expect(readStripped(WHITELIST)).toMatch(/export function postUrl\(/);
  });
});

describe('bestdori-integration 07 · 出口唯一', () => {
  it('src 里没有 XMLHttpRequest', () => {
    expect(srcFiles().filter((rel) => XHR.test(readStripped(rel)))).toEqual([]);
  }, 30_000);

  it('裸 fetch 只出现在本站静态资源与本机缓存协议验真处（变量 URL 的绕道也逃不掉）', () => {
    const callers = srcFiles().filter((rel) => BARE_FETCH.test(readStripped(rel)));
    expect([...callers].sort()).toEqual([...LOCAL_FETCH_FILES].sort());
    for (const rel of LOCAL_FETCH_FILES) expect(readStripped(rel)).not.toMatch(/https?:\/\//);
    const sampleLoader = readStripped('src/audio/keySoundSamples.ts');
    expect(sampleLoader).toMatch(/load\(src: string/);
    // 导入预解码：严格限定 aao-asset:// 本机协议（readStripped 会剥 //，字面量查 readSource）
    expect(readSource('src/pages/projects/chartImport.ts')).toMatch(/startsWith\('aao-asset:\/\/'\)/);
  }, 30_000);

  it('CommunityTransport 的实现只有一个，就是走 IPC 那个', () => {
    const impls = srcFiles().filter((rel) => TRANSPORT_IMPLEMENTS.test(readStripped(rel)));
    expect(impls).toEqual([TRANSPORT_IMPL]);
  }, 30_000);

  it('那个实现经 preload 的网络桥出去，自己不开 socket', () => {
    const impl = readStripped(TRANSPORT_IMPL);
    // 票 13：取桥与降级行为见 tests/dom/app/ElectronBridge.test.ts
    // 与 tests/unit/community/transport.test.ts；这里只守「实现类不走 socket」。
    expect(impl).toMatch(/communityNet/);
    expect(impl).not.toMatch(/WebSocket|EventSource|sendBeacon/);
  });
});
