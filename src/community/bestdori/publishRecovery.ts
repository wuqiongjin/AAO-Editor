import type { CommunityTransport } from '../transport';
import type { PostDetail, PostSongRef } from './mapping';
import { fetchMyPostsPage, fetchPostDetail } from './posts';
import type { PostSongBody, PostTextTag } from './publish';

/** 帖子时间来自服务器，与客户端时钟可能有偏差。 */
const POST_TIME_TOLERANCE_MS = 5 * 60_000;

export interface PublishMatch {
  username: string;
  song: PostSongBody;
  chartDigest: string;
}

/** 比较谱面数组与对象成员的值，忽略 JSON 对象的键顺序。 */
export async function digestPublishedChart(chart: unknown): Promise<string> {
  const canonical = JSON.stringify(chart, (_key, value: unknown) => {
    if (!value || Array.isArray(value) || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function sameSong(expected: PostSongBody, remote: PostSongRef): boolean {
  return expected.type === 'bandori'
    ? remote.kind === 'bandori' && remote.songId === expected.id
    : remote.kind === 'custom' && remote.audioUrl === expected.audio;
}

export function sameCommunityAccount(left: string | null, right: string): boolean {
  return left !== null && left.toLowerCase() === right.toLowerCase();
}

export async function matchesPublishedPost(detail: PostDetail, expected: PublishMatch): Promise<boolean> {
  return sameCommunityAccount(detail.authorUsername, expected.username)
    && sameSong(expected.song, detail.post.song)
    && await digestPublishedChart(JSON.parse(detail.chartCodeText)) === expected.chartDigest;
}

export async function findPublishedPosts(
  transport: CommunityTransport,
  attempt: PublishMatch & { at: number },
): Promise<PostDetail[]> {
  const earliest = attempt.at - POST_TIME_TOLERANCE_MS;
  const latest = attempt.at + POST_TIME_TOLERANCE_MS;
  const ids = new Set<number>();
  let offset = 0;
  for (;;) {
    const page = await fetchMyPostsPage(transport, attempt.username, { offset, force: true });
    for (const post of page.posts) {
      if (post.time !== null && post.time >= earliest && post.time <= latest && sameSong(attempt.song, post.song)) {
        ids.add(post.postId);
      }
    }
    offset += page.rawCount;
    if (!page.rawCount || offset >= page.total || page.posts.some((post) => post.time !== null && post.time < earliest)) break;
  }
  const results: PostDetail[] = [];
  for (const id of ids) {
    const detail = await fetchPostDetail(transport, id, undefined, true);
    const at = detail.post.time;
    if (at !== null && at >= earliest && at <= latest && await matchesPublishedPost(detail, attempt)) {
      results.push(detail);
    }
  }
  return results;
}

export function samePublishedTags(submitted: readonly PostTextTag[], remote: readonly PostTextTag[]): boolean {
  const values = (tags: readonly PostTextTag[]) => [...new Set(tags.map(({ data }) => data.trim()))].sort();
  return JSON.stringify(values(submitted)) === JSON.stringify(values(remote));
}
