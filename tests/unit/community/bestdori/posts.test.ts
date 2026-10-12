// bestdori-integration 09：社区帖能力（post/list · post/details · 帖内素材）。
//
// 锁测口径（票 09 + 2026-10-12 拍板）：
//   ① 内联 fixture：列表形状 → 中立「帖子候选」映射（llsif 帖与坏条目不产出）；
//   ② 会话内**页缓存**：同 query + offset 只发一次（含并发去重）；`force` 绕开（= 用户刷新）；
//   ③ `song.type` 两种分支各自产出正确的曲目来源（custom 按帖内 URL / bandori 记曲库 id）；
//   ④ 详情的 `chart` 数组 → 谱面代码原文（交给 Apply 闸门，这里不解析）；
//   ⑤ 帖内素材的 content-type 是 `application/octet-stream`（实测）—— 必须放行，只拦回退页。
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearPostPageCache,
  customAudioName,
  customAudioPreviewUrl,
  customCoverName,
  customCoverLocalUrl,
  customCoverThumbUrl,
  ensureCustomCoverCached,
  fetchCustomAudio,
  fetchCustomCover,
  fetchPostDetail,
  fetchPostPage,
  filterPostCandidates,
} from '@/src/community/bestdori/posts';
import { toPostCandidate, toPostPage, toPostDetail } from '@/src/community/bestdori/mapping';
import { isCommunityError, type StagedBinary } from '@/src/community/transport';
import { assetRawUrl, assetThumbUrl } from '@/src/community/assetUrls';
import { makeFakeCommunityTransport } from '@/tests/support/communityTransport';

const AUDIO_URL = 'https://bestdori.com/api/upload/file/d936a1';
const COVER_URL = 'https://bestdori.com/api/upload/file/247c2b';
const DETAIL_URL = 'https://bestdori.com/api/post/details?id=248468';
const LIST_URL = 'https://bestdori.com/api/post/list';

const STAGED_AUDIO: StagedBinary = { path: '/data/cache/community/aaa-audio', byteLength: 4_000_000, contentType: 'audio/mpeg' };
const STAGED_COVER: StagedBinary = { path: '/data/cache/community/bbb-cover', byteLength: 98_575, contentType: 'image/png' };
/** 站点对**自己的上传文件**回的泛型类型（2026-10-12 实测：封面 JPEG / 音频 mp3 都是这个头） */
const STAGED_OCTET: StagedBinary = { path: '/data/cache/community/ddd-octet', byteLength: 666_759, contentType: 'application/octet-stream' };
/** 平台对不存在的资源回 200 + SPA 回退页（约 14KB text/html） */
const FALLBACK: StagedBinary = { path: '/data/cache/community/ccc-fallback', byteLength: 14_084, contentType: 'text/html' };

afterEach(clearPostPageCache);

/** 列表响应的实测形状（docs/research/bestdori-api.md §2），混入三类坏条目 */
const LIST_PAGE = {
  result: true,
  count: 47920,
  posts: [
    {
      id: 248468, categoryName: 'SELF_POST', categoryId: 'chart',
      title: 'All You Wanted (GBP Edit)',
      song: { type: 'custom', audio: AUDIO_URL, cover: COVER_URL },
      artists: 'Michelle Branch', diff: 3, level: 24,
      content: [{ data: 'Notes: 413', type: 'text' }],
      time: 1789214607000,
      author: { username: 'envy09', nickname: 'Envy', titles: null },
      likes: 1, liked: false, tags: [],
    },
    {
      id: 258646, title: '纯粹交互练习',
      song: { type: 'bandori', id: 534 },
      artists: 'kkr', diff: 3, level: 35, time: 1791643163000,
      author: { username: 'chunbaishanshuo', nickname: '白', titles: null },
      likes: 0, liked: false, tags: [],
    },
    // llsif 帖：素材域在网关白名单之外，2026-10-12 拍板不产出候选
    { id: 258700, title: 'LLSIF 谱', song: { type: 'llsif', id: 12 }, artists: '', diff: 2, level: 20, author: null },
    // custom 缺 audio：不产出
    { id: 258701, title: '缺音频', song: { type: 'custom' }, artists: '', diff: 1, level: 10, author: null },
    // diff 越界：不产出
    { id: 258702, title: '坏难度', song: { type: 'custom', audio: AUDIO_URL }, artists: '', diff: 9, level: 10, author: null },
  ],
};

/** 详情响应：`chart` 数组 = 完整谱面代码 */
const DETAIL = {
  result: true,
  post: {
    ...LIST_PAGE.posts[0],
    chart: [
      { type: 'BPM', bpm: 185, beat: 0 },
      { type: 'Single', lane: 5, beat: 10 },
    ],
  },
};

