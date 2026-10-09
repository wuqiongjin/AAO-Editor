/**
 * Bestdori 端点与网络口径常量 —— **全仓唯一允许出现社区平台域名的文件**（票 07 / issue 06 Q14 锁测）。
 *
 * 其它模块（能力层、界面）一律从这里拿 URL / UA / 超时 / 重试常量，不得自拼域名；
 * `tests/static/CommunityDomainWhitelist.test.ts` 会扫 `src/` 把这条钉住。
 *
 * 事实依据：`docs/research/bestdori-api.md`（只读端点）、`bestdori-community-upload.md`（写路径）。
 * 工程化口径参照 `scripts/lib/bestdori-http.mjs` —— 那份脚本 import 了 `node:fs` / `process`，
 * **只能作口径参照、不可复用**。
 *
 * 端点 / UA / 重试数值都住在这里，但**发请求的**是主进程网关（`electron/communityNet.cjs`）：
 * renderer 只把 URL 递过去，看不到 socket。主进程侧另有一份同值主机白名单（CJS 引不到 TS）。
 */
import type { RetryPolicy } from '../rateLimit';

/** 平台域名 / 源（唯一出口） */
export const BESTDORI_HOST = 'bestdori.com';
export const BESTDORI_ORIGIN = `https://${BESTDORI_HOST}`;

/** 自报身份：低速率、写清用途（照 scripts 口径） */
export const BESTDORI_USER_AGENT = 'tsugu-bestdori-client/1.0 (local chart editor; low-rate fetching)';

/** 单次超时：JSON 30s；二进制 120s（一首 4MB 级别的音频） */
export const BESTDORI_JSON_TIMEOUT_MS = 30_000;
export const BESTDORI_BINARY_TIMEOUT_MS = 120_000;

/** 退避重试：最多 3 次、800ms × 2^(n-1) + 抖动（算法见 ../rateLimit.ts） */
export const BESTDORI_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 800,
  jitterMs: 250,
};

/** 难度路径段（官方编号 0..4 = easy..special） */
export type OfficialDifficulty = 'easy' | 'normal' | 'hard' | 'expert' | 'special';

export const OFFICIAL_DIFFICULTIES: readonly OfficialDifficulty[] = [
  'easy',
  'normal',
  'hard',
  'expert',
  'special',
];

/** 一次平台请求的默认头（UA + Accept）；能力层拼请求时带上 */
export function bestdoriHeaders(accept = 'application/json'): Record<string, string> {
  return { 'user-agent': BESTDORI_USER_AGENT, accept };
}

function apiUrl(path: string): string {
  return `${BESTDORI_ORIGIN}/api/${path}`;
}

/** 全量曲库索引（08：一次拉全 + 本地索引做瞬时搜索） */
export function songsIndexUrl(): string {
  return apiUrl('songs/all.5.json');
}

/** 单曲详情（`bgmId` / `bgmFile` / `jacketImage` …） */
export function songDetailUrl(songId: number | string): string {
  return apiUrl(`songs/${songId}.json`);
}

/** 官方谱面代码（返回的数组就是本编辑器的「谱面代码」格式，可直接导入） */
export function officialChartUrl(songId: number | string, diff: OfficialDifficulty): string {
  return apiUrl(`charts/${songId}/${diff}.json`);
}

/** 社区帖列表 / 搜索 / 分页（POST；body 约束见 docs/research/bestdori-api.md §2） */
export function postListUrl(): string {
  return apiUrl('post/list');
}

/** 社区帖详情（匿名可读；谱面帖多出 `chart` 字段 = 完整谱面代码） */
export function postDetailUrl(postId: number): string {
  return apiUrl(`post/details?id=${postId}`);
}

/** 帖子的**页面**地址（浏览用，不是 API）：上传记录的外链引用它（票 07 把既有硬编码收到这里） */
export function postUrl(postId: number): string {
  return `${BESTDORI_ORIGIN}/community/charts/${postId}`;
}
