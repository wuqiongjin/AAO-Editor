// chart-projects 21：`ChartProjectStore` 的封面 Blob **身份稳定化**。
//
// 背景：`useCoverUrl` 按 **Blob 身份** 缓存 objectURL（issue 19 #3，避免进详情时封面闪）。
// 但两个后端的读回路径都给出**新 Blob 对象**（IndexedDB `getAll()` 反序列化 / Electron `blobFromBytes`），
// 于是每次 mutate → reload → `list()` 后所有封面缓存未命中：重新 createObjectURL + 重新解码 = 所有封面闪一下。
// store 记住本会话内读/写过的封面实例，字节尺寸没变就沿用同一实例；尺寸变了（换过图）以新读到的为准。
import { describe, expect, it } from 'vitest';
import {
  ChartProjectStore,
  type ChartProject,
  type ChartProjectBackend,
  type ProjectChart,
} from '@/src/project/ChartProject';

/** 每次读回都新建 Blob 对象 —— 与 IndexedDB / 文件后端的反序列化语义一致（这正是复现条件）。 */
class ChurningBackend implements ChartProjectBackend {
  private readonly data = new Map<string, ChartProject>();

  async get(id: string): Promise<ChartProject | null> {
    return this.clone(this.data.get(id) ?? null);
  }

  async list(): Promise<ChartProject[]> {
    return [...this.data.values()].map((p) => this.clone(p)!);
  }

  async save(project: ChartProject): Promise<void> {
    this.data.set(project.id, { ...project });
  }

  async delete(id: string): Promise<void> {
    this.data.delete(id);
  }

  private clone(p: ChartProject | null): ChartProject | null {
    if (!p) return null;
    return {
      ...p,
      ...(p.coverBlob ? { coverBlob: new Blob([p.coverBlob], { type: p.coverBlob.type }) } : {}),
      ...(p.audioBlob ? { audioBlob: new Blob([p.audioBlob], { type: p.audioBlob.type }) } : {}),
    };
  }
}

function chart(): ProjectChart {
  return {
    id: 'c1', notes: [{ beat: 0, type: 'BPM', bpm: 120 }],
    title: null, diff: 3, level: 27, completed: false, upload: null,
    lastModified: 1, appliedChartCodeText: null, chartCodePristine: false,
  };
}

function project(cover?: Blob): ChartProject {
  return {
    id: 'p1', name: 'FIRE BIRD', artist: null, source: { type: 'custom' },
    durationSeconds: 30, lastOpened: 100, charts: [chart()],
    audioName: null, coverName: cover ? 'cover.png' : null,
    ...(cover ? { coverBlob: cover } : {}),
  };
}

const coverOf = (bytes: number[]) => new Blob([new Uint8Array(bytes)], { type: 'image/png' });

describe('chart-projects 21 · 封面 Blob 身份稳定化', () => {
  it('连续两次 list()：同一工程返回同一个封面 Blob 实例（URL 缓存才能命中）', async () => {
    const store = new ChartProjectStore(new ChurningBackend());
    await store.save(project(coverOf([1, 2, 3])));

    const first = (await store.list())[0];
    const second = (await store.list())[0];

    expect(first.coverBlob).toBeDefined();
    expect(second.coverBlob).toBe(first.coverBlob);
  });

  it('编辑流（get → 改 → save → reload）：封面实例全程不变', async () => {
    const store = new ChartProjectStore(new ChurningBackend());
    await store.save(project(coverOf([1, 2, 3])));
    const rendered = (await store.list())[0]; // 页面上正在渲染的那份

    const loaded = await store.get('p1');
    expect(loaded!.coverBlob).toBe(rendered.coverBlob); // mutate 读回的就是渲染中的实例
    await store.save({ ...loaded!, name: 'FIRE BIRD（改）' });

    const reloaded = (await store.list())[0];
    expect(reloaded.name).toBe('FIRE BIRD（改）');
    expect(reloaded.coverBlob).toBe(rendered.coverBlob);
  });

  it('换封面（尺寸不同）：以新读到的实例为准，不被旧实例顶替', async () => {
    const store = new ChartProjectStore(new ChurningBackend());
    await store.save(project(coverOf([1, 2, 3])));
    const before = (await store.list())[0].coverBlob;

    await store.save(project(coverOf([9, 9, 9, 9, 9])));
    const after = (await store.list())[0].coverBlob;

    expect(after).not.toBe(before);
    expect(after!.size).toBe(5);
  });

  it('无封面：读回仍无 coverBlob（不因稳定化凭空长出来）', async () => {
    const store = new ChartProjectStore(new ChurningBackend());
    await store.save(project());
    expect((await store.get('p1'))!.coverBlob).toBeUndefined();
    expect((await store.list())[0].coverBlob).toBeUndefined();
  });

  it('删除工程后重读：不残留旧实例', async () => {
    const store = new ChartProjectStore(new ChurningBackend());
    await store.save(project(coverOf([1, 2, 3])));
    await store.delete('p1');
    expect(await store.get('p1')).toBeNull();
    expect(await store.list()).toEqual([]);
  });
});

