import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 记账模块的失败降级与批次隔离锁测。模块内有按 hintId 的 `unwritable` 集合，
 * 所以每条用例都 `vi.resetModules()` 后动态 import，拿到全新实例，避免用例间串味。
 * 这里在 node 环境（无 window），localStorage 用桩显式注入。
 */
const HINT_A = 'stage-cover';
const HINT_B = 'some-future-feature';
const KEY_A = 'aao.previewDiscovery.stage-cover.v1';

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
  } as Storage;
}

async function freshModule() {
  vi.resetModules();
  return import('@/src/pages/preview/previewFeatureDiscovery');
}

describe('previewFeatureDiscovery · 批次键、三段记账与失败降级', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', memoryStorage()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('键按批次拼：新批次在老用户机器上天然 unseen，与旧批次互不覆盖', async () => {
    const m = await freshModule();
    expect(m.discoveryKey(HINT_A)).toBe(KEY_A);
    m.markVisited(HINT_A);
    expect(m.readDiscovery(HINT_A)).toBe('visited');
    expect(m.readDiscovery(HINT_B)).toBe('unseen');
    m.markOpened(HINT_B);
    expect(m.readDiscovery(HINT_A)).toBe('visited');
    expect(localStorage.getItem(m.discoveryKey(HINT_B))).toBe('opened');
  });

  it('unseen → opened → visited 顺序落盘，opened 不覆盖 visited', async () => {
    const m = await freshModule();
    expect(m.readDiscovery(HINT_A)).toBe('unseen');
    m.markOpened(HINT_A);
    expect(localStorage.getItem(KEY_A)).toBe('opened');
    m.markOpened(HINT_A);
    expect(localStorage.getItem(KEY_A)).toBe('opened');
    m.markVisited(HINT_A);
    expect(localStorage.getItem(KEY_A)).toBe('visited');
    m.markOpened(HINT_A);
    expect(localStorage.getItem(KEY_A)).toBe('visited');
  });

  it('读不到存储当 visited：不反复提示', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
    });
    const m = await freshModule();
    expect(m.readDiscovery(HINT_A)).toBe('visited');
  });

  it('写失败只影响该批次：本次会话内当 visited，其他批次照常', async () => {
    let fail = false;
    const store = memoryStorage();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.getItem(k),
      setItem: (k: string, v: string) => {
        if (fail && k === KEY_A) throw new Error('quota');
        store.setItem(k, v);
      },
    });
    const m = await freshModule();
    expect(m.readDiscovery(HINT_A)).toBe('unseen');
    fail = true;
    expect(() => m.markVisited(HINT_A)).not.toThrow();
    expect(m.readDiscovery(HINT_A)).toBe('visited');
    expect(m.readDiscovery(HINT_B)).toBe('unseen');
    m.markVisited(HINT_B);
    expect(m.readDiscovery(HINT_B)).toBe('visited');
  });
});
