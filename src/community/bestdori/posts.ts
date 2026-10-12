/**
 * 社区帖能力（票 09；issue 06 能力 6–7）：帖子列表 / 搜索 / 分页、帖子详情（谱面代码）、
 * 帖内（custom）音频与封面的下载。
 *
 * 口径与 `songs.ts`（官方曲那条路）一致，三条贯穿：
 *   - **只递 HTTP 事实**：收发全交给注入的 `CommunityTransport`；退避重试只给幂等读用。
 *   - **谱面代码取原文**：详情里的 `chart` 数组经 `toPostDetail` 序列化成 JSON 文本，
 *     交给 Apply 闸门（ADR-0014），这里不解析、不校验。
 *   - **二进制只回缓存路径**：音频 / 封面由主进程落进素材缓存（票 14），这里只拿 `{ path }`。
 *
 * API 事实（docs/research/bestdori-api.md §2，实测）：
 *   - `post/list` 是 POST，body 合法字段只有 search / categoryName / categoryId / order /
 *     limit / offset（+ username）；limit 10..50。
 *   - 响应 `count` 是过滤后的总数，可直接当翻页终点（§2.1）。
 *   - 详情匿名可读，谱面帖多出 `chart` 字段 = 完整谱面代码数组。
 *   - 平台**没有**服务端等级 / 难度过滤字段（§2.2）—— 筛选只能在客户端做，且只作用于已加载的条目
 *     （搜索是服务端的，两者叠加见文件末尾「客户端过滤」一段）。
 *
 * 列表的两层缓存：
 *   - **会话内**：按 `查询 + offset` 缓存每一页（翻回去 / 重开弹窗零网络）；
 *   - **跨会话**：只有第一页走主进程的 json 档（24h + 先回旧的 + 后台补一枪）；
 *     深页**不落盘** —— offset 会随新帖插入整体漂移，跨会话拼两个时刻的快照会把页码语义搞烂。
 *   - 用户主动刷新走 `force`：绕开会话缓存，并让网关重拉（`revalidate`）。
 */
import { assetRawUrl, assetThumbUrl } from '../assetUrls';
import { withRetry, type RetryNotice } from '../rateLimit';
import { CommunityError, isCommunityError, type CommunityTransport, type StagedBinary } from '../transport';
import {
  BESTDORI_BINARY_TIMEOUT_MS,
  BESTDORI_COVER_TIMEOUT_MS,
  BESTDORI_JSON_TIMEOUT_MS,
  BESTDORI_RETRY_POLICY,
  bestdoriHeaders,
  isPlatformFallbackPage,
  postDetailUrl,
  postListUrl,
} from './endpoints';
import { toPostDetail, toPostPage, type PostCandidate } from './mapping';

function invalidResponse(message: string): CommunityError {
  return new CommunityError(message, { kind: 'invalid-response', message });
}

/** 单页上限（实测 10..50，按 50 拉：上拉加载少打几次请求） */
export const POST_PAGE_LIMIT = 50;
const POST_PAGE_LIMIT_MIN = 10;

export interface PostPageQuery {
  /** 关键字（服务端 search 字段；空串 = 不限） */
  query: string;
  offset: number;
  limit?: number;
  onRetry?: (notice: RetryNotice) => void;
  /**
   * 用户主动刷新：绕开会话内缓存，并让主业面网关**重拉**（`revalidate`，不吃 24h 的旧副本）。
   * 刷新失败由调用方保留旧数据（不弹错）。
   */
  force?: boolean;
}

/** 一页帖子候选；`total` 是平台侧过滤后的总数（翻页终点判断用它），`rawCount` 是本页原始条数（offset 游标，含被丢弃的条目） */
export interface PostPage {
  total: number;
  rawCount: number;
  posts: PostCandidate[];
}

/** 会话内页缓存（key = 查询 + offset）；同一页的并发只发一次，失败不缓存 */
const pageCache = new Map<string, PostPage>();
const pageInflight = new Map<string, Promise<PostPage>>();

function pageKey(query: string, offset: number): string {
  return `${query}\u0000${offset}`;
}

/** 测试与「刷新」用：清掉会话内页缓存 */
export function clearPostPageCache(): void {
  pageCache.clear();
  pageInflight.clear();
}

