// bestdori-integration 07 锁测（issue 06 Q14）：**域名白名单 + 出口唯一**。
//
// 这两条取代 issues/03 原来那条「渲染进程源码不出现 bestdori.com」——按 Q1 定案，
// 端点、领域转换、搜索都落在 renderer，所以正确的口径是「只有端点文件能出现域名」，
// 而不是「renderer 里不许出现域名」（那条第一天就会红）。
//
// 白名单不是空集：上传记录的外链（chart-projects 04 写下的 ProjectDetail.tsx 硬编码）
// 已在票 07 改道到 endpoints.ts 的 postUrl()，不是给断言开例外 —— 一开例外，
// 「唯一出口」这个可检验的含义就没了。
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readSource, readStripped, repoRoot } from '@/tests/support/source';

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
 * 唯一允许出现裸 fetch 的文件：键音采样加载。
 * `src/audio/KeySound.ts` 写明 `src` / `tierSrcs` 是 **Vite 内联 data-URI / 打包资源**，
 * 不是外域请求；这里连着断言它确实拿对象 URL / data-URI 喂 fetch。
 *
 * 2026-10 主分支把采样加载从 `AudioEngine` 的 private `loadSample` 抽成
 * `src/audio/keySoundSamples.ts` 的 `KeySoundSampleBank.load`（实时引擎与离线音轨共用一份），
 * 裸 fetch 随之搬家，这里跟着改指向。
 */
const LOCAL_FETCH_FILE = 'src/audio/keySoundSamples.ts';
/** 只有这些后缀参与扫描：src 下还有 .mp3 / .png 之类二进制，按文本读会误伤 */
const TEXT_EXT = /\.(ts|tsx|css|json)$/;

/** src 下的源码文本（原型页在扫，二进制不在） */
function sourceFiles(dir = 'src'): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(repoRoot, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(repoRoot, rel)).isDirectory()) out.push(...sourceFiles(rel));
    else if (TEXT_EXT.test(entry)) out.push(rel);
  }
  return out;
}

describe('bestdori-integration 07 · 域名白名单', () => {
  it('src 里只有端点文件出现 bestdori.com', () => {
    const offenders = sourceFiles().filter((rel) => rel !== WHITELIST && DOMAIN.test(readSource(rel)));
    expect(offenders).toEqual([]);
  });

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
    expect(sourceFiles().filter((rel) => XHR.test(readStripped(rel)))).toEqual([]);
  });

  it('裸 fetch 只出现在键音采样加载那一处（变量 URL 的绕道也逃不掉）', () => {
    const callers = sourceFiles().filter((rel) => BARE_FETCH.test(readStripped(rel)));
    expect(callers).toEqual([LOCAL_FETCH_FILE]);
    // 那一处的入参必须是本地资源（data-URI / object URL），不是拼出来的外域地址
    const sampleLoader = readStripped(LOCAL_FETCH_FILE);
    expect(sampleLoader).toMatch(/load\(src: string/);
    expect(sampleLoader).not.toMatch(/https?:\/\//);
  });

  it('CommunityTransport 的实现只有一个，就是走 IPC 那个', () => {
    const impls = sourceFiles().filter((rel) => TRANSPORT_IMPLEMENTS.test(readStripped(rel)));
    expect(impls).toEqual([TRANSPORT_IMPL]);
  });

  it('那个实现经 preload 的网络桥出去，自己不开 socket', () => {
    const impl = readStripped(TRANSPORT_IMPL);
    expect(impl).toMatch(/electronAPI/);
    expect(impl).toMatch(/communityNet/);
    expect(impl).not.toMatch(/WebSocket|EventSource|sendBeacon/);
  });
});
