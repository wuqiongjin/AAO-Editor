// bestdori-integration 08：官方曲 → 建工程这条编排（「从官方谱面导入」那一支）。
//
// 锁四件事：
//   ① 默认产出 = 一个工程（名称 / 歌手 / 曲目来源来自曲库）+ **一张空 Expert 谱面** + 官方音频与封面；
//   ② 勾了「带官方谱面内容」才把**官方 Special 谱代码送过 Apply 闸门**（等级跟着官方数据来）；
//   ③ 封面取不到照样建（合作曲在非首发服就没有封面），但**音频取不到就不建**；
//   ④ 过不了 Apply 闸门整笔不落盘（不留半截工程）。
import { describe, expect, it } from 'vitest';
import { defaultRetryDeps } from '@/src/community/rateLimit';
import { CommunityError, isCommunityError } from '@/src/community/transport';
import { zhCN, en } from '@/src/i18n/t';
import { readStripped } from '@/tests/support/source';
import type { SongCandidate } from '@/src/community/bestdori/mapping';
import { toSongCandidates } from '@/src/community/bestdori/mapping';
import type { ChartProject, ProjectBinarySources } from '@/src/project/ChartProject';
import {
  importOfficialSong,
  officialErrorText,
  type OfficialImportStore,
} from '@/src/pages/projects/officialImport';
import { makeFakeCommunityTransport } from '@/tests/support/communityTransport';

const NOW = 1_700_000_000_000;

const SONGS_INDEX = {
  '29': {
    tag: 'normal',
    bandId: 5,
    jacketImage: ['blackshout'],
    musicTitle: ['BLACK SHOUT', 'BLACK SHOUT', 'BLACK SHOUT', 'BLACK SHOUT', 'BLACK SHOUT'],
    publishedAt: ['1462071600000', '1462104000000', '1507003200000', '1462075200000', '1462071600000'],
    difficulty: {
      0: { playLevel: 6 },
      1: { playLevel: 13 },
      2: { playLevel: 18 },
      3: { playLevel: 25 },
      4: { playLevel: 26 },
    },
  },
};

const BANDS_INDEX = {
  '5': { bandName: ['Roselia', 'Roselia', 'Roselia', 'Roselia', 'Roselia'] },
};

const AUDIO_URL = 'https://bestdori.com/assets/jp/sound/bgm029_rip/bgm029.mp3';
const JACKET_URL = 'https://bestdori.com/assets/jp/musicjacket/musicjacket30_rip/assets-star-forassetbundle-startapp-musicjacket-musicjacket30-blackshout-jacket.png';
const CHART_URL = 'https://bestdori.com/api/charts/29/special.json';
const EXPERT_CHART_URL = 'https://bestdori.com/api/charts/29/expert.json';

/** 官方 Special 谱面代码（形状照 docs/resource 的实测语料；就地样本，不入库） */
const OFFICIAL_SPECIAL = [
  JSON.stringify([
    { type: 'BPM', bpm: 185, beat: 0 },
    { type: 'System', data: 'bgm029.wav', beat: 0 },
    { type: 'Single', lane: 5, beat: 10 },
    { type: 'Slide', connections: [{ lane: 1, beat: 12 }, { lane: 3, beat: 13 }] },
  ]),
  '',
].join('\n');

const STAGED_AUDIO = { path: '/data/downloads/aaa-bgm029.mp3', byteLength: 4_000_000, contentType: 'audio/mpeg' };
const STAGED_COVER = { path: '/data/downloads/bbb-blackshout.png', byteLength: 98_575, contentType: 'image/png' };
/** 平台对不存在的资源回 200 + SPA 回退页 */
const FALLBACK = { path: '/data/downloads/ccc-jacket.png', byteLength: 14_084, contentType: 'text/html' };

function song(): SongCandidate {
  const found = toSongCandidates(SONGS_INDEX, BANDS_INDEX, 'zh-CN')[0];
  if (!found) throw new Error('fixture 有问题');
  return found;
}

function recordingStore() {
  const writes: { project: ChartProject; staged?: ProjectBinarySources }[] = [];
  const disk = new Map<string, ChartProject>();
  const store: OfficialImportStore = {
    save: async (project, staged) => {
      writes.push({ project, staged });
      disk.set(project.id, project);
    },
    get: async (id) => disk.get(id) ?? null,
  };
  return { store, writes, disk };
}

