// 票 08：官方曲库能力（能力 1–5）与官方曲的中立映射。
// 惯例照 tests/unit/upload/bestdori/sanitizeChart.test.ts：内联 fixture + 手写假出口，全仓无 msw / vi.mock。
import { afterEach, describe, expect, it } from 'vitest';
import { isCommunityError } from '@/src/community/transport';
import {
  audioFileName,
  audioLocalUrl,
  audioPreviewUrl,
  clearSongCatalogCache,
  coverFileName,
  DEFAULT_SONG_SORT_DIRECTION,
  DEFAULT_SONG_SORT_KEY,
  fetchOfficialAudio,
  fetchOfficialChartText,
  fetchOfficialCover,
  fetchSongCatalog,
  fetchSongDetail,
  jacketLocalUrl,
  jacketPreviewUrl,
  catalogBandOptions,
  filterSongCandidates,
  promoteIdMatches,
  refreshSongCatalog,
  searchSongCandidates,
  SONG_SORT_KEYS,
  SONG_SORT_NATURAL_DIR,
  sortSongCandidates,
} from '@/src/community/bestdori/songs';
import { earliestPublishedAt, toSongCandidates } from '@/src/community/bestdori/mapping';
import type { SongCandidate } from '@/src/community/bestdori/mapping';
import { assetRawUrl } from '@/src/community/assetUrls';
import { makeFakeCommunityTransport as fakeTransport } from '@/tests/support/communityTransport';

/** 曲库条目（形状照 docs/research/bestdori-api.md §1；`musicTitle` 的服序 = [jp, en, tw, cn, kr]） */
const SONGS_INDEX = {
  '1': {
    tag: 'normal',
    bandId: 1,
    jacketImage: ['yes_bang_dream'],
    musicTitle: ['Yes! BanG_Dream!', 'Yes! BanG_Dream!', 'Yes！', '是！'],
    publishedAt: ['1462071600000', '1462104000000', null, null],
    difficulty: {
      0: { playLevel: 5 },
      1: { playLevel: 10 },
      2: { playLevel: 17 },
      3: { playLevel: 22 },
    },
  },
  // 合作曲：只在 en 服发布（素材也只在 en）——测服务器按曲挑
  '1004': {
    tag: 'collabo',
    bandId: 1004,
    jacketImage: ['1004_see_the_world_eng'],
    musicTitle: [null, 'See the world', null, null],
    publishedAt: [null, '1681545600000', null, null],
    difficulty: { 3: { playLevel: 24 }, 4: { playLevel: 28 } },
  },
  // 坏条目：一个语言的标题都没有 → 不产出候选
  '999': { tag: 'normal', bandId: 1, jacketImage: ['x'], musicTitle: [null], publishedAt: [], difficulty: {} },
};

const BANDS_INDEX = {
  '1': { bandName: ["Poppin'Party", "Poppin'Party", '咚啪啪', '啵啪啪'] },
  '1004': { bandName: [null, 'IRyS', null, null] },
};

function candidate(id: number, language: 'zh-CN' | 'en' = 'zh-CN'): SongCandidate {
  const found = toSongCandidates(SONGS_INDEX, BANDS_INDEX, language).find((song) => song.id === id);
  if (!found) throw new Error(`fixture 里没有 song ${id}`);
  return found;
}

/** 平台对不存在的资源回 200 + SPA 回退页 */
const FALLBACK = { path: '/data/downloads/abc-jacket.png', byteLength: 14084, contentType: 'text/html' };
const REAL_AUDIO = { path: '/data/downloads/abc-bgm001.mp3', byteLength: 4_000_000, contentType: 'audio/mpeg' };