/** list() 计数后端：验「并发 list 合并成一次读盘」（issue 29）。 */
function countingBackend(projects: ChartProject[]): { backend: ChartProjectBackend; listCalls: () => number } {
  let listCalls = 0;
  const backend: ChartProjectBackend = {
    get: async (id) => projects.find((p) => p.id === id) ?? null,
    list: async () => {
      listCalls += 1;
      return projects;
    },
    save: async () => {},
    delete: async () => {},
  };
  return { backend, listCalls: () => listCalls };
}

describe('issue 29 · list() 进行中去重（启动预载与页面挂载共用一个 Promise）', () => {
  it('并发两次 list()：只读一次盘，两边拿到同一份结果', async () => {
    const { backend, listCalls } = countingBackend([project()]);
    const store = new ChartProjectStore(backend);

    const [first, second] = await Promise.all([store.list(), store.list()]);

    expect(listCalls()).toBe(1);
    expect(first).toBe(second);
  });

  it('settle 之后不留结果缓存：下一次 list() 重新读盘（编辑后的 reload 要看得到新数据）', async () => {
    const { backend, listCalls } = countingBackend([project()]);
    const store = new ChartProjectStore(backend);

    await store.list();
    await store.list();

    expect(listCalls()).toBe(2);
  });

  it('一次 list() 失败不粘住后来的调用者（闸门在 finally 里清）', async () => {
    let calls = 0;
    const backend: ChartProjectBackend = {
      get: async () => null,
      list: async () => {
        calls += 1;
        if (calls === 1) throw new Error('读盘炸了');
        return [project()];
      },
      save: async () => {},
      delete: async () => {},
    };
    const store = new ChartProjectStore(backend);

    await expect(store.list()).rejects.toThrow('读盘炸了');
    await expect(store.list()).resolves.toHaveLength(1);
  });
});

describe('chart-projects 39 · resetCatalogCaches（切数据根：按 id 的会话派生值作废）', () => {
  it('同 id 同尺寸封面：reset 后按新盘字节出新实例，不把旧根的 Blob 漏给新盘', async () => {
    const backend = new ChurningBackend();
    const store = new ChartProjectStore(backend);
    // 旧根：p1 封面 3 字节
    await store.save(project(coverOf([1, 2, 3])));
    const oldCover = (await store.list())[0].coverBlob;

    // 新根：同 id、同尺寸的另一张封面（拷贝/备份出来的目录）
    await backend.save(project(coverOf([7, 7, 7])));
    // 不 reset：尺寸没变 → 稳定器把旧根 Blob 顶回来（本票要防的漏值）
    expect((await store.list())[0].coverBlob).toBe(oldCover);

    store.resetCatalogCaches();
    const after = (await store.list())[0].coverBlob;
    expect(after).not.toBe(oldCover);
    expect(after!.size).toBe(3);
  });

  it('lastOpened 下限记忆作废：reset 后旧根时间戳不再被 save 盖回新盘', async () => {
    const backend = new ChurningBackend();
    const store = new ChartProjectStore(backend);
    // 旧根：p1 lastOpened=100 → store 的 floor 记忆=100
    await store.save(project(coverOf([1, 2, 3])));
    expect((await store.get('p1'))!.lastOpened).toBe(100);

    // 新根（同 id）：lastOpened=50
    await backend.save({ ...project(coverOf([1, 2, 3])), lastOpened: 50 });
    await store.save((await backend.get('p1'))!);
    expect((await backend.get('p1'))!.lastOpened).toBe(100); // 旧根的 floor 把新盘的 50 盖成 100

    // reset 后：floor 作废，按新盘原值落
    await backend.save({ ...project(coverOf([1, 2, 3])), lastOpened: 50 });
    store.resetCatalogCaches();
    await store.save((await backend.get('p1'))!);
    expect((await backend.get('p1'))!.lastOpened).toBe(50);
  });

  it('reset 不影响正常读写：清完再 list/get 照常从盘上重建', async () => {
    const backend = new ChurningBackend();
    const store = new ChartProjectStore(backend);
    await store.save(project(coverOf([1, 2, 3])));
    store.resetCatalogCaches();

    const listed = (await store.list())[0];
    expect(listed.coverBlob).toBeDefined();
    const got = await store.get('p1');
    expect(got!.coverBlob).toBe(listed.coverBlob); // 重建后同一会话内再次稳定
  });
});
