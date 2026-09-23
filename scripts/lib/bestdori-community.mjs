import { BASE_URL, die, fetchText, fetchWithRetry, log } from './bestdori-http.mjs';

/** 社区谱 `post.diff` 与 Bestdori 前端一致：0..4 */
export const COMMUNITY_DIFF_LABELS = ['Easy', 'Normal', 'Hard', 'Expert', 'Special'];

/**
 * @param {number | undefined} diff
 */
export function formatCommunityDiff(diff) {
  if (diff == null || diff < 0 || diff > 4) return String(diff ?? '?');
  return COMMUNITY_DIFF_LABELS[diff] ?? String(diff);
}

/**
 * @param {number | undefined} ms
 */
export function formatPublishedAt(ms) {
  if (ms == null || !Number.isFinite(ms)) return '';
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * @param {Record<string, unknown>} post post/list 或 post/details 的 post 对象
 */
export function summarizeCommunityPost(post) {
  const author = post.author;
  const authorName =
    (author && (author.nickname || author.username)) || '(未知作者)';
  return {
    postId: post.id,
    title: post.title ?? '',
    artists: post.artists ?? '',
    author: authorName,
    authorUsername: author?.username ?? '',
    publishedAt: formatPublishedAt(post.time),
    publishedAtMs: post.time ?? null,
    diff: post.diff ?? null,
    diffLabel: formatCommunityDiff(post.diff),
    level: post.level ?? null,
    likes: post.likes ?? 0,
    songType: post.song?.type ?? '',
    bandoriSongId: post.song?.type === 'bandori' ? post.song.id : null,
  };
}

/**
 * 取社区帖详情。返回 { text, post }：text 是**原始响应字节**（批量抓取按字节落盘用），
 * post 是解析后的帖子对象。
 *
 * 注意：谱面本体（post.chart）发布后不可再编辑（/api/post/edit 的 body 里没有 chart 字段），
 * 所以 text 可以安全缓存；但 level / diff / rating / tags / likes 可被作者事后修改，
 * 缓存里的这些元数据只是抓取时刻的快照。
 *
 * @param {string} id 社区帖 id
 */
export async function fetchCommunityPostPayload(id, opts = {}) {
  const fatal = opts.fatal !== false;
  const fail = (msg) => {
    if (fatal) die(msg);
    throw new Error(msg);
  };
  const url = `${BASE_URL}/api/post/details?id=${encodeURIComponent(id)}`;
  log(`GET ${url}`);
  const text = await fetchText(url, { timeoutMs: 60_000, fatal });

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    fail('响应不是合法 JSON（疑似 SPA 回退页）');
  }

  if (payload?.result !== true) {
    fail(`接口返回失败: code=${payload?.code ?? '(无 code)'} id=${id}`);
  }
  const post = payload.post;
  if (!post) fail(`响应缺少 post 字段: id=${id}`);
  if (post.categoryId !== 'chart') {
    fail(`id=${id} 不是谱面帖（categoryId=${post.categoryId}）`);
  }
  if (!Array.isArray(post.chart)) fail(`post.chart 不是数组: id=${id}`);

  log(
    `标题: ${post.title ?? '(无标题)'} / diff=${post.diff} level=${post.level} / 共 ${post.chart.length} 个对象`,
  );
  return { text, post };
}

/**
 * @param {string} id 社区帖 id
 */
export async function fetchCommunityPost(id) {
  return (await fetchCommunityPostPayload(id)).post;
}

/** post/list 的 limit 实测合法区间 10..50（9 / 51 / 100 都 REQUEST_INVALID）。 */
const PAGE_MAX = 50;

/** 客户端过滤时最多扫多少条帖子（防止在全库 4.7 万条上无限翻页）。 */
const DEFAULT_SCAN_LIMIT = 5000;

