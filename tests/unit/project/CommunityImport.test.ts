// bestdori-integration 09：社区帖 → 建工程这条编排（「从社区谱面导入」那一支）。
//
// 锁五件事：
//   ① **名称口径（票 09 的防回潮锁）**：工程名称 / 歌手 / 谱面名称（ProjectChart.title）全空 ——
//      原帖标题与谱师只在导入会话里显示，谁预填谁红；
//   ② custom 帖：音频与封面按帖内 URL 下载，`曲目来源` = custom；难度等级跟帖子走；
//   ③ bandori 帖：素材走官方那条路（曲库候选 + 歌曲元数据），`曲目来源` 记曲库 id，时长按官方曲长起；
//   ④ 谱面是主线：详情取不到 / Apply 闸门拒绝 → **整笔不建**（没有官方那支的「空白谱降级」）；
//   ⑤ 封面缺失照样建（警告由界面 Toast 说）。
import { describe, expect, it } from 'vitest';
import { CommunityError } from '@/src/community/transport';
import { toPostCandidate, toSongCandidates, type PostCandidate } from '@/src/community/bestdori/mapping';
import type { ChartProject, ProjectBinarySources } from '@/src/project/ChartProject';
import {
  communityApplyErrorText,
  communityErrorText,
  importCommunityPost,
  type CommunityImportStore,
} from '@/src/pages/projects/communityImport';
import { makeFakeCommunityTransport } from '@/tests/support/communityTransport';

const NOW = 1_700_000_000_000;

const AUDIO_URL = 'https://bestdori.com/api/upload/file/d936a1';
const COVER_URL = 'https://bestdori.com/api/upload/file/247c2b';
const DETAIL_URL = 'https://bestdori.com/api/post/details?id=248468';
const BANDORI_DETAIL_URL = 'https://bestdori.com/api/post/details?id=258646';
const OFFICIAL_AUDIO_URL = 'https://bestdori.com/assets/jp/sound/bgm029_rip/bgm029.mp3';
const OFFICIAL_JACKET_URL = 'https://bestdori.com/assets/jp/musicjacket/musicjacket30_rip/assets-star-forassetbundle-startapp-musicjacket-musicjacket30-blackshout-jacket.png';

const STAGED_AUDIO = { path: '/data/cache/community/aaa-audio', byteLength: 4_000_000, contentType: 'audio/mpeg' };
const STAGED_COVER = { path: '/data/cache/community/bbb-cover', byteLength: 98_575, contentType: 'image/png' };

const COMMUNITY_CHART = [
  { type: 'BPM', bpm: 185, beat: 0 },
  { type: 'System', data: 'customsong.mp3', beat: 0 },
  { type: 'Single', lane: 5, beat: 10 },
];

/** custom 帖（列表条目形状，实测口径） */
const CUSTOM_POST = {
  id: 248468,
  title: 'All You Wanted (GBP Edit)',
  song: { type: 'custom', audio: AUDIO_URL, cover: COVER_URL },
  artists: 'Michelle Branch',
  diff: 3,
  level: 24,
  time: 1789214607000,
  author: { username: 'envy09', nickname: 'Envy', titles: null },
  likes: 1,
};

/** bandori 帖（引用官方曲库 id） */
const BANDORI_POST = {
  id: 258646,
  title: 'BLACK SHOUT 谱师版',
  song: { type: 'bandori', id: 29 },
  artists: '',
  diff: 4,
  level: 30,
  time: 1791643163000,
  author: { username: 'chunbaishanshuo', nickname: '白', titles: null },
};

const DETAIL_OK = {
  result: true,
  post: { ...CUSTOM_POST, chart: COMMUNITY_CHART },
};

const BANDORI_SONG = toSongCandidates({
  '29': {
    tag: 'normal',
    bandId: 5,
    jacketImage: ['blackshout'],
    musicTitle: ['BLACK SHOUT', 'BLACK SHOUT', 'BLACK SHOUT', 'BLACK SHOUT', 'BLACK SHOUT'],
    publishedAt: ['1462071600000', '1462104000000', '1507003200000', '1462075200000', '1462071600000'],
    difficulty: { 3: { playLevel: 25 }, 4: { playLevel: 26 } },
  },
}, { '5': { bandName: ['Roselia', 'Roselia', 'Roselia', 'Roselia', 'Roselia'] } }, 'zh-CN')[0];

function post(raw: unknown): PostCandidate {
  const mapped = toPostCandidate(raw);
  if (!mapped) throw new Error('fixture 有问题');
  return mapped;
}

function recordingStore() {
  const writes: { project: ChartProject; staged?: ProjectBinarySources }[] = [];
  const disk = new Map<string, ChartProject>();
  const store: CommunityImportStore = {
    save: async (project, staged) => {
      writes.push({ project, staged });
      disk.set(project.id, project);
    },
    get: async (id) => disk.get(id) ?? null,
  };
  return { store, writes, disk };
}