describe('票 08 · 曲库条目 → 中立曲目候选', () => {
  it('标题取当前界面语言、歌手取乐队名、封面与难度表一起映射', () => {
    const song = candidate(1);

    expect(song).toEqual({
      id: 1,
      bandId: 1,
      title: '是！',
      artist: '啵啪啪',
      jacketImage: 'yes_bang_dream',
      server: 'jp',
      difficulties: [
        { diff: 'easy', level: 5 },
        { diff: 'normal', level: 10 },
        { diff: 'hard', level: 17 },
        { diff: 'expert', level: 22 },
      ],
      // 票 31：发布时间同时进候选（取各服里最早的那个，上面两条都是日服的串）
      publishedAt: 1462071600000,
    });
  });

  it('简中取 index 3（服序 [jp, en, tw, cn, kr]）；en 走英文；缺本地化时退日文原名', () => {
    expect(candidate(1, 'en')).toMatchObject({ title: 'Yes! BanG_Dream!', artist: "Poppin'Party" });
    // 1004 只有英文名：简中也退到英文（繁中 / 日文都没有）
    expect(candidate(1004).title).toBe('See the world');
  });

  it('Special 不存在时不产出该难度条目（出现的键才算实装）', () => {
    expect(candidate(1).difficulties.map((d) => d.diff)).toEqual(['easy', 'normal', 'hard', 'expert']);
    expect(candidate(1004).difficulties.map((d) => d.diff)).toEqual(['expert', 'special']);
  });

  it('素材服务器按发布记录挑：只在 en 发布的合作曲走 en（jp / tw / cn / kr 都没有它的素材）', () => {
    expect(candidate(1004).server).toBe('en');
  });

  // 票 31：排序要「什么时候上的」，与素材服是两个问题（合作曲 1004 的素材只在 en，但发布时间也在 en）
  it('发布时间取各服里最早的那个；一条记录都没有（或全坏）回 null', () => {
    expect(candidate(1).publishedAt).toBe(1462071600000);
    expect(candidate(1004).publishedAt).toBe(1681545600000);
    expect(earliestPublishedAt([])).toBeNull();
    expect(earliestPublishedAt(undefined)).toBeNull();
  });

  it('坏时间戳兜底：空串 / 0 / 负数 / 非数字串一律跳过，只看有效的那些', () => {
    expect(earliestPublishedAt(['', '0', 0, -1, 'abc', null, '1700000000000'])).toBe(1700000000000);
    expect(earliestPublishedAt([0, null, '  ', 'NaN'])).toBeNull();
    // 数字与数字串混排时也按数值取最小（平台两种形态都出现过）
    expect(earliestPublishedAt([1700000000000, '1690000000000'])).toBe(1690000000000);
  });

  it('一个语言的标题都没有的条目直接不产出（宁缺勿造）', () => {
    expect(toSongCandidates(SONGS_INDEX, BANDS_INDEX, 'zh-CN').map((s) => s.id)).toEqual([1, 1004]);
  });
});

describe('票 08 · 本地搜索', () => {
  const all = toSongCandidates(SONGS_INDEX, BANDS_INDEX, 'zh-CN');

  it('命中标题', () => {
    expect(searchSongCandidates(all, 'see the').map((s) => s.id)).toEqual([1004]);
  });

  it('命中歌手（大小写不敏感）', () => {
    expect(searchSongCandidates(all, 'IRYS').map((s) => s.id)).toEqual([1004]);
  });

  it('空查询 = 全部；查不到 = 空', () => {
    expect(searchSongCandidates(all, '  ')).toHaveLength(2);
    expect(searchSongCandidates(all, '不存在的曲子')).toEqual([]);
  });
});