/** 把 limit 归一成正整数或 Infinity（'all' = 翻完所有页）。 */
function normalizeLimit(limit) {
  if (limit == null) return 20;
  if (limit === 'all' || limit === Infinity) return Infinity;
  const n = Number(limit);
  if (!Number.isInteger(n) || n < 1) die('limit 需要正整数或 "all"');
  return n;
}

/**
 * POST /api/post/list 单页原语：返回**原始** posts（不做摘要），offset 由调用方控制。
 * 所有 post/list 请求都走这里（搜索 CLI、按谱师列出、corpus 分层抽样）。
 *
 * @param {{
 *   search?: string;
 *   username?: string;
 *   order?: 'TIME_DESC' | 'TIME_ASC';
 *   offset?: number;
 *   limit?: number;
 * }} [opts]
 * @returns {Promise<{ total: number; posts: any[] }>} total 是**过滤后**的总数
 */
export async function listCommunityPostsPage(opts = {}) {
  const username = String(opts.username ?? '').trim();
  const limit = Math.min(PAGE_MAX, Math.max(10, opts.limit ?? PAGE_MAX));
  const offset = Math.max(0, opts.offset ?? 0);
  const body = {
    search: opts.search ?? '',
    categoryName: 'SELF_POST',
    categoryId: 'chart',
    order: opts.order ?? 'TIME_DESC',
    limit,
    offset,
  };
  if (username) body.username = username;

  const url = `${BASE_URL}/api/post/list`;
  log(
    `POST ${url} ${username ? `@${username}` : `"${opts.search ?? ''}"`} offset=${offset} limit=${limit}`,
  );
  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) die(`HTTP ${res.status}`);
  const payload = JSON.parse(await res.text());
  if (payload?.result !== true) {
    die(
      `列表失败: code=${payload?.code ?? '(无 code)'}` +
        (username ? '（username 必须是账号名，昵称会 REQUEST_INVALID）' : ''),
    );
  }
  return { total: payload.count ?? 0, posts: payload.posts ?? [] };
}

/**
 * 客户端过滤条件。
 *
 * 为什么只能客户端过滤：post/list **没有任何服务端等级/难度过滤字段** —— 实测
 * level / minLevel / maxLevel / levelMin / levels / minLv / diff / difficulty / rating / tags
 * 全部返回 REQUEST_INVALID（未知字段会被拒，这本身就是可靠的探测方式）；
 * order 也只认 TIME_DESC / TIME_ASC（LEVEL_DESC 等同样被拒）；
 * /api/post/tag?type=level 返回空数组。见 docs/research/bestdori-api.md §2.2。
 *
 * 因此带过滤时会一直翻页直到凑满 want 条（或翻完 total / 触及 scanLimit）。
 * 按谱师（username）场景本来就要翻完其全部作品，本地筛是**精确**的；
 * 全库/关键字场景则可能要扫很多页，用 scanLimit 兜底。
 *
 * @param {{ minLevel?: number; maxLevel?: number; diff?: number[] }} filter
 */
function makePostFilter(filter = {}) {
  const { minLevel, maxLevel, diff } = filter;
  const diffs = diff && diff.length ? new Set(diff) : null;
  const active = minLevel != null || maxLevel != null || diffs;
  return {
    active,
    test: (summary) =>
      (minLevel == null || (summary.level ?? -Infinity) >= minLevel) &&
      (maxLevel == null || (summary.level ?? Infinity) <= maxLevel) &&
      (!diffs || diffs.has(summary.diff)),
  };
}

/**
 * 把难度过滤值（'expert' / 3 / ['expert','special']）归一成 post.diff 的数字集合。
 * @param {string | number | Array<string | number> | undefined} raw
 */