/** POST post/list 单页原语（列表 / 搜索 / 分页都走它）：会话内缓存 + inflight 去重 */
export async function fetchPostPage(
  transport: CommunityTransport,
  { query, offset, limit = POST_PAGE_LIMIT, onRetry, force = false }: PostPageQuery,
): Promise<PostPage> {
  const at = Math.max(0, Math.trunc(offset));
  const key = pageKey(query.trim(), at);
  if (!force) {
    const cached = pageCache.get(key);
    if (cached) return cached;
    const inflight = pageInflight.get(key);
    if (inflight) return inflight;
  }

  const pageLimit = Math.min(POST_PAGE_LIMIT, Math.max(POST_PAGE_LIMIT_MIN, limit));
  const body = JSON.stringify({
    search: query,
    categoryName: 'SELF_POST',
    categoryId: 'chart',
    order: 'TIME_DESC',
    limit: pageLimit,
    offset: at,
  });
  const promise = withRetry(
    () => transport.requestJson({
      url: postListUrl(),
      method: 'POST',
      headers: { ...bestdoriHeaders(), 'content-type': 'application/json' },
      body,
      timeoutMs: BESTDORI_JSON_TIMEOUT_MS,
      // 列表是**读型 POST**：第一页显式允许跨会话缓存（07/14 的口径是「POST 默认不缓存」，
      // 发帖 / 登录这类写请求不传这个标记，照旧直连）。
      // 票 29：第一页启动后首次拉取使用 freshFirst 穿透请求最新，网络失败自动回退磁盘缓存。
      // **深页不落盘**：offset 随新帖插入整体漂移，跨会话拼两个时刻的快照会把页码语义搞烂。
      ...(at === 0 ? { cacheable: true, freshFirst: true } : {}),
      ...(force ? { revalidate: true } : {}),
    }),
    { policy: BESTDORI_RETRY_POLICY, onRetry },
  ).then((raw) => {
    const page = toPostPage(raw);
    if (!page) throw invalidResponse('帖子列表不是预期形态');
    pageCache.set(key, page);
    return page;
  }).finally(() => {
    if (pageInflight.get(key) === promise) pageInflight.delete(key);
  });

  pageInflight.set(key, promise);
  return promise;
}

/** 帖子详情：候选 + 谱面代码原文（选中导入时才拉） */
export async function fetchPostDetail(
  transport: CommunityTransport,
  postId: number,
): Promise<{ post: PostCandidate; chartCodeText: string }> {
  const raw = await withRetry(
    () => transport.requestJson({
      url: postDetailUrl(postId),
      method: 'GET',
      headers: bestdoriHeaders(),
      timeoutMs: BESTDORI_JSON_TIMEOUT_MS,
    }),
    { policy: BESTDORI_RETRY_POLICY },
  );
  const detail = toPostDetail(raw, postId);
  if (!detail) throw invalidResponse(`社区帖详情不是预期形态（post ${postId}）`);
  return detail;
}

/* ---------------- 帖内（custom）音频与封面 ---------------- */

/**
 * 落进缓存的字节对不对得上要的东西。
 *
 * **帖内素材的 content-type 是 `application/octet-stream`**（2026-10-12 实测：custom 封面 666KB JPEG、
 * 音频 3.97MB mp3，站点都给这个头）—— 所以「认不出来的类型」一律放行，交给主进程的解码器
 * （`nativeImage.createFromBuffer` 嗅探魔数）判；只有**明说了不是**（SPA 回退页 text/html）才拦。
 * 官方素材那条路（songs.ts）的判定更严，因为那边平台给的就是 `image/png`。
 */
function looksLikeMedia(contentType: string | null, media: 'audio' | 'image'): boolean {
  // 不存在的资源回 200 + SPA 回退页（官方素材那条路同口径）：截到网页不是素材
  if (isPlatformFallbackPage(contentType)) return false;
  // 拿不到 / 泛型二进制：没信号 ≠ 不是素材，放行让解码器判
  if (contentType == null) return true;
  if (/^application\/octet-stream/i.test(contentType)) return true;
  if (media === 'image') return /^image\//i.test(contentType);
  return /^audio\//i.test(contentType);
}

async function fetchCustomMedia(
  transport: CommunityTransport,
  url: string,
  suggestedName: string,
  media: 'audio' | 'image',
  timeoutMs: number = BESTDORI_BINARY_TIMEOUT_MS,
): Promise<StagedBinary> {
  const staged = await withRetry(
    () => transport.requestBinary({
      url,
      method: 'GET',
      headers: bestdoriHeaders('*/*'),
      timeoutMs,
      suggestedName,
    }),
    { policy: BESTDORI_RETRY_POLICY },
  );
  if (!looksLikeMedia(staged.contentType, media)) {
    throw invalidResponse(`帖内素材取不到（拿到的不是${media === 'audio' ? '音频' : '图片'}）：${staged.contentType ?? '无 content-type'}`);
  }
  return staged;
}

/** 帖内音频 → 素材缓存（主线，取不到整笔失败；媒体判定在 fetchCustomMedia 一处做） */
export function fetchCustomAudio(transport: CommunityTransport, post: PostCandidate): Promise<StagedBinary> {
  if (post.song.kind !== 'custom') {
    return Promise.reject(invalidResponse(`帖子 ${post.postId} 不是 custom 曲目，没有帖内音频`));
  }
  return fetchCustomMedia(transport, post.song.audioUrl, customAudioName(post), 'audio');
}

/**
 * 帖内封面 → 素材缓存；帖子没给封面 / 取到的不是图片（SPA 回退页等）都回 **null**
 * （= 这次导入不带封面，同官方曲口径）。不抛错：封面缺失不挡「工程 + 音频 + 谱面」这条主线。
 */
export async function fetchCustomCover(
  transport: CommunityTransport,
  post: PostCandidate,
): Promise<StagedBinary | null> {
  if (post.song.kind !== 'custom' || post.song.coverUrl == null) return null;
  try {
    const staged = await fetchCustomMedia(transport, post.song.coverUrl, customCoverName(post), 'image');
    return staged;
  } catch (error) {
    if (isCommunityError(error) && error.kind === 'invalid-response') return null;
    throw error;
  }
}