function deps(overrides: { binary?: Record<string, typeof STAGED_AUDIO | typeof FALLBACK> } = {}) {
  const { store, writes, disk } = recordingStore();
  const transport = makeFakeCommunityTransport({
    text: { [CHART_URL]: OFFICIAL_SPECIAL, [EXPERT_CHART_URL]: OFFICIAL_SPECIAL },
    binary: {
      [AUDIO_URL]: STAGED_AUDIO,
      [JACKET_URL]: STAGED_COVER,
      ...overrides.binary,
    },
  });
  let notified = 0;
  const stages: string[] = [];
  return {
    writes,
    disk,
    stages,
    transport,
    run: (withChart: boolean, diff: 'expert' | 'special' = 'special') => importOfficialSong(
      {
        store,
        transport,
        notifyCatalogChanged: () => { notified += 1; },
        onStage: (stage) => stages.push(stage),
        newIds: () => ({ projectId: 'pNew1', chartId: 'cNew1' }),
        now: () => NOW,
      },
      {
        song: song(),
        detail: { bgmId: 'bgm029', lengthSeconds: 120.048 },
        withChart,
        diff,
      },
    ),
    notified: () => notified,
  };
}

describe('票 08 · 默认产出（不勾「带官方谱面」）', () => {
  it('工程名称 / 歌手 / 曲目来源来自曲库，一张空 Expert 谱面，音频与封面走暂存', async () => {
    const t = deps();

    const result = await t.run(false);

    expect(result.ok).toBe(true);
    expect(t.writes).toHaveLength(1);
    const { project, staged } = t.writes[0];
    expect(project).toMatchObject({
      id: 'pNew1',
      name: 'BLACK SHOUT',
      artist: 'Roselia',
      source: { type: 'bandori', id: 29 },
      durationSeconds: 120.048,
    });
    // 一张空 Expert 谱面：notes 是最小可用谱面（beat 0 的 BPM），等级不预填
    expect(project.charts).toHaveLength(1);
    expect(project.charts[0]).toMatchObject({
      id: 'cNew1',
      title: null,
      diff: 3,
      level: null,
      appliedChartCodeText: null,
      chartCodePristine: false,
    });
    expect(project.charts[0].notes).toEqual([{ beat: 0, type: 'BPM', bpm: 120 }]);
    // 名字落进工程记录（详情行 / 音频页靠它认出「有音频」），二进制只递暂存路径、没碰字节
    // 票 35：落名规则统一为「来源前缀 + 曲库 id + 曲名」
    expect(project.audioName).toBe('official-29-BLACK SHOUT.mp3');
    expect(project.coverName).toBe('official-29-BLACK SHOUT.png');
    expect(staged).toEqual({
      audioStagedPath: STAGED_AUDIO.path,
      coverStagedPath: STAGED_COVER.path,
    });
    expect(t.notified()).toBe(1);
    // 落盘后把字节读回内存（否则下一次保存会把刚导入的音频当清空）
    expect(t.disk.get('pNew1')).toBeDefined();
    expect(t.stages).toEqual(['audio', 'cover', 'save']);
  });
});

describe('票 08 · 勾了「带官方谱面内容」', () => {
  it('官方 Special 谱代码过 Apply 闸门：难度 / 等级 / 保真原文都跟着来', async () => {
    const t = deps();

    const result = await t.run(true, 'special');

    expect(result.ok).toBe(true);
    const project = t.writes[0].project;
    expect(project.charts[0]).toMatchObject({
      diff: 4,
      level: 26,
      chartCodePristine: true,
    });
    // pristine 且带源文本 ⇒ 导出时直接发原文（ADR-0014 保真）
    expect(project.charts[0].appliedChartCodeText).toBe(OFFICIAL_SPECIAL.trim());
    expect(project.charts[0].notes.map((n) => n.type)).toEqual(['BPM', 'System', 'Single', 'Slide']);
    expect(t.stages).toEqual(['audio', 'cover', 'chart', 'save']);
  });

  it('选 Expert 就带 Expert 的等级（等级取自曲库难度表，不是硬编码）', async () => {
    const t = deps();

    await t.run(true, 'expert');

    expect(t.writes[0].project.charts[0]).toMatchObject({ diff: 3, level: 25 });
  });
});

