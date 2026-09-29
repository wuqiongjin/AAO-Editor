// 票 15 定案 8/9：工程音频接缝（按 projectId 读写），音频页唯一的那条写路径。
//
// 这张网要锁住的性质：
//   ① 写非当前工程只动那条记录，**当前工程记录一个字都不许变**（"不切当前工程也能改"的全部意义）；
//   ② 锁在接缝里再挡一次（UI 禁用之外的第二道），锁定工程四个写动作全被挡；
//   ③ 目标是当前工程时先 flush 在飞编辑（否则读-改-写整条记录会盖掉工作台正在编辑的内容）；
//   ④ 探不到时长就整笔不写（不留"有音频但时长还是旧的"这种半截态）。
import { describe, expect, it } from 'vitest';
import {
  ChartProjectStore,
  type ChartProject,
  type ChartProjectBackend,
} from '@/src/project/ChartProject';
import { createUnnamedProject } from '@/src/project/workspaceProject';
import { MAX_DURATION_SECONDS } from '@/src/chart/config/AppSettings';
import {
  clearProjectAudio,
  importProjectAudio,
  readProjectAudio,
  setProjectAudioDuration,
  type ProjectAudioDeps,
} from '@/src/audio/projectAudio';

const NOW = 1_700_000_000_000;

function memoryStore(projects: ChartProject[]) {
  const disk = new Map(projects.map((p) => [p.id, p]));
  const backend: ChartProjectBackend = {
    get: async (id) => disk.get(id) ?? null,
    save: async (project) => { disk.set(project.id, project); },
    list: async () => [...disk.values()],
    delete: async (id) => { disk.delete(id); },
  };
  return { store: new ChartProjectStore(backend), disk };
}

function project(id: string, patch: Partial<ChartProject> = {}): ChartProject {
  return { ...createUnnamedProject({ id, chartId: `c-${id}`, now: NOW }), ...patch };
}

/** 已上传谱面 → 音频与时长锁定（ADR-0015 §4） */
function lockedProject(id: string): ChartProject {
  const base = project(id, { audioName: '锁定.mp3', audioBlob: new Blob([new Uint8Array([1])]) });
  return {
    ...base,
    charts: [{ ...base.charts[0], upload: { postId: 7, at: NOW }, diff: 3, level: 27 }],
  };
}

function audioFile(name = '新音频.mp3', bytes = [1, 2, 3]): File {
  return new File([new Uint8Array(bytes)], name, { type: 'audio/mpeg' });
}

describe('票 15 · 工程音频接缝读路径', () => {
  it('读全域开放：锁定工程照样读得到音频名 / 时长 / 锁原因（点名谱面）', async () => {
    const { store } = memoryStore([lockedProject('pLocked')]);

    const view = await readProjectAudio(store, 'pLocked');

    expect(view).toMatchObject({
      projectId: 'pLocked',
      audioName: '锁定.mp3',
      hasAudio: true,
      locked: true,
    });
    expect(view?.lockedBy).toEqual([{ title: null, diff: 3, level: 27 }]);
  });

  it('工程不存在返回 null（调用方据此走空态 / 回落）', async () => {
    const { store } = memoryStore([]);
    await expect(readProjectAudio(store, 'pGhost')).resolves.toBeNull();
  });
});

