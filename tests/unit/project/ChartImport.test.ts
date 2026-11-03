// 11 票（架构评审 2026-11-03 候选 1）：谱面导入的唯一序列。
//
// 旧编排在 officialImport / communityImport 各写一份；本文件用 fake source 锁 core 的
// 次序与不变量（stage、abort 检查点、Apply 失败、cover null、chart 降级、probe 校正、notify）。
// 两个真实来源的行为由 OfficialImport.test.ts / CommunityImport.test.ts 继续看守。
import { describe, expect, it } from 'vitest';
import type { ChartProject, ProjectBinarySources } from '@/src/project/ChartProject';
import {
  importChart,
  isImportCancelled,
  type ChartImportSource,
  type ImportChartOutcome,
  type ImportDeps,
  type ImportProjectMeta,
  type ImportStage,
  type ImportStore,
} from '@/src/pages/projects/chartImport';

const NOW = 1_700_000_000_000;
const CHART_OK = JSON.stringify([{ type: 'BPM', bpm: 120, beat: 0 }]);
const CHART_BAD = JSON.stringify([{ type: 'BPM', bpm: 185, beat: 4 }]);

interface TestInput {
  withChart: boolean;
}

interface HarnessOptions {
  /** 不传 = 默认封面；传 null = 平台无图 */
  cover?: { path: string; name: string } | null;
  chart?: ImportChartOutcome;
  meta?: ImportProjectMeta;
  /** 在某个源方法返回后立刻 abort，锁 core 的下一个检查点 */
  abortAt?: 'audio' | 'cover' | 'chart';
  /** 让 audio/cover 之外的第一步就抛 misuse（锁 validate 先于 stage） */
  validateError?: boolean;
  /** 读回工程时是否带 audioBlob（决定探针跑不跑） */
  audioBlob?: boolean;
  /** 探针结果；'error' = 探针失败 */
  probe?: number | 'error';
}

const DEFAULT_META: ImportProjectMeta = {
  name: 'Test Song',
  artist: 'Test Artist',
  source: { type: 'custom' },
  durationSeconds: 120,
  diff: 3,
  level: null,
};

function harness(options: HarnessOptions = {}) {
  const controller = new AbortController();
  const events: string[] = [];
  const stages: ImportStage[] = [];
  const writes: { project: ChartProject; staged?: ProjectBinarySources }[] = [];
  const disk = new Map<string, ChartProject>();
  let notified = 0;

  const cover = options.cover === undefined
    ? { path: '/cover.png', name: 'cover.png' }
    : options.cover;
  const chart = options.chart ?? { codeText: CHART_OK, degraded: false };
  const meta = options.meta ?? DEFAULT_META;

  const source: ChartImportSource<TestInput> = {
    kind: 'official',
    validate(input) {
      events.push(`validate:${input.withChart}`);
      if (options.validateError) throw new Error('source misuse');
    },
    async audio() {
      events.push('audio');
      if (options.abortAt === 'audio') controller.abort();
      return { path: '/audio.mp3', name: 'audio.mp3' };
    },
    async cover() {
      events.push('cover');
      if (options.abortAt === 'cover') controller.abort();
      return cover;
    },
    async chart() {
      events.push('chart');
      if (options.abortAt === 'chart') controller.abort();
      return chart;
    },
    projectMeta(_input, outcome) {
      events.push(`meta:${outcome == null ? 'none' : outcome.degraded ? 'degraded' : 'ok'}`);
      return meta;
    },
  };

  const store: ImportStore = {
    save: async (project, staged) => {
      events.push(staged ? 'save' : 'save2');
      writes.push({ project, staged });
      disk.set(project.id, {
        ...project,
        ...(options.audioBlob ? { audioBlob: new Blob(['audio']) } : {}),
      });
    },
    get: async (id) => {
      events.push('get');
      return disk.get(id) ?? null;
    },
  };

  const deps: ImportDeps = {
    store,
    notifyCatalogChanged: () => {
      events.push('notify');
      notified += 1;
    },
    onStage: (stage) => {
      stages.push(stage);
      events.push(`stage:${stage}`);
    },
    newIds: () => {
      events.push('ids');
      return { projectId: 'pNew', chartId: 'cNew' };
    },
    now: () => {
      events.push('now');
      return NOW;
    },
    probeDuration: async () => {
      events.push('probe');
      if (options.probe === 'error') throw new Error('probe failed');
      return options.probe ?? 120;
    },
    signal: controller.signal,
  };

  return {
    controller,
    events,
    stages,
    writes,
    disk,
    deps,
    source,
    notified: () => notified,
    run: (withChart = true) => importChart(source, deps, { withChart }),
  };
}