interface Overrides {
  binary?: Record<string, typeof STAGED_AUDIO | typeof STAGED_COVER>;
  json?: Record<string, unknown>;
}

function deps(overrides: Overrides = {}) {
  const { store, writes, disk } = recordingStore();
  const transport = makeFakeCommunityTransport({
    json: { [DETAIL_URL]: DETAIL_OK, ...overrides.json },
    binary: { [AUDIO_URL]: STAGED_AUDIO, [COVER_URL]: STAGED_COVER, ...overrides.binary },
  });
  let notified = 0;
  const stages: string[] = [];
  const run = (
    input: PostCandidate,
    extra: { song?: typeof BANDORI_SONG; detail?: { bgmId: string; lengthSeconds: number }; withChart?: boolean } = {},
  ) => {
    const { withChart = true, ...rest } = extra;
    return importCommunityPost(
      {
        store,
        transport,
        notifyCatalogChanged: () => { notified += 1; },
        onStage: (stage) => stages.push(stage),
        newIds: () => ({ projectId: 'pNew1', chartId: 'cNew1' }),
        now: () => NOW,
        probeDuration: async () => 413.2,
      },
      { post: input, withChart, ...rest },
    );
  };
  return { store, writes, disk, stages, run, notified: () => notified, transport };
}

describe('票 09 · 名称口径（防回潮总锁）', () => {
  it('工程名称 / 歌手 / 谱面名称全空：原帖标题与谱师不落进工程', async () => {
    const t = deps();

    const result = await t.run(post(CUSTOM_POST));

    expect(result.ok).toBe(true);
    const saved = t.disk.get('pNew1');
    expect(saved).not.toBeNull();
    expect(saved!.name).toBeNull();
    expect(saved!.artist).toBeNull();
    expect(saved!.charts[0].title).toBeNull();
  });
});

describe('票 09 · custom 帖', () => {
  it('帖内音频与封面 → 缓存路径；曲目来源 custom；难度等级跟帖子；谱面原文过闸门', async () => {
    const t = deps();
    // 让「读回来」的那份带着音频字节（真后端从 audio.bin 读回 Blob），时长校正才跑得起来
    t.store.get = async (id) => {
      const project = t.disk.get(id);
      return project ? { ...project, audioBlob: new Blob([new Uint8Array([1, 2, 3])]) } : null;
    };

    const result = await t.run(post(CUSTOM_POST));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.coverImported).toBe(true);
    const saved = t.disk.get('pNew1')!;
    expect(saved.source).toEqual({ type: 'custom' });
    expect(saved.charts[0]).toMatchObject({ diff: 3, level: 24, chartCodePristine: true });
    expect(saved.charts[0].appliedChartCodeText).toBe(JSON.stringify(COMMUNITY_CHART));
    expect(saved.audioName).toBe('post-248468-audio.mp3');
    expect(saved.coverName).toBe('post-248468-cover.png');
    // custom 帖没有官方曲长：先按占位值起，落盘后由实际音频校正（探针注入 413.2）
    expect(t.writes.map((w) => w.project.durationSeconds)).toEqual([30, 413.2]);
    expect(t.writes[0].staged).toEqual({ audioStagedPath: STAGED_AUDIO.path, coverStagedPath: STAGED_COVER.path });
    // 时长校正的第二笔写盘不重发阶段信号（与官方编排一致）
    expect(t.stages).toEqual(['audio', 'cover', 'chart', 'save']);
    expect(t.notified()).toBe(1);
  });

  it('帖子没给封面：照样建，coverImported = false（警告由界面说）', async () => {
    const t = deps();
    const noCover = { ...CUSTOM_POST, song: { type: 'custom', audio: AUDIO_URL } };

    const result = await t.run(post(noCover));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.coverImported).toBe(false);
    expect(t.disk.get('pNew1')!.coverName).toBeNull();
  });
});