function customPost() {
  const candidate = toPostCandidate(LIST_PAGE.posts[0]);
  if (!candidate) throw new Error('fixture 有问题');
  return candidate;
}

describe('票 09 · 列表 → 中立帖子候选', () => {
  it('llsif 帖与坏条目不产出；字段按帖子事实映射', () => {
    const page = toPostPage(LIST_PAGE);
    expect(page).not.toBeNull();
    expect(page!.total).toBe(47920);
    // rawCount 是原始条数（5 条），posts 只剩 2 条 —— 翻页游标按 rawCount 走
    expect(page!.rawCount).toBe(5);
    expect(page!.posts.map((post) => post.postId)).toEqual([248468, 258646]);

    const [custom, bandori] = page!.posts;
    expect(custom).toMatchObject({
      title: 'All You Wanted (GBP Edit)',
      charter: 'Envy',
      artists: 'Michelle Branch',
      diff: 3,
      level: 24,
      time: 1789214607000,
      song: { kind: 'custom', audioUrl: AUDIO_URL, coverUrl: COVER_URL },
    });
    expect(bandori).toMatchObject({ charter: '白', diff: 3, level: 35, song: { kind: 'bandori', songId: 534 } });
  });

  it('result:false / posts 缺失 → null（能力层翻成 invalid-response）', () => {
    expect(toPostPage({ result: false, code: 'REQUEST_INVALID' })).toBeNull();
    expect(toPostPage({ result: true })).toBeNull();
  });

  it('谱师展示名：nickname 优先，缺 nickname 退 username', () => {
    expect(toPostCandidate({ id: 1, song: { type: 'custom', audio: 'x' }, diff: 0, author: { username: 'u', nickname: 'n' } })?.charter).toBe('n');
    expect(toPostCandidate({ id: 1, song: { type: 'custom', audio: 'x' }, diff: 0, author: { username: 'u' } })?.charter).toBe('u');
  });
});

describe('票 09 · fetchPostPage（POST body 与分页口径）', () => {
  it('body 只含平台接受的合法字段，limit 钳在 10..50', async () => {
    const transport = makeFakeCommunityTransport({ json: { [LIST_URL]: LIST_PAGE } });

    const page = await fetchPostPage(transport, { query: 'gyari', offset: 20, limit: 100 });

    expect(page.total).toBe(47920);
    expect(page.posts).toHaveLength(2);
    const req = transport.requests[0];
    expect(req.method).toBe('POST');
    expect(req.url).toBe(LIST_URL);
    expect(JSON.parse(req.body ?? '{}')).toEqual({
      search: 'gyari',
      categoryName: 'SELF_POST',
      categoryId: 'chart',
      order: 'TIME_DESC',
      limit: 50,
      offset: 20,
    });
    // 深页不进跨会话缓存（offset 会随新帖插入漂移）；只有第一页声明 cacheable
    expect(req.cacheable).toBeUndefined();
  });

  it('第一页声明 cacheable（读型 POST 才允许落盘缓存，票 09 修订 07/14 口径；票 29 freshFirst）', async () => {
    const transport = makeFakeCommunityTransport({ json: { [LIST_URL]: LIST_PAGE } });

    await fetchPostPage(transport, { query: '', offset: 0 });

    expect(transport.requests[0].cacheable).toBe(true);
    expect(transport.requests[0].freshFirst).toBe(true);
    expect(transport.requests[0].revalidate).toBeUndefined();
  });

  it('result:false 翻成 invalid-response（body 里的未知字段会被平台拒）', async () => {
    const transport = makeFakeCommunityTransport({ json: { [LIST_URL]: { result: false, code: 'REQUEST_INVALID' } } });
    await expect(fetchPostPage(transport, { query: '', offset: 0 })).rejects.toMatchObject({ kind: 'invalid-response' });
  });
});

