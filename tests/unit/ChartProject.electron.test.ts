// issue 25 存储后端 Electron 改造：文件后端纯逻辑单测（node 环境，桥/旧数据源可注入）。
// 覆盖：保存意图判定（set/keep/cleared）、JSON 规范化、失败回滚、重建缓存、
// 首启静默迁移幂等性、工程 id 双保险校验、门面委托。
import { describe, expect, it, vi } from 'vitest';
import {
  ChartProjectStore,
  DEFAULT_PROJECT_ID,
  ElectronFileProjectBackend,
  IndexedDbProjectBackend,
} from '../../src/utils/ChartProject';
import type {
  ChartProject,
  ElectronProjectBridge,
  ProjectGetWire,
  ProjectPutWire,
} from '../../src/utils/ChartProject';
import type { ChartNote } from '../../src/notes/Charts';

const note = { beat: 4, lane: 3, type: 'Single' } as ChartNote;

/** 可观测的假 IPC 桥：记录 put 载荷，get 返回可预设的磁盘态 */
function makeBridge(initial: ProjectGetWire | null = null) {
  const puts: ProjectPutWire[] = [];
  let disk: ProjectGetWire | null = initial;
  const get = vi.fn(async (): Promise<ProjectGetWire | null> => disk);
  const put = vi.fn(async (p: ProjectPutWire) => {
    puts.push(p);
    // 最小保真：仅维护「是否有音频」供后续 get；音符本身不入桩
    disk = {
      doc: { ...p.doc, audioPresent: p.doc.audioIntent === 'set' },
      audio: p.doc.audioIntent === 'set' ? (p.audio ?? null) : disk?.audio ?? null,
    };
  });
  const bridge: ElectronProjectBridge = { get, put };
  return { bridge, get, put, puts };
}

function blobOf(bytes: number[]): Blob {
  return new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' });
}

function makeProject(overrides: Partial<ChartProject> = {}): ChartProject {
  return { id: DEFAULT_PROJECT_ID, durationSeconds: 30, notes: [note], ...overrides };
}

describe('ElectronFileProjectBackend · 保存意图', () => {
  it('新音频走 set，携带完整字节并 JSON 规范化 notes（剔除 undefined 属性）', async () => {
    const t = makeBridge();
    const b = new ElectronFileProjectBackend(t.bridge);
    const dirty = [{ ...note, subBeat: undefined }] as unknown as ChartNote[];
    await b.save(makeProject({ notes: dirty, audioName: 'a.wav', audioBlob: blobOf([1, 2, 3]) }));

    expect(t.puts).toHaveLength(1);
    const p = t.puts[0];
    expect(p.id).toBe(DEFAULT_PROJECT_ID);
    expect(p.doc.schemaVersion).toBe(1);
    expect(p.doc.audioIntent).toBe('set');
    expect(p.doc.audioName).toBe('a.wav');
    expect(Array.from(p.audio!)).toEqual([1, 2, 3]);
    expect('subBeat' in p.doc.notes[0]).toBe(false); // JSON 往返剔除 undefined 键
  });

  it('同一 Blob 实例重复保存走 keep，不重传字节（防抖保存不重写大音频）', async () => {
    const t = makeBridge();
    const b = new ElectronFileProjectBackend(t.bridge);
    const shared = blobOf([7]);
    const proj = makeProject({ audioBlob: shared, audioName: 'x.ogg' });
    await b.save({ ...proj }); // set
    await b.save({ ...proj, durationSeconds: 42 }); // 音频同一实例
    await b.save(proj); // 原对象

    expect(t.puts.map((p) => p.doc.audioIntent)).toEqual(['set', 'keep', 'keep']);
    expect(t.puts[1].audio).toBeUndefined();
    expect(t.puts[1].doc.durationSeconds).toBe(42); // keep 的那次带新时长
    expect(t.puts[2].doc.durationSeconds).toBe(30); // 原对象那次
  });

  it('无音频保存走 cleared', async () => {
    const t = makeBridge();
    const b = new ElectronFileProjectBackend(t.bridge);
    await b.save(makeProject()); // 无 audioBlob
    expect(t.puts[0].doc.audioIntent).toBe('cleared');
    expect(t.puts[0].audio).toBeUndefined();
  });

  it('put 失败回滚音频缓存：下次保存重新补发字节（重试自愈）', async () => {
    const t = makeBridge();
    let failNext = false;
    t.put.mockImplementation(async (p: ProjectPutWire) => {
      if (failNext) throw new Error('ipc down');
      t.puts.push(p);
    });
    const b = new ElectronFileProjectBackend(t.bridge);

    const first = blobOf([1]);
    await b.save(makeProject({ audioBlob: first })); // 成功，缓存 = first
    failNext = true;
    const second = blobOf([2, 2]); // 换了新音频
    await expect(b.save(makeProject({ audioBlob: second }))).rejects.toThrow('ipc down');
    failNext = false;
    await b.save(makeProject({ audioBlob: second })); // 缓存已回滚到 first ⇒ 应重发 set
    expect(t.puts[t.puts.length - 1].doc.audioIntent).toBe('set');
  });
});