export function normalizeDiffFilter(raw) {
  if (raw == null || raw === '') return [];
  const list = Array.isArray(raw) ? raw : String(raw).split(',');
  const out = [];
  for (const item of list) {
    const v = String(item).trim().toLowerCase();
    if (!v) continue;
    const idx = COMMUNITY_DIFF_LABELS.findIndex((label) => label.toLowerCase() === v);
    const n = idx >= 0 ? idx : Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 4) {
      die(`未知难度 "${item}"（可用：${COMMUNITY_DIFF_LABELS.join(' | ')} 或 0–4）`);
    }
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

/**
 * POST /api/post/list 社区谱列表（见 docs/research/bestdori-api.md §2）。
 * 用法：关键字搜索、按谱师列出、两者 AND 组合，再叠加客户端的等级/难度过滤。
 *
 * @param {string} query 关键字；空串 = 不过滤关键字（配合 username 列出某谱师全部作品）
 * @param {{
 *   limit?: number | 'all';
 *   order?: 'TIME_DESC' | 'TIME_ASC';
 *   username?: string;
 *   minLevel?: number;
 *   maxLevel?: number;
 *   diff?: number[];
 *   scanLimit?: number;
 * }} [opts] username 是谱师**账号名**（大小写不敏感），昵称无效
 */
export async function searchCommunityCharts(query, opts = {}) {
  const want = normalizeLimit(opts.limit);
  const username = String(opts.username ?? '').trim();
  if (username && /[^\x20-\x7e]/.test(username)) {
    log(
      `注意: username「${username}」含非 ASCII 字符；Bestdori 只按账号名匹配，昵称（nickname）无效`,
    );
  }
  const filter = makePostFilter({
    minLevel: opts.minLevel,
    maxLevel: opts.maxLevel,
    diff: opts.diff,
  });
  const scanLimit = opts.scanLimit ?? DEFAULT_SCAN_LIMIT;
  const pageSize = Math.min(PAGE_MAX, Math.max(10, want));
  const results = [];
  let offset = 0;
  let total = Infinity;
  let scanned = 0;
  let truncated = false;

  while (results.length < want && offset < total) {
    const page = await listCommunityPostsPage({
      search: query,
      username,
      order: opts.order,
      offset,
      limit: pageSize,
    });
    total = page.total;
    scanned += page.posts.length;
    for (const post of page.posts) {
      const summary = summarizeCommunityPost(post);
      if (filter.active && !filter.test(summary)) continue;
      results.push(summary);
      if (results.length >= want) break;
    }
    offset += page.posts.length;
    if (page.posts.length === 0 || page.posts.length < pageSize) break;
    if (filter.active && scanned >= scanLimit) {
      truncated = true;
      log(
        `提示: 已扫描 ${scanned} 条只筛出 ${results.length} 条（scanLimit=${scanLimit}），结果不完整；` +
          `加大 --scan-limit 可继续翻`,
      );
      break;
    }
  }

  return {
    query,
    username,
    filter: { minLevel: opts.minLevel ?? null, maxLevel: opts.maxLevel ?? null, diff: opts.diff ?? [] },
    total,
    scanned,
    truncated,
    count: results.length,
    results,
  };
}

/**
 * 列出某谱师创作的全部社区谱（按 username 过滤，默认翻完所有页）。
 * 只给清单（postId 等），谱面本体要再按 postId 取详情。
 *
 * @param {string} username 谱师账号名
 * @param {{ limit?: number | 'all'; order?: 'TIME_DESC' | 'TIME_ASC'; search?: string }} [opts]
 */
export function describeFilter(filter) {
  if (!filter) return '';
  const parts = [];
  if (filter.minLevel != null) parts.push(`lv≥${filter.minLevel}`);
  if (filter.maxLevel != null) parts.push(`lv≤${filter.maxLevel}`);
  for (const d of filter.diff ?? []) {
    parts.push(COMMUNITY_DIFF_LABELS[d] ?? `diff${d}`);
  }
  return parts.join(' + ');
}

export async function listChartsByAuthor(username, opts = {}) {
  if (!username) die('listChartsByAuthor 需要 username（谱师账号名，不是昵称）');
  return searchCommunityCharts(opts.search ?? '', {
    ...opts,
    username,
    limit: opts.limit ?? 'all',
  });
}