describe('票 13 · 曲库筛选（乐队 / 难度 / 等级）', () => {
  const all = toSongCandidates(SONGS_INDEX, BANDS_INDEX, 'zh-CN');

  it('按 bandId 筛，不按歌手显示名糊掉', () => {
    expect(filterSongCandidates(all, { bandId: 1 }).map((s) => s.id)).toEqual([1]);
    expect(filterSongCandidates(all, { bandId: 1004 }).map((s) => s.id)).toEqual([1004]);
  });

  it('必须已实装某难度：没 Special 的歌出局', () => {
    expect(filterSongCandidates(all, { difficulty: 'special' }).map((s) => s.id)).toEqual([1004]);
  });

  it('等级范围按左右填的数值 min/max，填反也能筛；不硬夹 1–35', () => {
    expect(filterSongCandidates(all, { levelMin: 28, levelMax: 30 }).map((s) => s.id)).toEqual([1004]);
    expect(filterSongCandidates(all, { levelMin: 30, levelMax: 28 }).map((s) => s.id)).toEqual([1004]);
    expect(filterSongCandidates(all, { levelMin: 0, levelMax: 6 }).map((s) => s.id)).toEqual([1]);
  });

  it('指定难度时，等级只看那一张', () => {
    expect(filterSongCandidates(all, { difficulty: 'expert', levelMin: 24, levelMax: 24 }).map((s) => s.id)).toEqual([1004]);
    expect(filterSongCandidates(all, { difficulty: 'easy', levelMin: 24, levelMax: 24 })).toEqual([]);
  });

  it('查询与筛选叠加', () => {
    expect(filterSongCandidates(all, { query: 'see', bandId: 1 })).toEqual([]);
    expect(filterSongCandidates(all, { query: 'see', difficulty: 'special' }).map((s) => s.id)).toEqual([1004]);
  });

  it('乐队下拉按 id 去重、按显示名排序', () => {
    expect(catalogBandOptions(all)).toEqual([
      { id: 1004, name: 'IRyS' },
      { id: 1, name: '啵啪啪' },
    ]);
  });
});

/** 票 31 / 33 用例的语料：只关心 id / 曲名 / 乐队 / 发布时间四样 */
function song(id: number, title: string, artist: string, publishedAt: number | null): SongCandidate {
  return { id, bandId: 1, title, artist, jacketImage: `j${id}`, server: 'jp', difficulties: [], publishedAt };
}

describe('票 31 · 官方歌曲列表排序', () => {
  const all = [
    song(29, 'BLACK SHOUT', 'Roselia', 1500000000000),
    song(1, 'Yes! BanG_Dream!', "Poppin'Party", 1462071600000),
    song(291, 'A to Z', 'Roselia', null),
    song(1004, 'See the world', 'IRyS', 1681545600000),
  ];

  it('键与方向的白名单 / 默认值（默认 = 发布时间降序）', () => {
    expect(SONG_SORT_KEYS).toEqual(['publishedAt', 'id', 'title', 'artist']);
    expect(DEFAULT_SONG_SORT_KEY).toBe('publishedAt');
    expect(DEFAULT_SONG_SORT_DIRECTION).toBe('desc');
    // 每个键的自然方向：发布时间新在前，其余小→大 / A→Z（切键时用它，不是沿用上一把键的方向）
    expect(SONG_SORT_NATURAL_DIR).toEqual({ publishedAt: 'desc', id: 'asc', title: 'asc', artist: 'asc' });
  });

  it('发布时间降序（最新在最前）；null 排最后；同键并列回退 id 升序', () => {
    expect(sortSongCandidates(all, 'publishedAt').map((s) => s.id)).toEqual([1004, 29, 1, 291]);

    const sameTime = [
      song(30, 'b', 'X', 1700000000000),
      song(7, 'a', 'Y', 1700000000000),
      song(7 + 1, 'c', 'Z', 1700000000000),
    ];
    expect(sortSongCandidates(sameTime, 'publishedAt').map((s) => s.id)).toEqual([7, 8, 30]);
  });

  it('省略方向 = 该键的自然方向：id / 曲名 / 乐队名都升序（并列都回退 id）', () => {
    expect(sortSongCandidates(all, 'id').map((s) => s.id)).toEqual([1, 29, 291, 1004]);
    expect(sortSongCandidates(all, 'title').map((s) => s.title)).toEqual([
      'A to Z', 'BLACK SHOUT', 'See the world', 'Yes! BanG_Dream!',
    ]);
    expect(sortSongCandidates(all, 'artist').map((s) => s.id)).toEqual([1004, 1, 29, 291]);
  });

  it('方向可切：同一把键给出互反的顺序（发布时间升序 = 最老在最前，null 仍垫底）', () => {
    expect(sortSongCandidates(all, 'id', 'desc').map((s) => s.id)).toEqual([1004, 291, 29, 1]);
    expect(sortSongCandidates(all, 'title', 'desc').map((s) => s.title)).toEqual([
      'Yes! BanG_Dream!', 'See the world', 'BLACK SHOUT', 'A to Z',
    ]);
    expect(sortSongCandidates(all, 'publishedAt', 'asc').map((s) => s.id)).toEqual([1, 29, 1004, 291]);
  });

  it('不改原数组（面板的 filtered 是派生值，曲库缓存那份不许被排乱）', () => {
    const before = all.map((s) => s.id);
    const sorted = sortSongCandidates(all, 'id');
    expect(all.map((s) => s.id)).toEqual(before);
    expect(sorted).not.toBe(all);
  });
});

