import { webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toPostDetail } from '@/src/community/bestdori/mapping';
import {
  postDetailUrl,
  postListUrl,
  uploadedFileUrl,
} from '@/src/community/bestdori/endpoints';
import { clearPostPageCache } from '@/src/community/bestdori/posts';
import {
  digestPublishedChart,
  findPublishedPosts,
  matchesPublishedPost,
  sameCommunityAccount,
  samePublishedTags,
} from '@/src/community/bestdori/publishRecovery';
import { makeFakeCommunityTransport } from '@/tests/support/communityTransport';

afterEach(() => {
  clearPostPageCache();
  vi.unstubAllGlobals();
});

const AUDIO = uploadedFileUrl('d936a1');
const CHART = [{ type: 'BPM', beat: 0, bpm: 120 }, { type: 'Single', beat: 1, lane: 0 }];
const AT = 1_700_000_000_000;

function customPost(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: 'Custom',
    author: { username: 'author', nickname: 'Display' },
    diff: 3,
    level: 24,
    time: AT + 2_000,
    song: { type: 'custom', audio: AUDIO },
    chart: CHART,
    tags: [],
    ...overrides,
  };
}

describe('票 58 · 已发帖匹配', () => {
  it('自定义曲按上传音频地址对齐；谱面键顺序不同仍算同一份', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const digest = await digestPublishedChart([{ bpm: 120, type: 'BPM', beat: 0 }, { lane: 0, beat: 1, type: 'Single' }]);
    const expected = await digestPublishedChart(CHART);
    expect(digest).toBe(expected);
    const detail = toPostDetail({ result: true, post: customPost(267296) }, 267296);
    expect(detail).not.toBeNull();
    expect(await matchesPublishedPost(detail!, {
      username: 'Author',
      song: { type: 'custom', audio: AUDIO },
      chartDigest: expected,
    })).toBe(true);
    expect(sameCommunityAccount('author', 'AUTHOR')).toBe(true);
    expect(samePublishedTags([{ type: 'text', data: '韵律源点' }], [])).toBe(false);
  });

  it('findPublishedPosts：只收时间窗内、同一自定义音频且谱面一致的帖', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const listUrl = postListUrl();
    const transport = makeFakeCommunityTransport({
      json: {
        [listUrl]: {
          result: true,
          count: 2,
          posts: [
            customPost(267296),
            customPost(267297, { song: { type: 'custom', audio: uploadedFileUrl('other') } }),
          ],
        },
        [postDetailUrl(267296)]: { result: true, post: customPost(267296) },
      },
    });
    const matches = await findPublishedPosts(transport, {
      username: 'author',
      at: AT,
      song: { type: 'custom', audio: AUDIO },
      chartDigest: await digestPublishedChart(CHART),
    });
    expect(matches.map((item) => item.post.postId)).toEqual([267296]);
    expect(transport.requests.some((req) => req.url === postDetailUrl(267297))).toBe(false);
  });
});