describe('ElectronFileProjectBackend · 读取与迁移', () => {
  it('get 重建工程并缓存音频身份：紧随的保存命中 keep', async () => {
    const t = makeBridge({
      doc: {
        schemaVersion: 1,
        durationSeconds: 61.5,
        notes: [note],
        audioName: 'song.mp3',
        audioPresent: true,
      },
      audio: new Uint8Array([9, 9]),
    });
    const b = new ElectronFileProjectBackend(t.bridge);
    const restored = await b.get();
    expect(restored).toMatchObject({
      id: DEFAULT_PROJECT_ID,
      durationSeconds: 61.5,
      audioName: 'song.mp3',
    });
    expect(restored!.audioBlob).toBeInstanceOf(Blob);
    await expect(restored!.audioBlob!.arrayBuffer()).resolves.toHaveProperty('byteLength', 2);

    await b.save(restored!);
    expect(t.puts[0].doc.audioIntent).toBe('keep'); // 不重传恢复来的音频
  });

  it('doc 为空 / 磁盘无数据返回 null', async () => {
    const b = new ElectronFileProjectBackend(makeBridge(null).bridge);
    await expect(b.get()).resolves.toBeNull();
  });

  it('首启静默迁移：文件侧为空时从旧存储迁入（含字节），每进程至多一次，绝不覆盖已有文件数据', async () => {
    const empty = makeBridge(null);
    const legacy = vi.fn(async () => makeProject({ audioBlob: blobOf([5]), audioName: 'old.wav' }));
    const b = new ElectronFileProjectBackend(empty.bridge, legacy);

    await b.get(); // 触发迁移：put(set) 落入文件侧；此时 get 已错过但下一击可见
    await b.get();

    expect(empty.put).toHaveBeenCalledTimes(1);
    expect(empty.puts[0].doc.audioIntent).toBe('set');
    expect(legacy).toHaveBeenCalledTimes(1); // 幂等：第二次 get 不再迁

    // 文件侧已有数据：legacy 完全不被触碰
    const populated = makeBridge({
      doc: { schemaVersion: 1, durationSeconds: 9, notes: [], audioName: null, audioPresent: false },
      audio: null,
    });
    const legacy2 = vi.fn(async () => null);
    await new ElectronFileProjectBackend(populated.bridge, legacy2).get();
    expect(legacy2).not.toHaveBeenCalled();
  });

  it('迁移来源异常时静默跳过，不影响正常读写路径', async () => {
    const t = makeBridge(null);
    const legacy = vi.fn(async () => {
      throw new Error('no idb');
    });
    const b = new ElectronFileProjectBackend(t.bridge, legacy);
    await expect(b.get()).resolves.toBeNull();
    expect(t.put).not.toHaveBeenCalled();
  });
});

describe('安全与门面', () => {
  it('非法工程 id 在渲染侧即拒绝（双保险，主进程另有白名单）', async () => {
    const t = makeBridge();
    const b = new ElectronFileProjectBackend(t.bridge);
    await expect(b.get('../evil')).rejects.toThrow('非法的谱面工程 id');
    await expect(b.save(makeProject({ id: '.hidden' }))).rejects.toThrow('非法的谱面工程 id');
    expect(t.put).not.toHaveBeenCalled();
  });

  it('门面委托所选后端并透传默认 id；无参构造在 node 环境安全落到 IndexedDB 后端', async () => {
    const backend = {
      get: vi.fn(async () => null),
      save: vi.fn(async () => {}),
    };
    const store = new ChartProjectStore(backend);
    await store.save(makeProject());
    await store.get();
    expect(backend.save).toHaveBeenCalledWith(makeProject());
    expect(backend.get).toHaveBeenCalledWith(DEFAULT_PROJECT_ID);

    // 无参构造：window 不存在 ⇒ 自动 IndexedDB 后端；构造本身不得抛错（openDb 惰性）
    expect(new ChartProjectStore()).toBeInstanceOf(ChartProjectStore);
    // 导出面完整性：原实现类仍在公开 API 上
    expect(new IndexedDbProjectBackend()).toBeDefined();
  });
});