describe('票 33 · 纯数字查询按曲库 id 搜（命中置顶）', () => {
  const all = [
    song(29, 'BLACK SHOUT', 'Roselia', null),
    song(291, 'A to Z', 'Roselia', null),
    song(1, 'Yes! BanG_Dream!', "Poppin'Party", null),
    song(1004, '1004', 'IRyS', null),
  ];

  it('纯数字按 songId 前缀匹配（与曲名 / 乐队匹配叠加，零网络）', () => {
    expect(filterSongCandidates(all, { query: '29' }).map((s) => s.id)).toEqual([29, 291]);
    expect(filterSongCandidates(all, { query: '2' }).map((s) => s.id)).toEqual([29, 291]);
    expect(filterSongCandidates(all, { query: '100' }).map((s) => s.id)).toEqual([1004]);
    // 非数字查询照旧只认曲名 / 乐队，不拿 id 去凑
    expect(filterSongCandidates(all, { query: 'Roselia' }).map((s) => s.id)).toEqual([29, 291]);
    expect(filterSongCandidates(all, { query: 'black' }).map((s) => s.id)).toEqual([29]);
  });

  it('命中置顶：精确命中在最前，其余前缀命中按 id 升序，未命中的保持传入顺序', () => {
    const filtered = filterSongCandidates(all, { query: '29' });
    expect(promoteIdMatches(filtered, '29').map((s) => s.id)).toEqual([29, 291]);

    // 精确命中不在队首时也要被挑到最前
    const reversed = [all[1], all[0]];
    expect(promoteIdMatches(reversed, '29').map((s) => s.id)).toEqual([29, 291]);

    // 数字标题撞车：1004 既是 id 精确命中、又是曲名匹配，只该出现一次且在最前
    const collision = [all[2], all[3]];
    expect(promoteIdMatches(collision, '1004').map((s) => s.id)).toEqual([1004, 1]);
  });

  it('非数字查询 / 无 id 命中：原样返回（顺序不动）', () => {
    expect(promoteIdMatches(all, 'Roselia').map((s) => s.id)).toEqual(all.map((s) => s.id));
    expect(promoteIdMatches(all, '777').map((s) => s.id)).toEqual(all.map((s) => s.id));
  });
});