describe('票 09 · 详情与谱面代码原文', () => {
  it('chart 数组 → JSON 文本（Apply 闸门的入口形态），帖子字段一并映射', async () => {
    const transport = makeFakeCommunityTransport({ json: { [DETAIL_URL]: DETAIL } });

    const detail = await fetchPostDetail(transport, 248468);

    expect(detail.post.postId).toBe(248468);
    expect(detail.chartCodeText).toBe(JSON.stringify(DETAIL.post.chart));
  });

  it('chart 缺失 / post 缺失 → invalid-response', async () => {
    const transport = makeFakeCommunityTransport({
      json: { [DETAIL_URL]: { result: true, post: { ...DETAIL.post, chart: undefined } } },
    });
    await expect(fetchPostDetail(transport, 248468)).rejects.toMatchObject({ kind: 'invalid-response' });
  });

  it('票 27 · 真实平台 payload（post 对象无 id 字段）能通过 fallbackId 正常解析', () => {
    const { id: _ignoredId, ...postWithoutId } = DETAIL.post;
    const raw = { result: true, post: postWithoutId };
    const parsed = toPostDetail(raw, 248468);
    expect(parsed).not.toBeNull();
    expect(parsed!.post.postId).toBe(248468);
    expect(parsed!.chartCodeText).toBe(JSON.stringify(DETAIL.post.chart));
  });

  it('票 27 · fetchPostDetail 能正确解析真实平台 payload（post 对象无 id 字段）', async () => {
    const { id: _ignoredId, ...postWithoutId } = DETAIL.post;
    const transport = makeFakeCommunityTransport({
      json: { [DETAIL_URL]: { result: true, post: postWithoutId } },
    });
    const detail = await fetchPostDetail(transport, 248468);
    expect(detail.post.postId).toBe(248468);
    expect(detail.chartCodeText).toBe(JSON.stringify(DETAIL.post.chart));
  });
});

describe('票 09 · 帖内素材（custom 分支）', () => {
  it('音频 → 素材缓存路径；SPA 回退页判成响应非法', async () => {
    const ok = makeFakeCommunityTransport({ binary: { [AUDIO_URL]: STAGED_AUDIO } });
    await expect(fetchCustomAudio(ok, customPost())).resolves.toBe(STAGED_AUDIO);

    const fallback = makeFakeCommunityTransport({ binary: { [AUDIO_URL]: FALLBACK } });
    const error = await fetchCustomAudio(fallback, customPost()).catch((e: unknown) => e);
    expect(isCommunityError(error)).toBe(true);
    expect((error as { kind: string }).kind).toBe('invalid-response');
  });

  it('封面：帖子没给 coverUrl → null 不打请求；回退页 → null（不挡主线）', async () => {
    const noCoverPost = toPostCandidate({ ...LIST_PAGE.posts[0], song: { type: 'custom', audio: AUDIO_URL } });
    const noCover = makeFakeCommunityTransport({ binary: {} });
    await expect(fetchCustomCover(noCover, noCoverPost!)).resolves.toBeNull();
    expect(noCover.requests).toHaveLength(0);

    const ok = makeFakeCommunityTransport({ binary: { [COVER_URL]: STAGED_COVER } });
    await expect(fetchCustomCover(ok, customPost())).resolves.toBe(STAGED_COVER);

    const fallback = makeFakeCommunityTransport({ binary: { [COVER_URL]: FALLBACK } });
    await expect(fetchCustomCover(fallback, customPost())).resolves.toBeNull();
  });

  it('名字与预览 URL：帖内封面 / 音频的本机寻址（aao-asset://）', () => {
    const post = customPost();
    expect(customAudioName(post)).toBe('post-248468-audio.mp3');
    expect(customCoverName(post)).toBe('post-248468-cover.png');
    expect(customAudioPreviewUrl(post)).toBe(AUDIO_URL);
    expect(customCoverThumbUrl(post)).toBe(assetThumbUrl(COVER_URL));
    expect(customCoverLocalUrl(post)).toBe(assetRawUrl(COVER_URL));
  });

  it('ensureCustomCoverCached：失败回 null（背景取图不惊动界面）', async () => {
    const fallback = makeFakeCommunityTransport({ binary: { [COVER_URL]: FALLBACK } });
    await expect(ensureCustomCoverCached(fallback, customPost())).resolves.toBeNull();
  });

  // 实测：站点对自己的上传文件一律回 application/octet-stream（封面是 JPEG、音频是 mp3）——
  // 按 image/* 拦会让封面永不进缓存（缩略图退成图标、导入误报「未提供封面」）。
  it('octet-stream 的封面 / 音频照样收（只拦回退页 text/html）', async () => {
    const transport = makeFakeCommunityTransport({
      binary: { [COVER_URL]: STAGED_OCTET, [AUDIO_URL]: STAGED_OCTET },
    });
    await expect(fetchCustomCover(transport, customPost())).resolves.toBe(STAGED_OCTET);
    await expect(fetchCustomAudio(transport, customPost())).resolves.toBe(STAGED_OCTET);
  });
});