describe('票 08 · 素材缺失与闸门拒绝', () => {
  it('封面取不到（合作曲在非首发服）→ 照样建工程，只是不带封面', async () => {
    const t = deps({ binary: { [JACKET_URL]: FALLBACK } });

    const result = await t.run(false);

    expect(result).toEqual(expect.objectContaining({ ok: true, coverImported: false }));
    expect(t.writes[0].staged?.coverStagedPath).toBeUndefined();
    expect(t.writes[0].staged?.audioStagedPath).toBeDefined();
    expect(t.writes[0].project.coverName).toBeNull();
    expect(t.writes[0].project.audioName).toBe('official-29-BLACK SHOUT.mp3');
  });

  it('音频取不到 → 抛响应非法，且不落盘（没有音频就不是这条导入的产物）', async () => {
    const t = deps({ binary: { [AUDIO_URL]: FALLBACK } });

    await expect(t.run(false)).rejects.toSatisfy(
      (error: unknown) => isCommunityError(error) && error.kind === 'invalid-response',
    );
    expect(t.writes).toHaveLength(0);
    expect(t.notified()).toBe(0);
  });

  it('官方谱面代码过不了闸门（缺 beat 0 的 BPM）→ 整笔不建', async () => {
    const { store, writes } = recordingStore();
    const transport = makeFakeCommunityTransport({
      text: { [CHART_URL]: JSON.stringify([{ type: 'BPM', bpm: 185, beat: 4 }]) },
      binary: { [AUDIO_URL]: STAGED_AUDIO, [JACKET_URL]: STAGED_COVER },
    });

    const result = await importOfficialSong(
      {
        store,
        transport,
        notifyCatalogChanged: () => {},
        newIds: () => ({ projectId: 'pNew1', chartId: 'cNew1' }),
        now: () => NOW,
      },
      { song: song(), detail: { bgmId: 'bgm029', lengthSeconds: 120 }, withChart: true, diff: 'special' },
    );

    expect(result).toEqual(expect.objectContaining({ ok: false, reason: 'apply' }));
    expect(writes).toHaveLength(0);
  });
});

// ADR-0005 §4「有音频 = 音频时长」：官方 length 只是起始值，落地后按**实际音频**校正一次。
describe('票 08 · 时长跟随实际音频', () => {
  it('探针给出的时长与官方 length 差得多就改写；差在 0.5s 内不动', async () => {
    const { store, writes, disk } = recordingStore();
    const transport = makeFakeCommunityTransport({
      binary: { [AUDIO_URL]: STAGED_AUDIO, [JACKET_URL]: STAGED_COVER },
    });
    // 让「读回来」的那份带着音频字节（真后端从 audio.bin 读回 Blob）
    store.get = async (id) => {
      const project = disk.get(id);
      return project ? { ...project, audioBlob: new Blob([new Uint8Array([1, 2, 3])]) } : null;
    };

    const result = await importOfficialSong(
      {
        store,
        transport,
        notifyCatalogChanged: () => {},
        newIds: () => ({ projectId: 'pNew1', chartId: 'cNew1' }),
        now: () => NOW,
        probeDuration: async () => 118.02,
      },
      { song: song(), detail: { bgmId: 'bgm029', lengthSeconds: 120.048 }, withChart: false, diff: 'expert' },
    );

    expect(result.ok).toBe(true);
    expect(writes.map((w) => w.project.durationSeconds)).toEqual([120.048, 118.02]);

    // 探针失败 / 差异在容差内：不再写第二笔
    const t2 = deps();
    await t2.run(false);
    expect(t2.writes).toHaveLength(1);
  });
});

// 界面文案按统一错误域的 kind 走 i18n（票 07 口径：message 只作诊断，不当界面文案）。
describe('票 08 · 失败文案按 kind 走 i18n', () => {
  it('离线 / 限流 / 无出口各有专句，其余兜底一句', () => {
    const wire = (kind: 'offline' | 'rate-limited' | 'unsupported-runtime' | 'http', message: string) =>
      new CommunityError(message, { kind, message });

    expect(officialErrorText(wire('offline', 'connect ECONNREFUSED'))).toBe('连不上官方曲库，检查网络后重试。');
    expect(officialErrorText(wire('rate-limited', 'HTTP 429'))).toBe('官方曲库限流了，稍等一会儿再试。');
    expect(officialErrorText(wire('unsupported-runtime', '没有出口'))).toBe('官方曲库只在桌面版提供。');
    expect(officialErrorText(wire('http', 'HTTP 500'))).toBe('读取官方曲库失败，请重试。');
    expect(officialErrorText(new Error('裸异常'))).toBe('读取官方曲库失败，请重试。');
  });
});

