// 歌曲级工程存储：多工程读写 / 列表 / 删除往返；封面与音频 set/keep/cleared；无 issue 25 迁移。
import { describe, expect, it, vi } from 'vitest';
import {
  ChartProjectStore,
  ElectronFileProjectBackend,
  IndexedDbProjectBackend,
} from '@/src/project/ChartProject';
import type { ChartProject, ProjectChart } from '@/src/project/ChartProject';
import { PROJECT_SCHEMA_VERSION } from '@/src/project/ChartProjectRecord';
import type { ChartNote } from '@/src/chart/types';
import { makeMemoryProjectBridge } from '@/tests/support/memoryProjectBridge';
import { readStripped } from '@/tests/support/source';

const note = { beat: 4, lane: 3, type: 'Single' } as ChartNote;

function blobOf(bytes: number[]): Blob {
  return new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' });
}

function chart(overrides: Partial<ProjectChart> = {}): ProjectChart {
  return {
    id: 'c1',
    notes: [note],
    title: null,
    diff: 3,
    level: null,
    completed: false,
    upload: null,
    lastModified: 1,
    appliedChartCodeText: null,
    chartCodePristine: false,
    ...overrides,
  };
}

function makeProject(overrides: Partial<ChartProject> = {}): ChartProject {
  return {
    id: 'pSong1',
    name: null,
    artist: null,
    source: { type: 'custom' },
    durationSeconds: 30,
    lastOpened: 1,
    charts: [chart()],
    audioName: null,
    coverName: null,
    ...overrides,
  };
}

