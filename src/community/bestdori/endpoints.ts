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
export const BESTDORI_USER_AGENT = 'aao-bestdori-client/1.0 (local chart editor; low-rate fetching)';

/** 单次超时：JSON 30s；二进制 120s（一首 4MB 级别的音频） */
export const BESTDORI_JSON_TIMEOUT_MS = 30_000;
export const BESTDORI_BINARY_TIMEOUT_MS = 120_000;
/**
 * 封面（几十 KB 的小图）单独一档：**列表背景取图**用它（票 17）。
 * 4MB 的音频值得等 120s，一张 98KB 的封面没必要 —— 卡住的链路要尽快把素材档的队位让出来，
 * 失败静默（下一轮进列表再试）；**导入路径仍用 120s**（那是用户主动发起、值得等）。
 */
export const BESTDORI_COVER_TIMEOUT_MS = 30_000;

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

/**
 * 官方难度的编号（0..4）。**与工程难度的编号同值**（`ChartDifficulty` 就是照官方编号定的），
 * 所以界面取 `DIFF_NAMES` / `DIFF_COLORS`、导入写 `ProjectChart.diff` 都用它 ——
 * 这张表只此一份，别再各写一张。
 */
export function officialDiffIndex(diff: OfficialDifficulty): number {
  return OFFICIAL_DIFFICULTIES.indexOf(diff);
}

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

/**
 * 乐队索引：官方曲的「歌手」只能从这里拿 —— 曲库条目与单曲详情**都没有 artist 字段**（2026-10-09 实测）。
 * `bandName` 与其它本地化字段同构（按服排列，含 null）。
 */
export function bandsIndexUrl(): string {
  return apiUrl('bands/all.1.json');
}

/** 单曲详情（`bgmId` / `bgmFile` / `jacketImage` …） */
export function songDetailUrl(songId: number | string): string {
  return apiUrl(`songs/${songId}.json`);
}

/** 官方谱面代码（返回的数组就是本编辑器的「谱面代码」格式，可直接导入） */
export function officialChartUrl(songId: number | string, diff: OfficialDifficulty): string {
  return apiUrl(`charts/${songId}/${diff}.json`);
}

/* ---------------- 官方素材（音频 / 封面） ---------------- */

/**
 * 素材服务器桶。**按曲挑**，不是固定值：合作曲只在首发服有素材 —— 实测 song 1004（`see_the_world_eng`）
 * 的封面包与 `bgm1004.mp3` 在 jp / tw / cn / kr 一律回 SPA 回退页，只有 en 有真文件（2026-10-09）。
 * 序列即偏好序：jp 最全，其余按发布广度递减。
 */
export const OFFICIAL_ASSET_SERVERS = ['jp', 'en', 'tw', 'cn', 'kr'] as const;
export type OfficialAssetServer = (typeof OFFICIAL_ASSET_SERVERS)[number];
export const DEFAULT_ASSET_SERVER: OfficialAssetServer = 'jp';

/** 官方完整音频（`bgmId` 形如 `bgm001`，取自 /api/songs/{id}.json；约 4MB 完整曲，非试听片段） */
export function officialAudioUrl(
  bgmId: string,
  server: OfficialAssetServer = DEFAULT_ASSET_SERVER,
): string {
  return `${BESTDORI_ORIGIN}/assets/${server}/sound/${bgmId}_rip/${bgmId}.mp3`;
}

/**
 * 专辑封面。分桶规则 `ceil(songId / 10) * 10`（2026-10-09 实测：song 1→10、29→30、100→100、500→500、822→830 命中真图，
 * 相邻桶一律回退页）；`jacketImage` 取自曲库索引条目的 `jacketImage[0]`。
 */
export function officialJacketUrl(
  songId: number,
  jacketImage: string,
  server: OfficialAssetServer = DEFAULT_ASSET_SERVER,
): string {
  const bucket = String(Math.ceil(songId / 10) * 10).padStart(2, '0');
  const file = `assets-star-forassetbundle-startapp-musicjacket-musicjacket${bucket}-${jacketImage}-jacket.png`;
  return `${BESTDORI_ORIGIN}/assets/${server}/musicjacket/musicjacket${bucket}_rip/${file}`;
}

/**
 * 不存在的资源回的是 **200 + SPA 回退页**（实测约 14KB `text/html`，站点对 404 页也回 200）。
 * 二进制落地 / 建工程之前必须认出来 —— 否则会把一张 HTML 页当成封面写进工程。
 */
export function isPlatformFallbackPage(contentType: string | null): boolean {
  return /text\/html/i.test(contentType ?? '');
}