/** 音频落进工程后记的名字：`post-248468-audio.mp3` */
export function customAudioName(post: PostCandidate): string {
  return `post-${post.postId}-audio.mp3`;
}

/** 封面落进工程后记的名字：`post-248468-cover.png` */
export function customCoverName(post: PostCandidate): string {
  return `post-${post.postId}-cover.png`;
}

/* ---------------- 帖内封面的预览与缓存（行内缩略图 / 预览大图） ----------------
 * 与官方封面同一套口径（songs.ts）：显示走媒体标签直链（不是「渲染进程直连」禁区），
 * 本机预览读素材缓存（aao-asset://）；后台经网关收进缓存 —— 命中零网络，导入也零下载。
 * ---------------------------------------------------------------------- */

/** 行内缩略图的本机 URL（未缓存协议 404 → 行内降级成直链） */
export function customCoverThumbUrl(post: PostCandidate): string {
  return post.song.kind === 'custom' && post.song.coverUrl != null
    ? assetThumbUrl(post.song.coverUrl)
    : '';
}

/** 预览区大图的本机 URL（未缓存 404 → 落回直链） */
export function customCoverLocalUrl(post: PostCandidate): string {
  return post.song.kind === 'custom' && post.song.coverUrl != null
    ? assetRawUrl(post.song.coverUrl)
    : '';
}

/** 试听的**直链**（帖内音频；`<audio>` 边下边播） */
export function customAudioPreviewUrl(post: PostCandidate): string {
  return post.song.kind === 'custom' ? post.song.audioUrl : '';
}

/** 试听的本机 URL（导入过才有缓存；未命中 404 → 落回直链） */
export function customAudioLocalUrl(post: PostCandidate): string {
  const url = customAudioPreviewUrl(post);
  return url === '' ? '' : assetRawUrl(url);
}

/** 同一帖子的「收封面进缓存」并发只发一次（同 songs.ts 的 coverInflight 口径） */
const coverInflight = new Map<number, Promise<StagedBinary | null>>();

/** 把帖内封面收进素材缓存（票 15/16 同款）：超时用封面那一档（30s，背景取图），失败回 null 不抛 */
export function ensureCustomCoverCached(
  transport: CommunityTransport,
  post: PostCandidate,
): Promise<StagedBinary | null> {
  if (post.song.kind !== 'custom' || post.song.coverUrl == null) return Promise.resolve(null);
  const inflight = coverInflight.get(post.postId);
  if (inflight) return inflight;
  const promise = fetchCustomMedia(transport, post.song.coverUrl, customCoverName(post), 'image', BESTDORI_COVER_TIMEOUT_MS)
    .catch(() => null)
    .finally(() => {
      if (coverInflight.get(post.postId) === promise) coverInflight.delete(post.postId);
    });
  coverInflight.set(post.postId, promise);
  return promise;
}

/* ---------------- 客户端过滤（§2.2：等级 / 难度没有服务端字段） ----------------
 * 为什么只能客户端筛、且**不做自动补扫**：
 *   - 筛选条件**拼不进服务端请求**（level / diff 一律 `REQUEST_INVALID`，§2.2 实测）；
 *   - 补扫按全库的命中率算太贵（Expert 33+ 命中 4% → 凑一屏 13 页 ≈ 34s），
 *     而平台的 `search` 是服务端的、典型结果很小（habit 4 / BLACK SHOUT 22 / roki 29 条），
 *     「搜索 + 筛选」在常见查询下本就完整 —— 所以范围交给界面明说，不替用户翻页。
 * ------------------------------------------------------------------------- */

/** 帖子列表的客户端筛选（与搜索叠加；只作用于**已加载**的帖子） */
export interface PostFilter {
  /** 必须是这个难度（0..4）；null / 省略 = 不限 */
  diff?: number | null;
  levelMin?: number;
  levelMax?: number;
}

export function filterPostCandidates(
  posts: readonly PostCandidate[],
  filter: PostFilter,
): PostCandidate[] {
  const hasLo = typeof filter.levelMin === 'number' && Number.isFinite(filter.levelMin);
  const hasHi = typeof filter.levelMax === 'number' && Number.isFinite(filter.levelMax);
  const lo = hasLo || hasHi
    ? Math.min(filter.levelMin ?? filter.levelMax as number, filter.levelMax ?? filter.levelMin as number)
    : null;
  const hi = lo == null
    ? null
    : Math.max(filter.levelMin ?? filter.levelMax as number, filter.levelMax ?? filter.levelMin as number);
  const needDiff = filter.diff ?? null;
  return posts.filter((post) => {
    if (needDiff != null && post.diff !== needDiff) return false;
    // 帖子没填等级时：窗口筛选无从判断，按「不命中」处理（与官方曲库那张等级表的读法一致）
    if (lo != null && hi != null && (post.level == null || post.level < lo || post.level > hi)) return false;
    return true;
  });
}