describe('11 · 导入序列：成功路径', () => {
  it('带谱面：stage 次序 + 保存 + 读回 + notify；chart 文本进工程', async () => {
    const t = harness();

    const result = await t.run(true);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.coverImported).toBe(true);
    expect(result.chartDegraded).toBe(false);
    expect(t.stages).toEqual(['audio', 'cover', 'chart', 'save']);
    expect(t.events).toEqual([
      'ids', 'now', 'validate:true',
      'stage:audio', 'audio',
      'stage:cover', 'cover',
      'stage:chart', 'chart',
      'meta:ok',
      'stage:save', 'save',
      'get', 'notify',
    ]);
    expect(t.writes).toHaveLength(1);
    expect(t.writes[0]!.staged).toEqual({
      audioStagedPath: '/audio.mp3',
      coverStagedPath: '/cover.png',
    });
    expect(t.writes[0]!.project).toMatchObject({
      id: 'pNew',
      name: 'Test Song',
      artist: 'Test Artist',
      durationSeconds: 120,
      audioName: 'audio.mp3',
      coverName: 'cover.png',
    });
    expect(t.writes[0]!.project.charts[0]).toMatchObject({
      id: 'cNew',
      diff: 3,
      level: null,
      appliedChartCodeText: CHART_OK,
      chartCodePristine: true,
    });
    expect(t.notified()).toBe(1);
  });

  it('不带谱面：不请求 chart、projectMeta 收到 null、stage 无 chart', async () => {
    const t = harness();

    const result = await t.run(false);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.chartDegraded).toBe(false);
    expect(t.stages).toEqual(['audio', 'cover', 'save']);
    expect(t.events).toEqual([
      'ids', 'now', 'validate:false',
      'stage:audio', 'audio',
      'stage:cover', 'cover',
      'meta:none',
      'stage:save', 'save',
      'get', 'notify',
    ]);
    expect(t.writes[0]!.project.charts[0]).toMatchObject({
      appliedChartCodeText: null,
      chartCodePristine: false,
    });
  });

  it('封面 null：cover 仍走 stage，落盘只带 audio，结果 coverImported=false', async () => {
    const t = harness({ cover: null });

    const result = await t.run(true);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.coverImported).toBe(false);
    expect(t.stages).toEqual(['audio', 'cover', 'chart', 'save']);
    expect(t.writes[0]!.staged).toEqual({ audioStagedPath: '/audio.mp3' });
    expect(t.writes[0]!.project.coverName).toBeNull();
  });

  it('chart 降级：projectMeta 收到 degraded=true，结果透传 chartDegraded=true', async () => {
    const t = harness({ chart: { codeText: '', degraded: true } });

    const result = await t.run(true);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.chartDegraded).toBe(true);
    expect(t.events).toContain('meta:degraded');
    expect(t.writes[0]!.project.charts[0]).toMatchObject({
      appliedChartCodeText: null,
      chartCodePristine: false,
    });
  });
});