describe('票 09 · 关掉「同步导入谱面」（2026-10-12 加的芯片）', () => {
  it('custom 帖：连详情都不请求，产出空 Expert + 等级不预填（与官方「没勾 B」同口径）', async () => {
    const t = deps();

    const result = await t.run(post(CUSTOM_POST), { withChart: false });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const saved = t.disk.get('pNew1')!;
    // 谱面仍是主线之外的那张空谱：难度回 Expert、等级不预填、没有原文
    expect(saved.charts[0]).toMatchObject({ diff: 3, level: null, chartCodePristine: false });
    expect(saved.charts[0].appliedChartCodeText).toBeNull();
    expect(saved.audioName).toBe('post-248468-audio.mp3');
    // 音视频与封面照常带走
    expect(t.writes[0].staged).toEqual({ audioStagedPath: STAGED_AUDIO.path, coverStagedPath: STAGED_COVER.path });
    // 阶段里没有 chart 这一段（少一次网络）
    expect(t.stages).toEqual(['audio', 'cover', 'save']);
    expect(t.transport.requests.filter((req) => req.url === DETAIL_URL)).toHaveLength(0);
  });

  it('bandori 帖：素材与曲长照旧（歌曲元数据本来就要），只是不带谱面', async () => {
    const t = deps({
      json: { [BANDORI_DETAIL_URL]: { result: true, post: { ...BANDORI_POST, chart: COMMUNITY_CHART } } },
      binary: { [OFFICIAL_AUDIO_URL]: STAGED_AUDIO, [OFFICIAL_JACKET_URL]: STAGED_COVER },
    });

    const result = await t.run(
      post(BANDORI_POST),
      { withChart: false, song: BANDORI_SONG, detail: { bgmId: 'bgm029', lengthSeconds: 120.048 } },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const saved = t.disk.get('pNew1')!;
    expect(saved.source).toEqual({ type: 'bandori', id: 29 });
    expect(saved.durationSeconds).toBe(120.048);
    expect(saved.charts[0]).toMatchObject({ diff: 3, level: null, chartCodePristine: false });
    expect(t.transport.requests.filter((req) => req.url === BANDORI_DETAIL_URL)).toHaveLength(0);
  });
});

describe('票 09 · bandori 帖', () => {
  it('素材走官方那条路：曲目来源记曲库 id，时长按官方曲长，音频名是 bgm 名', async () => {
    const t = deps({
      json: {
        // 详情还是要点名取（谱面原文对 bandori 帖同样必达）
        [BANDORI_DETAIL_URL]: { result: true, post: { ...BANDORI_POST, chart: COMMUNITY_CHART } },
      },
      binary: { [OFFICIAL_AUDIO_URL]: STAGED_AUDIO, [OFFICIAL_JACKET_URL]: STAGED_COVER },
    });

    const result = await t.run(
      post(BANDORI_POST),
      { song: BANDORI_SONG, detail: { bgmId: 'bgm029', lengthSeconds: 120.048 } },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.coverImported).toBe(true);
    const saved = t.disk.get('pNew1')!;
    expect(saved.source).toEqual({ type: 'bandori', id: 29 });
    expect(saved.charts[0]).toMatchObject({ diff: 4, level: 30, chartCodePristine: true });
    expect(saved.durationSeconds).toBe(120.048);
    expect(saved.audioName).toBe('bgm029.mp3');
    expect(saved.coverName).toBe('blackshout.png');
    expect(t.writes[0].staged).toEqual({ audioStagedPath: STAGED_AUDIO.path, coverStagedPath: STAGED_COVER.path });
  });

  it('缺曲库候选 / 歌曲元数据（面板 misuse）：整笔失败', async () => {
    const t = deps({ binary: { [OFFICIAL_AUDIO_URL]: STAGED_AUDIO, [OFFICIAL_JACKET_URL]: STAGED_COVER } });
    await expect(t.run(post(BANDORI_POST))).rejects.toThrow(/缺少曲库候选或歌曲元数据/);
    expect(t.writes).toHaveLength(0);
  });
});

describe('票 09 · 谱面是主线（没有「空白谱降级」）', () => {
  it('详情取不到：整笔不建', async () => {
    const t = deps({ json: { [DETAIL_URL]: { result: false, code: 'REQUEST_INVALID' } } });
    await expect(t.run(post(CUSTOM_POST))).rejects.toMatchObject({ kind: 'invalid-response' });
    expect(t.writes).toHaveLength(0);
  });

  it('Apply 闸门拒绝（空谱面代码没有 beat 0 BPM）：整笔不落盘', async () => {
    const t = deps({ json: { [DETAIL_URL]: { result: true, post: { ...CUSTOM_POST, chart: [] } } } });

    const result = await t.run(post(CUSTOM_POST));

    expect(result).toMatchObject({ ok: false, reason: 'apply' });
    expect(t.writes).toHaveLength(0);
  });
});

describe('票 09 · 失败文案', () => {
  it('错误域 kind → i18n（不借官方那组的词）；Apply 拒绝点名第一个错', () => {
    expect(communityErrorText(new CommunityError('offline', { kind: 'offline', message: 'x' })))
      .toBe('连不上社区平台，检查网络后重试。');
    expect(communityErrorText(new CommunityError('rate-limited', { kind: 'rate-limited', message: 'x' })))
      .toBe('社区平台限流了，稍等一会儿再试。');
    // 非错误域异常：通用一句
    expect(communityErrorText(new Error('x'))).toBe('导入社区谱面失败，请重试。');
    expect(communityApplyErrorText([{ noteIndex: -1, reason: '缺少 beat 0 的 BPM' }]))
      .toBe('社区谱面代码过不了 Apply 闸门：谱面代码：缺少 beat 0 的 BPM');
  });
});