// 票 26：素材失败时「创建」的降级语义 —— 谱面代码网络失败放行、Apply 拒绝维持整笔不建、
// 封面静默跳过仅限「平台无图」（网络失败整笔挡）；音频失败维持阻断（上面的既有用例即反向护栏）。
describe('票 26 · 素材失败时的降级语义', () => {
  /** 网络域错误会按退避策略真等 2.4s+，测试里让 sleep 只记账不真等（本仓不用 vi.useFakeTimers） */
  function withSilentSleep(run: () => Promise<void>): Promise<void> {
    const realSleep = defaultRetryDeps.sleep;
    defaultRetryDeps.sleep = async () => {};
    return run().finally(() => { defaultRetryDeps.sleep = realSleep; });
  }

  it('官方谱面请求网络失败 → 降级放行：空 Expert 谱面照建 + 结果带警告标记', async () => {
    const t = deps();
    // 手打桩会顶掉假出口的请求记账，重试次数自己数
    let chartAttempts = 0;
    t.transport.requestText = async () => {
      chartAttempts += 1;
      throw new CommunityError('connect ECONNREFUSED', { kind: 'offline', message: 'connect ECONNREFUSED' });
    };

    await withSilentSleep(async () => {
      const result = await t.run(true, 'special');
      expect(result).toEqual(expect.objectContaining({ ok: true, chartDegraded: true }));
    });

    // 等同没勾 B：难度回 Expert、等级不预填、谱面是最小可用空谱
    const chart = t.writes[0].project.charts[0];
    expect(chart).toMatchObject({ diff: 3, level: null, appliedChartCodeText: null, chartCodePristine: false });
    expect(chart.notes).toEqual([{ beat: 0, type: 'BPM', bpm: 120 }]);
    // 音频与封面照常落地，工程照建
    expect(t.writes[0].staged).toEqual({
      audioStagedPath: STAGED_AUDIO.path,
      coverStagedPath: STAGED_COVER.path,
    });
    // 网络域错误按退避策略试满 3 次才降级
    expect(chartAttempts).toBe(3);
  });

  it('封面网络失败 → 整笔失败（静默跳过仅限平台无图，见票 08 的回退页用例）', async () => {
    const t = deps();
    t.transport.requestBinary = (req) => req.url === AUDIO_URL
      ? Promise.resolve(STAGED_AUDIO)
      : Promise.reject(new CommunityError('connect ECONNREFUSED', { kind: 'offline', message: 'connect ECONNREFUSED' }));

    await withSilentSleep(async () => {
      await expect(t.run(false)).rejects.toSatisfy(
        (error: unknown) => isCommunityError(error) && error.kind === 'offline',
      );
    });
    expect(t.writes).toHaveLength(0);
  });

  it('非网络域（响应非法）不降级：照抛整笔失败，别静默变空谱', async () => {
    const t = deps();
    t.transport.requestText = async () => {
      throw new CommunityError('载荷被网关拒', { kind: 'invalid-response', message: '载荷被网关拒' });
    };

    await expect(t.run(true, 'special')).rejects.toSatisfy(
      (error: unknown) => isCommunityError(error) && error.kind === 'invalid-response',
    );
    expect(t.writes).toHaveLength(0);
  });

  it('降级 / 缺封面的警告文案接进了 Toast：ProjectsPage 的映射与 zh/en 键都在', () => {
    const page = readStripped('src/pages/projects/ProjectsPage.tsx');
    expect(page).toContain("if (result.chartDegraded) warnings.push(t('projects.official.warn.chartFallback'))");
    expect(page).toContain("if (!result.coverImported) warnings.push(t('projects.official.warn.coverMissing'))");
    expect(zhCN['projects.official.warn.chartFallback']).toBe('官方谱面获取失败，已按空白谱面创建，可稍后在谱面代码导入中补。');
    expect(zhCN['projects.official.warn.coverMissing']).toBe('该曲目未提供官方封面，工程未包含封面。');
    expect(en['projects.official.warn.chartFallback']).toBeTruthy();
    expect(en['projects.official.warn.coverMissing']).toBeTruthy();
  });
});
