// 票 08：官方曲库能力（能力 1–5）与官方曲的中立映射。
// 惯例照 tests/unit/upload/bestdori/sanitizeChart.test.ts：内联 fixture + 手写假出口，全仓无 msw / vi.mock。
import { describe, expect, it } from 'vitest';
import { isCommunityError } from '@/src/community/transport';
import {
  audioPreviewUrl,
  fetchOfficialAudio,
  fetchOfficialChartText,
  fetchOfficialCover,
  fetchSongCatalog,
  fetchSongDetail,
  jacketPreviewUrl,
  searchSongCandidates,
} from '@/src/community/bestdori/songs';
import { toSongCandidates } from '@/src/community/bestdori/mapping';
import type { SongCandidate } from '@/src/community/bestdori/mapping';
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

describe('票 08 · 曲库索引 / 详情（一次拉全 + 选中才拉详情）', () => {
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
    expect(transport.requests[0]?.headers?.['user-agent']).toContain('tsugu-bestdori-client');
  });
});

describe('票 08 · 官方音频 / 封面落下载暂存', () => {
  it('音频进暂存：URL 用这首歌的服务器，建议名带 bgmId', async () => {
    const transport = fakeTransport({ binary: { 'https://bestdori.com/assets/jp/sound/bgm001_rip/bgm001.mp3': REAL_AUDIO } });

    const staged = await fetchOfficialAudio(transport, candidate(1), { bgmId: 'bgm001', lengthSeconds: 120.048 });

    expect(staged).toEqual(REAL_AUDIO);
    expect(transport.requests[0]).toMatchObject({
      suggestedName: 'bgm001.mp3',
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
});
