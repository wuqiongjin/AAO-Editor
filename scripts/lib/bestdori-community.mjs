import { BASE_URL, die, fetchWithRetry, log } from './bestdori-http.mjs';

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
 * @param {string} id 社区帖 id
 */
export async function fetchCommunityPost(id) {
  const url = `${BASE_URL}/api/post/details?id=${encodeURIComponent(id)}`;
  log(`GET ${url}`);
  const res = await fetchWithRetry(url);
  if (!res.ok) die(`HTTP ${res.status}`);

  const text = await res.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    die('响应不是合法 JSON（疑似 SPA 回退页）');
  }

  if (payload?.result !== true) {
    die(`接口返回失败: code=${payload?.code ?? '(无 code)'} id=${id}`);
  }
  const post = payload.post;
  if (!post) die(`响应缺少 post 字段: id=${id}`);
  if (post.categoryId !== 'chart') {
    die(`id=${id} 不是谱面帖（categoryId=${post.categoryId}）`);
  }
  if (!Array.isArray(post.chart)) die(`post.chart 不是数组: id=${id}`);

  log(
    `标题: ${post.title ?? '(无标题)'} / diff=${post.diff} level=${post.level} / 共 ${post.chart.length} 个对象`,
  );
  return post;
}

/**
 * POST /api/post/list 关键字搜索社区谱（见 docs/research/bestdori-api.md §2）。
 *
 * @param {string} query
 * @param {{ limit?: number; order?: 'TIME_DESC' | 'TIME_ASC' }} [opts]
 */
export async function searchCommunityCharts(query, opts = {}) {
  const want = Math.max(1, opts.limit ?? 20);
  const order = opts.order ?? 'TIME_DESC';
  const pageSize = Math.min(100, Math.max(10, want));
  const results = [];
  let offset = 0;
  let total = Infinity;

  while (results.length < want && offset < total) {
    const url = `${BASE_URL}/api/post/list`;
    const body = {
      search: query,
      categoryName: 'SELF_POST',
      categoryId: 'chart',
      order,
      limit: pageSize,
      offset,
    };
    log(`POST ${url} search="${query}" offset=${offset} limit=${pageSize}`);
    const res = await fetchWithRetry(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) die(`HTTP ${res.status}`);
    const payload = JSON.parse(await res.text());
    if (payload?.result !== true) {
      die(`搜索失败: code=${payload?.code ?? '(无 code)'}`);
    }
    total = payload.count ?? 0;
    const posts = payload.posts ?? [];
    if (posts.length === 0) break;
    for (const post of posts) {
      results.push(summarizeCommunityPost(post));
      if (results.length >= want) break;
    }
    offset += posts.length;
    if (posts.length < pageSize) break;
  }

  return { query, total, count: results.length, results };
}