describe('票 15 · 工程音频接缝写路径', () => {
  it('写非当前工程：只动那条记录，当前工程记录一个字不变', async () => {
    const { store, disk } = memoryStore([project('pCur'), project('pOther')]);
    const deps: ProjectAudioDeps = {
      store,
      currentProjectId: 'pCur',
      notifyCatalogChanged: () => { /* count */ },
      probeDuration: async () => 145.4,
    };

    const result = await importProjectAudio(deps, 'pOther', audioFile());

    expect(result).toEqual({ ok: true });
    const other = disk.get('pOther')!;
    expect(other.audioName).toBe('新音频.mp3');
    expect(other.audioBlob).toBeInstanceOf(Blob);
    expect(other.durationSeconds).toBe(145.4);
    const current = disk.get('pCur')!;
    expect(current.audioName).toBeNull();
    expect(current.durationSeconds).toBe(30);
  });

  it('目标是当前工程时先落盘在飞编辑，再读-改-写；目标不是当前工程时不落盘', async () => {
    const { store } = memoryStore([project('pCur'), project('pOther')]);
    const log: string[] = [];
    const backendSpy = {
      get: async (id: string) => store.get(id),
      save: async (p: ChartProject) => { await store.save(p); },
      list: async () => [],
      delete: async () => {},
    };
    const spyStore = new ChartProjectStore({
      ...backendSpy,
      get: async (id: string) => { log.push('get'); return backendSpy.get(id); },
    } as ChartProjectBackend);
    const deps: ProjectAudioDeps = {
      store: spyStore,
      currentProjectId: 'pCur',
      flushPersist: async () => { log.push('flush'); },
      notifyCatalogChanged: () => {},
      probeDuration: async () => 90,
    };

    await importProjectAudio(deps, 'pCur', audioFile());
    expect(log).toEqual(['flush', 'get']);

    log.length = 0;
    await importProjectAudio(deps, 'pOther', audioFile());
    expect(log).toEqual(['get']);
  });

  it('通知工程目录刷新（详情行 / 当前工程的会话对齐都靠它）', async () => {
    const { store } = memoryStore([project('pOther')]);
    let notified = 0;
    await importProjectAudio({
      store,
      currentProjectId: null,
      notifyCatalogChanged: () => { notified += 1; },
      probeDuration: async () => 60,
    }, 'pOther', audioFile());

    expect(notified).toBe(1);
  });

  it('锁定工程上四个写动作全被挡，记录不变也不通知（UI 禁用之外的第二道）', async () => {
    const { store, disk } = memoryStore([lockedProject('pLocked')]);
    let notified = 0;
    const deps: ProjectAudioDeps = {
      store,
      currentProjectId: 'pLocked',
      notifyCatalogChanged: () => { notified += 1; },
      probeDuration: async () => 200,
    };
    const before = { ...disk.get('pLocked')! };

    const results = [
      await importProjectAudio(deps, 'pLocked', audioFile()),
      await clearProjectAudio(deps, 'pLocked'),
      await setProjectAudioDuration(deps, 'pLocked', 120),
    ];

    expect(results).toEqual([
      { ok: false, reason: 'locked' },
      { ok: false, reason: 'locked' },
      { ok: false, reason: 'locked' },
    ]);
    expect(disk.get('pLocked')).toEqual(before);
    expect(notified).toBe(0);
  });

  it('工程不存在 → missing（不写）', async () => {
    const { store } = memoryStore([]);
    const deps: ProjectAudioDeps = { store, currentProjectId: null, notifyCatalogChanged: () => {} };

    expect(await clearProjectAudio(deps, 'pGhost')).toEqual({ ok: false, reason: 'missing' });
    expect(await setProjectAudioDuration(deps, 'pGhost', 60)).toEqual({ ok: false, reason: 'missing' });
  });

  it('锁 / 缺失在**解码之前**判掉：不为一次注定失败的导入付一次探针', async () => {
    const { store } = memoryStore([lockedProject('pLocked')]);
    let probed = 0;
    const deps: ProjectAudioDeps = {
      store,
      currentProjectId: null,
      notifyCatalogChanged: () => {},
      probeDuration: async () => { probed += 1; return 200; },
    };

    expect(await importProjectAudio(deps, 'pLocked', audioFile())).toEqual({ ok: false, reason: 'locked' });
    expect(await importProjectAudio(deps, 'pGhost', audioFile())).toEqual({ ok: false, reason: 'missing' });
    expect(probed).toBe(0);
  });

  it('探不到时长 → 整笔不写（不留"有音频但时长还是旧的"半截态）', async () => {
    const { store, disk } = memoryStore([project('pOther')]);
    const deps: ProjectAudioDeps = {
      store,
      currentProjectId: null,
      notifyCatalogChanged: () => {},
      probeDuration: async () => { throw new Error('解不了'); },
    };

    expect(await importProjectAudio(deps, 'pOther', audioFile())).toEqual({ ok: false, reason: 'decode' });
    expect(disk.get('pOther')!.audioName).toBeNull();
  });

  it('清除音频：音频名与 blob 清掉、时长保留当前值（时长是独立字段，不跟着归零）', async () => {
    const { store, disk } = memoryStore([
      project('pOther', {
        audioName: '旧.mp3',
        audioBlob: new Blob([new Uint8Array([1])]),
        durationSeconds: 77,
      }),
    ]);

    expect(await clearProjectAudio({
      store, currentProjectId: null, notifyCatalogChanged: () => {},
    }, 'pOther')).toEqual({ ok: true });

    const after = disk.get('pOther')!;
    expect(after.audioName).toBeNull();
    expect(after.audioBlob).toBeUndefined();
    expect(after.durationSeconds).toBe(77);
  });

  it('改时长：无音频才生效，且 clamp 到上限；有音频时手改无效（时长跟随音频）', async () => {
    const { store, disk } = memoryStore([project('pNoAudio'), project('pWithAudio', { audioName: 'x.mp3' })]);
    const deps: ProjectAudioDeps = { store, currentProjectId: null, notifyCatalogChanged: () => {} };

    await setProjectAudioDuration(deps, 'pNoAudio', MAX_DURATION_SECONDS + 500);
    expect(disk.get('pNoAudio')!.durationSeconds).toBe(MAX_DURATION_SECONDS);

    await setProjectAudioDuration(deps, 'pWithAudio', 120);
    expect(disk.get('pWithAudio')!.durationSeconds).toBe(30);

    expect(await setProjectAudioDuration(deps, 'pNoAudio', Number.NaN)).toEqual({
      ok: false, reason: 'invalid',
    });
  });
});