/* ---------------- 账号与会话（票 10） ----------------
 * 事实依据：docs/research/bestdori-community-upload.md §2（2026-09-24 写路径实测）。
 * 登录成功 = HTTP 200 + `{"result":true}` + `Set-Cookie: token=…`（Cookie 名实测为 `token`）；
 * 失败 = HTTP 200 + `{"result":false,"code":"CREDENTIALS_INVALID"}`（网关按 code 翻成 unauthorized）。
 * Cookie 的解析 / 附着 / 持久化**全在主进程**（electron/communityCookies.cjs + communitySession.cjs），
 * 这里只有两个 URL —— renderer 经此走 transport，永远看不到 Cookie 的值（ADR-0011 §3 凭据红线）。
 * ------------------------------------------------------------------ */

/** 登录（POST JSON `{username, password}`）。**密码不落盘**：只活在这次请求的载荷里 */
export function userLoginUrl(): string {
  return apiUrl('user/login');
}

/** 当前用户（登录成功与启动时各校验一次；响应 `{result, username, nickname, titles, email, messageCount}`） */
export function userMeUrl(): string {
  return apiUrl('user/me');
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

/* ---------------- 发布：二进制上传三步 + 发帖（票 11） ----------------
 * 事实依据：docs/research/bestdori-community-upload.md §3–5（2026-09-24 写路径实测）。
 *   - 上传 = 发字节（音频 / 封面；谱面代码走发帖 body 内联，不走文件上传）；
 *     产物按内容寻址（SHA-1），已存在即 ALREADY_UPLOADED 可直接复用。
 *   - 发布 = 发帖（POST /api/post），产生帖子 id；谱面本体此后不可改（post/edit 没有 chart）。
 * 上传与发布的边界（issue 06 定案）：两步都是「写」，都不套退避重试 —— 超时意味着
 * 服务端可能已经收了（重发只会多造一份上传 / 多发一帖）。
 * ------------------------------------------------------------------ */

/** 上传协议版本（`upload/prepare` 的 `ver`；官网前端常量，实测未变） */
export const BESTDORI_UPLOAD_VER = 3;

/** 上传三步（Custom 曲目的音频 / 封面走这条；bandori / llsif 不上传） */
export function uploadPrepareUrl(): string {
  return apiUrl('upload/prepare');
}

/** multipart 上传（表单字段名固定 `file`，见 publish.ts 的 UPLOAD_FILE_FIELD） */
export function uploadUrl(): string {
  return apiUrl('upload');
}

/** 轮询上传状态（直到 `{"status":"available"}`；未就绪时帖子里引用它会 TEMPORARY_FILE） */
export function uploadStatusUrl(hash: string): string {
  return apiUrl(`upload/status/${hash}`);
}

/** 上传产物的引用地址（发帖时填进 `song.audio` / `song.cover`；匿名可下载） */
export function uploadedFileUrl(hash: string): string {
  return apiUrl(`upload/file/${hash}`);
}

/** 发帖（社区谱 = `SELF_POST` / `chart`）；成功回 `{"result":true,"id":<postId>}` */
export function postCreateUrl(): string {
  return apiUrl('post');
}

/** 发帖正文（`content`）的字符上限（前端 `userChartBody.length > 5000` → POST_INVALID） */
export const POST_CONTENT_MAX_CHARS = 5000;

/** 谱面等级合法区间（实测 `1` 可通过、`0` / `36` 为 POST_INVALID；区间外先拦） */
export const POST_LEVEL_MIN = 1;
export const POST_LEVEL_MAX = 35;

/* ---------------- 站外链接（票 39） ---------------- */

/**
 * 站点首页（票 39 Q42 / Q45 / Q47）：注册 / 找回密码那两枚入口的落点。
 *
 * 为什么都落首页：站点侧**没有**独立的 `login` / `signup` / `forgot` 页面 —— 三者是同一个
 * 弹窗里的按钮（2026-10-14 前端 bundle 实抓，见 `docs/research/bestdori-api.md` §3）。
 * 于是「注册」与「忘记密码」只能是「去站点首页，在那儿走站点自己的弹窗」，
 * 不存在更精确的深链（自造带查询参数的地址就是猜 URL）。
 *
 * 调用方拿到的是**完整 URL**，域名仍然只有这一处知道（票 07 的域名白名单锁测盯着它）；
 * 点开由 `../externalLink.ts` 经主进程开系统浏览器。
 */
export function siteHomeUrl(): string {
  return `${BESTDORI_ORIGIN}/`;
}