describe('ElectronFileProjectBackend · 保存意图', () => {
  it('新音频/封面走 set，携带完整字节并 JSON 规范化 notes（剔除 undefined 属性）', async () => {
    const t = makeMemoryProjectBridge();
    const b = new ElectronFileProjectBackend(t.bridge);
    const dirty = [{ ...note, subBeat: undefined }] as unknown as ChartNote[];
    await b.save(makeProject({
      charts: [chart({ notes: dirty })],
      audioName: 'a.wav',
      audioBlob: blobOf([1, 2, 3]),
      coverName: 'c.png',
      coverBlob: blobOf([9]),
    }));

    expect(t.puts).toHaveLength(1);
    const p = t.puts[0];
    expect(p.id).toBe('pSong1');
    expect(p.doc.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(p.doc.audioIntent).toBe('set');
    expect(p.doc.coverIntent).toBe('set');
    expect(p.doc.audioName).toBe('a.wav');
    expect(p.doc.coverName).toBe('c.png');
    expect(Array.from(p.audio!)).toEqual([1, 2, 3]);
    expect(Array.from(p.cover!)).toEqual([9]);
    expect('subBeat' in p.doc.charts[0].notes[0]).toBe(false);
  });

  it('同一 Blob 实例重复保存走 keep，不重传字节', async () => {
    const t = makeMemoryProjectBridge();
    const b = new ElectronFileProjectBackend(t.bridge);
    const shared = blobOf([7]);
    const cover = blobOf([3]);
    const proj = makeProject({ audioBlob: shared, audioName: 'x.ogg', coverBlob: cover, coverName: 'c.jpg' });
    await b.save({ ...proj });
    await b.save({ ...proj, durationSeconds: 42 });
    await b.save(proj);

    expect(t.puts.map((p) => p.doc.audioIntent)).toEqual(['set', 'keep', 'keep']);
    expect(t.puts.map((p) => p.doc.coverIntent)).toEqual(['set', 'keep', 'keep']);
    expect(t.puts[1].audio).toBeUndefined();
    expect(t.puts[1].cover).toBeUndefined();
    expect(t.puts[1].doc.durationSeconds).toBe(42);
  });

  it('无音频无封面保存走 cleared', async () => {
    const t = makeMemoryProjectBridge();
    const b = new ElectronFileProjectBackend(t.bridge);
    await b.save(makeProject());
    expect(t.puts[0].doc.audioIntent).toBe('cleared');
    expect(t.puts[0].doc.coverIntent).toBe('cleared');
    expect(t.puts[0].audio).toBeUndefined();
    expect(t.puts[0].cover).toBeUndefined();
  });

  it('put 失败回滚音频/封面缓存：下次保存重新补发字节', async () => {
    const t = makeMemoryProjectBridge();
    let failNext = false;
    t.put.mockImplementation(async (p) => {
      if (failNext) throw new Error('ipc down');
      t.puts.push(p);
    });
    const b = new ElectronFileProjectBackend(t.bridge);

    const first = blobOf([1]);
    await b.save(makeProject({ audioBlob: first }));
    failNext = true;
    const second = blobOf([2, 2]);
    await expect(b.save(makeProject({ audioBlob: second }))).rejects.toThrow('ipc down');
    failNext = false;
    await b.save(makeProject({ audioBlob: second }));
    expect(t.puts[t.puts.length - 1].doc.audioIntent).toBe('set');
  });
});

// 票 08：官方 / 社区导入的音频与封面先落下载暂存，由主进程从暂存拷进工程（字节不过 IPC）。
// 这条接缝的坑在「暂存写完之后，手里没有 Blob」——再保存一次不能当清空处理。
describe('ElectronFileProjectBackend · 暂存导入（票 08）', () => {
  it('给了暂存路径就走 set + 只递路径，不带字节', async () => {
    const t = makeMemoryProjectBridge();
    const b = new ElectronFileProjectBackend(t.bridge);

    await b.save(
      makeProject({ audioName: 'bgm001.mp3', coverName: 'yes_bang_dream.png' }),
      {
        audioStagedPath: '/data/downloads/abc-bgm001.mp3',
        coverStagedPath: '/data/downloads/abc-jacket.png',
      },
    );

    const p = t.puts[0];
    expect(p.doc.audioIntent).toBe('set');
    expect(p.doc.coverIntent).toBe('set');
    expect(p.audioStagedPath).toBe('/data/downloads/abc-bgm001.mp3');
    expect(p.coverStagedPath).toBe('/data/downloads/abc-jacket.png');
    expect(p.audio).toBeUndefined();
    expect(p.cover).toBeUndefined();
    expect(t.disk.get('pSong1')?.doc.audioPresent).toBe(true);
  });

  it('暂存写完之后再保存（手里没有 Blob）走 keep：不能把刚导入的音频抹掉', async () => {
    const t = makeMemoryProjectBridge();
    const b = new ElectronFileProjectBackend(t.bridge);
    const proj = makeProject({ audioName: 'bgm001.mp3', coverName: 'j.png' });
    await b.save(proj, {
      audioStagedPath: '/data/downloads/a.mp3',
      coverStagedPath: '/data/downloads/c.png',
    });

    await b.save({ ...proj, name: '改了工程名' });

    const p = t.puts[1];
    expect(p.doc.audioIntent).toBe('keep');
    expect(p.doc.coverIntent).toBe('keep');
    expect(t.disk.get('pSong1')?.doc.audioPresent).toBe(true);
    expect(t.disk.get('pSong1')?.doc.audioName).toBe('bgm001.mp3');
  });

  it('读回一次（拿到真字节）之后：清空音频仍然照旧走 cleared', async () => {
    const t = makeMemoryProjectBridge();
    const b = new ElectronFileProjectBackend(t.bridge);
    await b.save(makeProject({ audioName: 'a.wav', audioBlob: blobOf([1]) }));

    const restored = await b.get('pSong1');
    await b.save({ ...restored!, audioName: null, audioBlob: undefined } as ChartProject);

    expect(t.puts[t.puts.length - 1].doc.audioIntent).toBe('cleared');
    expect(t.disk.get('pSong1')?.doc.audioPresent).toBe(false);
  });
});

describe('ElectronFileProjectBackend · 读取与多工程', () => {
  it('get 重建工程并缓存音频身份：紧随的保存命中 keep', async () => {
    const t = makeMemoryProjectBridge();
    await t.bridge.put({
      id: 'pSong1',
      doc: {
        schemaVersion: PROJECT_SCHEMA_VERSION,
        name: null,
        artist: null,
        source: { type: 'custom' },
        durationSeconds: 61.5,
        lastOpened: 9,
        charts: [chart()],
        audioName: 'song.mp3',
        coverName: null,
        audioIntent: 'set',
        coverIntent: 'cleared',
      },
      audio: new Uint8Array([9, 9]),
    });
    const b = new ElectronFileProjectBackend(t.bridge);
    const restored = await b.get('pSong1');
    expect(restored).toMatchObject({
      id: 'pSong1',
      durationSeconds: 61.5,
      audioName: 'song.mp3',
    });
    expect(restored!.audioBlob).toBeInstanceOf(Blob);
    await expect(restored!.audioBlob!.arrayBuffer()).resolves.toHaveProperty('byteLength', 2);

    await b.save(restored!);
    expect(t.puts[t.puts.length - 1].doc.audioIntent).toBe('keep');
  });

  it('doc 为空 / 磁盘无数据返回 null', async () => {
    const b = new ElectronFileProjectBackend(makeMemoryProjectBridge().bridge);
    await expect(b.get('pMissing1')).resolves.toBeNull();
  });

  it('多工程读写 / 列表 / 删除往返', async () => {
    const t = makeMemoryProjectBridge();
    const b = new ElectronFileProjectBackend(t.bridge);
    const a = makeProject({ id: 'pA', name: 'A', lastOpened: 10 });
    const c = makeProject({ id: 'pC', name: 'C', lastOpened: 30, charts: [chart({ id: 'c2', diff: 4 })] });
    await b.save(a);
    await b.save(c);

    const listed = await b.list();
    expect(listed.map((p) => p.id).sort()).toEqual(['pA', 'pC']);
    expect(listed.find((p) => p.id === 'pC')?.charts[0].diff).toBe(4);
    expect(listed.every((p) => p.audioBlob == null)).toBe(true);

    await expect(b.get('pA')).resolves.toMatchObject({ name: 'A', lastOpened: 10 });
    await b.delete('pA');
    expect((await b.list()).map((p) => p.id)).toEqual(['pC']);
    await expect(b.get('pA')).resolves.toBeNull();
    await expect(b.get('pC')).resolves.toMatchObject({ name: 'C' });
  });

  it('list 带封面字节、不带音频', async () => {
    const t = makeMemoryProjectBridge();
    const b = new ElectronFileProjectBackend(t.bridge);
    await b.save(makeProject({
      audioName: 'a.wav',
      audioBlob: blobOf([1, 2, 3]),
      coverName: 'c.png',
      coverBlob: blobOf([9, 9]),
    }));
    const listed = await b.list();
    expect(listed).toHaveLength(1);
    expect(listed[0].audioBlob).toBeUndefined();
    expect(listed[0].coverBlob).toBeInstanceOf(Blob);
    await expect(listed[0].coverBlob!.arrayBuffer()).resolves.toHaveProperty('byteLength', 2);
  });

  it('删除后记录与音频、封面字节都不在存储里', async () => {
    const t = makeMemoryProjectBridge();
    const b = new ElectronFileProjectBackend(t.bridge);
    await b.save(makeProject({
      audioName: 'a.wav',
      audioBlob: blobOf([1, 2, 3]),
      coverName: 'c.png',
      coverBlob: blobOf([9, 9]),
    }));
    expect(t.disk.get('pSong1')?.audio).toEqual(new Uint8Array([1, 2, 3]));
    expect(t.disk.get('pSong1')?.cover).toEqual(new Uint8Array([9, 9]));

    await b.delete('pSong1');
    expect(t.disk.has('pSong1')).toBe(false);
    await expect(b.get('pSong1')).resolves.toBeNull();
    expect((await b.list()).map((p) => p.id)).toEqual([]);
  });
});

describe('安全与门面', () => {
  it('非法工程 id 在渲染侧即拒绝（双保险，主进程另有白名单）', async () => {
    const t = makeMemoryProjectBridge();
    const b = new ElectronFileProjectBackend(t.bridge);
    await expect(b.get('../evil')).rejects.toThrow('非法的谱面工程 id');
    await expect(b.save(makeProject({ id: '.hidden' }))).rejects.toThrow('非法的谱面工程 id');
    await expect(b.delete('..')).rejects.toThrow('非法的谱面工程 id');
    expect(t.puts).toHaveLength(0);
  });

  it('门面委托所选后端；无参构造在 node 环境安全落到 IndexedDB 后端', async () => {
    const backend = {
      get: vi.fn(async () => null),
      save: vi.fn(async () => {}),
      list: vi.fn(async () => []),
      delete: vi.fn(async () => {}),
    };
    const store = new ChartProjectStore(backend);
    const proj = makeProject();
    await store.save(proj);
    await store.get('pSong1');
    await store.list();
    await store.delete('pSong1');
    expect(backend.save).toHaveBeenCalledWith(proj, undefined);

    // 暂存导入的来源声明原样透传给后端（票 08）
    const staged = { audioStagedPath: '/data/downloads/a.mp3' };
    await store.save(proj, staged);
    expect(backend.save).toHaveBeenCalledWith(proj, staged);
    expect(backend.get).toHaveBeenCalledWith('pSong1');
    expect(backend.list).toHaveBeenCalled();
    expect(backend.delete).toHaveBeenCalledWith('pSong1');

    expect(new ChartProjectStore()).toBeInstanceOf(ChartProjectStore);
    expect(new IndexedDbProjectBackend()).toBeDefined();
  });

  it('源码不再含 IndexedDB→文件迁移', () => {
    const src = readStripped('src/project/ChartProject.ts');
    expect(src).not.toMatch(/ensureMigratedOnce/);
    expect(src).not.toMatch(/legacyRead/);
    expect(readStripped('electron/main.cjs')).not.toMatch(/首启迁移/);
  });
});