// 平台的 `search` 是服务端搜索（实测同时匹配标题与歌手、典型结果很小），而筛选条件拼不进
// 服务端请求（§2.2）—— 所以「搜索 + 客户端筛选」在常见查询下是完整的。
describe('票 09 · 客户端筛选（只作用于已加载的条目）', () => {
  const posts = () => toPostPage(LIST_PAGE)!.posts;

  it('按难度过滤（0..4）', () => {
    expect(filterPostCandidates(posts(), { diff: 3 }).map((p) => p.postId)).toEqual([248468, 258646]);
    expect(filterPostCandidates(posts(), { diff: 1 })).toEqual([]);
  });

  it('按等级窗过滤；帖子没填等级时不命中（无从判断）', () => {
    expect(filterPostCandidates(posts(), { levelMin: 30, levelMax: 35 }).map((p) => p.postId)).toEqual([258646]);
    const noLevel = toPostCandidate({ id: 9, song: { type: 'custom', audio: 'x' }, diff: 3 });
    expect(filterPostCandidates([noLevel!], { levelMin: 1, levelMax: 35 })).toEqual([]);
  });

  it('难度与等级叠加（AND）；窗口是成对边界（与选曲台同一契约）', () => {
    expect(filterPostCandidates(posts(), { diff: 3, levelMin: 30, levelMax: 35 }).map((p) => p.postId)).toEqual([258646]);
  });

  it('未指定等级窗时保留所有帖子（包括未填等级与超出 35 级的魔王谱）', () => {
    const noLevel = toPostCandidate({ id: 9, song: { type: 'custom', audio: 'x' }, diff: 3 });
    const over35 = toPostCandidate({ id: 10, song: { type: 'custom', audio: 'x' }, diff: 3, level: 38 });
    expect(filterPostCandidates([noLevel!, over35!], {})).toEqual([noLevel!, over35!]);
    expect(filterPostCandidates([noLevel!, over35!], { diff: 3, levelMin: undefined, levelMax: undefined })).toEqual([noLevel!, over35!]);
  });
});

describe('票 09 · 会话内页缓存（重复打开 / 改筛选不再重拉）', () => {
  it('同 query + offset 第二次直接吃缓存，一条请求都不发', async () => {
    const transport = makeFakeCommunityTransport({ json: { [LIST_URL]: LIST_PAGE } });

    const first = await fetchPostPage(transport, { query: 'gyari', offset: 0 });
    const second = await fetchPostPage(transport, { query: 'gyari', offset: 0 });

    expect(second).toBe(first);
    expect(transport.requests).toHaveLength(1);
  });

  it('并发同一页只发一次（inflight 去重）', async () => {
    const transport = makeFakeCommunityTransport({ json: { [LIST_URL]: LIST_PAGE } });

    const [a, b] = await Promise.all([
      fetchPostPage(transport, { query: '', offset: 50 }),
      fetchPostPage(transport, { query: '', offset: 50 }),
    ]);

    expect(a).toBe(b);
    expect(transport.requests).toHaveLength(1);
  });

  it('不同 offset / 不同 query 各算一页', async () => {
    const transport = makeFakeCommunityTransport({ json: { [LIST_URL]: LIST_PAGE } });

    await fetchPostPage(transport, { query: '', offset: 0 });
    await fetchPostPage(transport, { query: '', offset: 50 });
    await fetchPostPage(transport, { query: 'roki', offset: 0 });

    expect(transport.requests).toHaveLength(3);
  });

  it('force = 用户刷新：绕开缓存重拉，并让网关也重拉（revalidate）', async () => {
    const transport = makeFakeCommunityTransport({ json: { [LIST_URL]: LIST_PAGE } });
    await fetchPostPage(transport, { query: '', offset: 0 });

    await fetchPostPage(transport, { query: '', offset: 0, force: true });

    expect(transport.requests).toHaveLength(2);
    expect(transport.requests[1].revalidate).toBe(true);
  });

  it('clearPostPageCache：清掉后下一发又打网络', async () => {
    const transport = makeFakeCommunityTransport({ json: { [LIST_URL]: LIST_PAGE } });
    await fetchPostPage(transport, { query: '', offset: 0 });

    clearPostPageCache();
    await fetchPostPage(transport, { query: '', offset: 0 });

    expect(transport.requests).toHaveLength(2);
  });

  it('失败不进缓存：下一次照常重试', async () => {
    const transport = makeFakeCommunityTransport({ json: {} });
    await expect(fetchPostPage(transport, { query: '', offset: 0 })).rejects.toThrow();
    await expect(fetchPostPage(transport, { query: '', offset: 0 })).rejects.toThrow();
    expect(transport.requests).toHaveLength(2);
  });
});
