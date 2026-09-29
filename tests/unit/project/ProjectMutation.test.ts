// 架构评审候选 2（06 票）：唯一写入口 mutateProject 的次序与失败语义。
//
// 锁住的性质：
//   ① 次序固定 flush → get → fn → save → notify（次序约束从注释变成代码）；
//   ② fn 返回 null = 调用方取消：不写、不通知（锁 / 解码失败 / 无需改动都走这条）；
//   ③ 工程不存在 → missing，fn 根本不被调用；
//   ④ fn / save 抛错 → 不通知、错误上抛（重试语义留给调用方）；
//   ⑤ fn 可以是 async（解码、上传这类慢步骤仍在这条次序内）。
import { describe, expect, it, vi } from 'vitest';
import { mutateProject, type ProjectMutationStore } from '@/src/project/ChartProjectRecord';
import type { ChartProject } from '@/src/project/ChartProject';

function project(id = 'p1', patch: Partial<ChartProject> = {}): ChartProject {
  return {
    id,
    name: 'FIRE BIRD',
    artist: null,
    source: { type: 'custom' },
    durationSeconds: 30,
    lastOpened: 100,
    charts: [],
    audioName: null,
    coverName: null,
    ...patch,
  };
}

/** 记录每一次读写次序的内存 store；读回的是浅拷贝，模拟真实后端的反序列化。 */
function makeStore(initial: ChartProject | null, opts: { saveFails?: Error } = {}) {
  const log: string[] = [];
  let current = initial;
  const store: ProjectMutationStore = {
    get: vi.fn(async (id: string) => {
      log.push('get');
      return current && current.id === id ? { ...current } : null;
    }),
    save: vi.fn(async (next: ChartProject) => {
      log.push('save');
      if (opts.saveFails) throw opts.saveFails;
      current = { ...next };
    }),
  };
  return { store, log, disk: () => current };
}

function deps(store: ProjectMutationStore, log: string[], withFlush = true) {
  return {
    store,
    ...(withFlush ? { flush: async () => { log.push('flush'); } } : {}),
    notify: () => { log.push('notify'); },
  };
}

describe('06 · mutateProject：唯一写入口', () => {
  it('次序 flush → get → fn → save → notify，notify 恰一次且在 save 之后', async () => {
    const { store, log, disk } = makeStore(project());
    const seen: ChartProject[] = [];

    const result = await mutateProject(deps(store, log), 'p1', (p) => {
      log.push('fn');
      seen.push(p);
      return { ...p, name: '改了' };
    });

    expect(log).toEqual(['flush', 'get', 'fn', 'save', 'notify']);
    expect(result).toEqual({ status: 'saved', project: expect.objectContaining({ name: '改了' }) });
    expect(disk()!.name).toBe('改了');
    // fn 拿到的是 store 读回来的那一份（带盘上原值，不是调用方手上的任何快照）
    expect(seen[0]).toMatchObject({ id: 'p1', name: 'FIRE BIRD', lastOpened: 100 });
  });

  it('fn 返回 null（取消）：不 save、不 notify、status = cancelled', async () => {
    const { store, log, disk } = makeStore(project());

    const result = await mutateProject(deps(store, log), 'p1', () => null);

    expect(result).toEqual({ status: 'cancelled' });
    expect(log).toEqual(['flush', 'get']);
    expect(disk()!.name).toBe('FIRE BIRD');
  });

  it('工程不存在：status = missing，fn 不被调用', async () => {
    const { store, log } = makeStore(null);
    const fn = vi.fn(() => project());

    const result = await mutateProject(deps(store, log), 'pGhost', fn);

    expect(result).toEqual({ status: 'missing' });
    expect(fn).not.toHaveBeenCalled();
    expect(log).toEqual(['flush', 'get']);
  });

  it('fn 抛错：不 save、不 notify、错误上抛', async () => {
    const { store, log } = makeStore(project());

    await expect(mutateProject(deps(store, log), 'p1', () => {
      throw new Error('改不动');
    })).rejects.toThrow('改不动');

    expect(log).toEqual(['flush', 'get']);
    expect(store.save).not.toHaveBeenCalled();
  });

  it('save 抛错：不 notify、错误上抛', async () => {
    const { store, log } = makeStore(project(), { saveFails: new Error('盘满') });

    await expect(mutateProject(deps(store, log), 'p1', (p) => ({ ...p, name: 'x' })))
      .rejects.toThrow('盘满');

    expect(log).toEqual(['flush', 'get', 'save']);
  });

  it('flush 省略时照常工作（目标不可能是当前工程 / 没有会话在飞）', async () => {
    const { store, log } = makeStore(project());

    const result = await mutateProject(deps(store, log, false), 'p1', (p) => ({ ...p, name: 'x' }));

    expect(result.status).toBe('saved');
    expect(log).toEqual(['get', 'save', 'notify']);
  });

  it('fn 可以是 async：慢步骤（解码 / 上传）仍在这条次序内', async () => {
    const { store, log } = makeStore(project());

    const result = await mutateProject(deps(store, log), 'p1', async (p) => {
      log.push('fn:start');
      await Promise.resolve();
      log.push('fn:end');
      return { ...p, name: '解码后' };
    });

    expect(log).toEqual(['flush', 'get', 'fn:start', 'fn:end', 'save', 'notify']);
    expect(result.status).toBe('saved');
  });
});