describe('11 · 导入序列：失败与取消', () => {
  it('Apply 拒绝：不 save / 不 notify，save stage 不发射', async () => {
    const t = harness({ chart: { codeText: CHART_BAD, degraded: false } });

    const result = await t.run(true);

    expect(result).toEqual({ ok: false, reason: 'apply', errors: expect.any(Array) });
    expect(t.stages).toEqual(['audio', 'cover', 'chart']);
    expect(t.writes).toHaveLength(0);
    expect(t.notified()).toBe(0);
    expect(t.events).toContain('meta:ok');
    expect(t.events).not.toContain('stage:save');
  });

  it('已 abort：不发任何 stage、不调用源素材方法', async () => {
    const t = harness();
    t.controller.abort();

    await expect(t.run(true)).rejects.toMatchObject({ name: 'AbortError' });

    expect(t.stages).toEqual([]);
    expect(t.events).toEqual(['ids', 'now', 'validate:true']);
    expect(t.writes).toHaveLength(0);
    expect(t.notified()).toBe(0);
  });

  it.each(['audio', 'cover', 'chart'] as const)(
    '在 %s 返回后 abort：下一个检查点即停，不落盘',
    async (point) => {
      const t = harness({ abortAt: point });

      await expect(t.run(true)).rejects.toMatchObject({ name: 'AbortError' });

      const expectedStages: ImportStage[] = point === 'audio'
        ? ['audio']
        : point === 'cover'
          ? ['audio', 'cover']
          : ['audio', 'cover', 'chart'];
      expect(t.stages).toEqual(expectedStages);
      expect(t.writes).toHaveLength(0);
      expect(t.notified()).toBe(0);
      if (point === 'chart') {
        // chart 与 Apply 之间不新增 abort 检查：元数据仍算完，停在 save 前。
        expect(t.events).toContain('meta:ok');
        expect(t.events).not.toContain('stage:save');
      }
    },
  );

  it('validate 抛 misuse：先于 stage audio，不落盘', async () => {
    const t = harness({ validateError: true });

    await expect(t.run(true)).rejects.toThrow('source misuse');

    expect(t.stages).toEqual([]);
    expect(t.events).toEqual(['ids', 'now', 'validate:true']);
    expect(t.writes).toHaveLength(0);
  });
});

describe('11 · 导入序列：时长校正', () => {
  it('探针超差：写第二笔且不重发 stage；notify 恰一次', async () => {
    const t = harness({ audioBlob: true, probe: 100 });

    const result = await t.run(true);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(t.stages).toEqual(['audio', 'cover', 'chart', 'save']);
    expect(t.events).toEqual([
      'ids', 'now', 'validate:true',
      'stage:audio', 'audio',
      'stage:cover', 'cover',
      'stage:chart', 'chart',
      'meta:ok',
      'stage:save', 'save',
      'get', 'probe', 'save2', 'notify',
    ]);
    expect(t.writes.map((w) => w.project.durationSeconds)).toEqual([120, 100]);
    expect(t.writes[1]!.staged).toBeUndefined();
    expect(t.notified()).toBe(1);
  });

  it('探针在容差内：不写第二笔', async () => {
    const t = harness({ audioBlob: true, probe: 120.2 });

    await t.run(true);

    expect(t.writes).toHaveLength(1);
    expect(t.events).not.toContain('save2');
    expect(t.notified()).toBe(1);
  });

  it('探针失败：留初值、不写第二笔、notify 照旧', async () => {
    const t = harness({ audioBlob: true, probe: 'error' });

    const result = await t.run(true);

    expect(result.ok).toBe(true);
    expect(t.writes).toHaveLength(1);
    expect(t.writes[0]!.project.durationSeconds).toBe(120);
    expect(t.events).not.toContain('save2');
    expect(t.notified()).toBe(1);
  });

  it('读回没有 audioBlob：不跑探针', async () => {
    const t = harness();

    await t.run(true);

    expect(t.events).not.toContain('probe');
    expect(t.writes).toHaveLength(1);
  });
});

describe('11 · 取消判定', () => {
  it('AbortError 名字才算取消', () => {
    const abort = new Error('import-cancelled');
    abort.name = 'AbortError';
    expect(isImportCancelled(abort)).toBe(true);
    expect(isImportCancelled(new Error('other'))).toBe(false);
    expect(isImportCancelled(null)).toBe(false);
  });
});