describe('票 08 · 曲库索引 / 详情（一次拉全 + 选中才拉详情）', () => {
  afterEach(() => {
    clearSongCatalogCache();
  });

  it('曲库一次拉全：索引 + 乐队索引各一次', async () => {
    const transport = fakeTransport({
      json: {
        'https://bestdori.com/api/songs/all.5.json': SONGS_INDEX,
        'https://bestdori.com/api/bands/all.1.json': BANDS_INDEX,
      },
    });

    const catalog = await fetchSongCatalog(transport, 'zh-CN');

    expect(catalog.map((s) => s.id)).toEqual([1, 1004]);
    expect(transport.requests.map((r) => r.url)).toEqual([
      'https://bestdori.com/api/songs/all.5.json',
      'https://bestdori.com/api/bands/all.1.json',
    ]);
    // 票 29：启动首次拉取使用 freshFirst 穿透请求最新，失败回退磁盘缓存
    expect(transport.requests.every((r) => r.freshFirst === true)).toBe(true);
  });

  it('同一语言第二次拉曲库走会话缓存，不再打出口（票 13 #4）', async () => {
    const transport = fakeTransport({
      json: {
        'https://bestdori.com/api/songs/all.5.json': SONGS_INDEX,
        'https://bestdori.com/api/bands/all.1.json': BANDS_INDEX,
      },
    });

    const first = await fetchSongCatalog(transport, 'zh-CN');
    const second = await fetchSongCatalog(transport, 'zh-CN');

    expect(second).toBe(first);
    expect(transport.requests).toHaveLength(2);
  });

  // 会话内这份模块缓存不过期（不点刷新就只能等下次启动才看到新曲）——
  // 主动刷新必须**穿透**它（清缓存）并让网关重拉（revalidate）。
  it('主动刷新：丢掉会话缓存 + 两次请求都带 revalidate，并换成新数据', async () => {
    const transport = fakeTransport({
      json: {
        'https://bestdori.com/api/songs/all.5.json': SONGS_INDEX,
        'https://bestdori.com/api/bands/all.1.json': BANDS_INDEX,
      },
    });

    await fetchSongCatalog(transport, 'zh-CN');
    transport.requests.length = 0;

    const refreshed = await refreshSongCatalog(transport, 'zh-CN');

    expect(refreshed.map((s) => s.id)).toEqual([1, 1004]);
    expect(transport.requests).toHaveLength(2);
    expect(transport.requests.every((req) => req.revalidate === true)).toBe(true);
    // 刷新后的副本接管会话缓存：下一次普通拉取不再打网络
    const again = await fetchSongCatalog(transport, 'zh-CN');
    expect(again).toBe(refreshed);
    expect(transport.requests).toHaveLength(2);
  });

  it('换语言不复用上一份缓存', async () => {
    const transport = fakeTransport({
      json: {
        'https://bestdori.com/api/songs/all.5.json': SONGS_INDEX,
        'https://bestdori.com/api/bands/all.1.json': BANDS_INDEX,
      },
    });

    await fetchSongCatalog(transport, 'zh-CN');
    await fetchSongCatalog(transport, 'en');

    expect(transport.requests).toHaveLength(4);
  });

  it('详情取 bgmId 与官方曲长；形态不对翻成统一错误域', async () => {
    const transport = fakeTransport({
      json: {
        'https://bestdori.com/api/songs/1.json': { bgmId: 'bgm001', length: 120.048, musicTitle: ['x'] },
        'https://bestdori.com/api/songs/2.json': { bgmId: '', length: 0 },
      },
    });

    await expect(fetchSongDetail(transport, 1)).resolves.toEqual({ bgmId: 'bgm001', lengthSeconds: 120.048 });
    await expect(fetchSongDetail(transport, 2)).rejects.toSatisfy(
      (error: unknown) => isCommunityError(error) && error.kind === 'invalid-response',
    );
  });
});

describe('票 08 · 官方谱面代码取原文（解析留给 Apply 闸门）', () => {
  const CHART_TEXT = '[{"type":"BPM","bpm":185,"beat":0}]';

  it('拿回原样文本，不做 JSON.parse、不改一个字节', async () => {
    const transport = fakeTransport({
      text: { 'https://bestdori.com/api/charts/1/special.json': CHART_TEXT },
    });

    await expect(fetchOfficialChartText(transport, 1, 'special')).resolves.toBe(CHART_TEXT);
    expect(transport.requests[0]?.url).toBe('https://bestdori.com/api/charts/1/special.json');
    expect(transport.requests[0]?.headers?.['user-agent']).toContain('aao-bestdori-client');
  });
});

