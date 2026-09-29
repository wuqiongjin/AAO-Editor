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