describe('票 08 · 官方音频 / 封面落下载暂存', () => {
  it('音频进暂存：URL 用这首歌的服务器，建议名按票 35 规则（official-<songId>-<曲名>）', async () => {
    const transport = fakeTransport({ binary: { 'https://bestdori.com/assets/jp/sound/bgm001_rip/bgm001.mp3': REAL_AUDIO } });

    const staged = await fetchOfficialAudio(transport, candidate(1), { bgmId: 'bgm001', lengthSeconds: 120.048 });

    expect(staged).toEqual(REAL_AUDIO);
    expect(transport.requests[0]).toMatchObject({
      suggestedName: 'official-1-是！.mp3',
      timeoutMs: 120_000,
    });
  });

  it('音频取不到（SPA 回退页）→ invalid-response，不把网页当音频', async () => {
    const transport = fakeTransport({ binary: { 'https://bestdori.com/assets/jp/sound/bgm001_rip/bgm001.mp3': FALLBACK } });

    await expect(fetchOfficialAudio(transport, candidate(1), { bgmId: 'bgm001', lengthSeconds: 120 }))
      .rejects.toSatisfy((error: unknown) => isCommunityError(error) && error.kind === 'invalid-response');
  });

  it('封面取不到 → null（这次导入不带封面，不挡主线）', async () => {
    const transport = fakeTransport({ binary: { 'https://bestdori.com/assets/en/musicjacket/musicjacket1010_rip/assets-star-forassetbundle-startapp-musicjacket-musicjacket1010-1004_see_the_world_eng-jacket.png': FALLBACK } });

    await expect(fetchOfficialCover(transport, candidate(1004))).resolves.toBeNull();
    expect(transport.requests[0]?.url).toContain('/assets/en/');
  });

  it('content-type 不是这一类就不算数（回退页 / 网页 / JSON 都别写进工程）', async () => {
    const audioUrl = 'https://bestdori.com/assets/jp/sound/bgm001_rip/bgm001.mp3';
    const jsonAsAudio = { path: '/tmp/a.bin', byteLength: 20, contentType: 'application/json' };
    const noHeaderAudio = { path: '/tmp/a.bin', byteLength: 4_000_000, contentType: null };

    await expect(fetchOfficialAudio(fakeTransport({ binary: { [audioUrl]: jsonAsAudio } }), candidate(1), { bgmId: 'bgm001', lengthSeconds: 120 }))
      .rejects.toSatisfy((error: unknown) => isCommunityError(error) && error.kind === 'invalid-response');
    // 拿不到 content-type = 没信号，放行（拒绝它会让平台哪天不回这个头时主线全断）
    await expect(fetchOfficialAudio(fakeTransport({ binary: { [audioUrl]: noHeaderAudio } }), candidate(1), { bgmId: 'bgm001', lengthSeconds: 120 }))
      .resolves.toEqual(noHeaderAudio);

    const jacketUrl = 'https://bestdori.com/assets/jp/musicjacket/musicjacket10_rip/assets-star-forassetbundle-startapp-musicjacket-musicjacket10-yes_bang_dream-jacket.png';
    await expect(fetchOfficialCover(fakeTransport({ binary: { [jacketUrl]: jsonAsAudio } }), candidate(1))).resolves.toBeNull();
  });

  it('预览直链与下载取同一个 URL（封面 / 试听）', () => {
    const song = candidate(1004);
    const detail = { bgmId: 'bgm1004', lengthSeconds: 108.878 };

    expect(jacketPreviewUrl(song)).toBe(
      'https://bestdori.com/assets/en/musicjacket/musicjacket1010_rip/assets-star-forassetbundle-startapp-musicjacket-musicjacket1010-1004_see_the_world_eng-jacket.png',
    );
    expect(audioPreviewUrl(song, detail)).toBe('https://bestdori.com/assets/en/sound/bgm1004_rip/bgm1004.mp3');
  });

  it('预览的本机 URL 包住同一条直链（票 16：缓存按直链寻址，协议侧只认已缓存）', () => {
    const song = candidate(1004);
    const detail = { bgmId: 'bgm1004', lengthSeconds: 108.878 };

    expect(jacketLocalUrl(song)).toBe(assetRawUrl(jacketPreviewUrl(song)));
    expect(audioLocalUrl(song, detail)).toBe(assetRawUrl(audioPreviewUrl(song, detail)));
  });
});

// 票 35：落名规则统一（替代旧的平台内部文件名 bgm029.mp3 / blackshout.png）。
// 曲名清洗与缺省退化的细颗粒用例在 assetNames.test.ts，这里锁「官方这支的接线」。
describe('票 35 · 官方素材落名（来源前缀 + 曲库 id + 曲名）', () => {
  it('音频与封面同一把尺，曲名跟当前界面语言走', () => {
    expect(audioFileName(candidate(1))).toBe('official-1-是！.mp3');
    expect(coverFileName(candidate(1))).toBe('official-1-是！.png');
    // en 走英文标题（歌在不同语言下名字不同，落名也跟着不同）
    expect(audioFileName(candidate(1, 'en'))).toBe('official-1-Yes! BanG_Dream!.mp3');
    // 合作曲（1004）同规则
    expect(coverFileName(candidate(1004))).toBe('official-1004-See the world.png');
  });
});
