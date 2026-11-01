// issue 184 · 片段库存储层（ADR-0023 §3）：
// 两条后端 round-trip、Electron 路径正确、无文件不落盘、损坏文件回落空库且备份 `.broken`、
// 采集命名与整库追加落盘。
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChartNote } from '@/src/chart/types';
import {
  PATTERNS_DIRNAME,
  PATTERNS_FILENAME,
  ensureDataRootLayoutSync,
  patternLibraryPath,
  patternsDir,
} from '@/electron/dataRoot.cjs';
import { loadPatternLibrary, savePatternLibrary } from '@/electron/patternLibrary.cjs';
import {
  ElectronFilePatternLibraryBackend,
  IndexedDbPatternLibraryBackend,
  PatternStore,
  exceedsPatternBackupThreshold,
  patternLibraryBytes,
  type ElectronPatternLibraryBridge,
} from '@/src/chart/patterns/PatternStore';
import { PATTERN_LIBRARY_BACKUP_THRESHOLD_BYTES, type Pattern } from '@/src/chart/patterns/types';
import { setActiveUiLanguage } from '@/src/i18n/t';
import { tmpDir } from '@/tests/support/fs';

function pattern(overrides: Partial<Pattern> = {}): Pattern {
  return {
    id: 'p1',
    name: '片段 1',
    createdAt: 1,
    notes: [{ type: 'Single', beat: 1, lane: 2 } as ChartNote],
    bpmContext: { startBpm: 120, events: [] },
    ...overrides,
  };
}

/* ------------------------------- 内存桥 ------------------------------- */

function makeMemoryBridge(initial: unknown = null) {
  let doc: unknown = initial;
  const saves: Pattern[][] = [];
  const bridge: ElectronPatternLibraryBridge = {
    load: async () => doc,
    saveAll: async (patterns) => {
      const copy = patterns.map((p) => structuredClone(p));
      saves.push(copy);
      doc = { schemaVersion: 1, patterns: copy };
      return true;
    },
  };
  return { bridge, saves, doc: () => doc };
}

/* ----------------------------- 假 IndexedDB ---------------------------- */

/** 只实现后端用到的那一小片 IDB API：open / upgrade / transaction / get / put。 */
function makeFakeIndexedDb() {
  const records = new Map<string, unknown>();
  let storeCreated = false;

  const db = {
    objectStoreNames: { contains: (name: string) => storeCreated && name === 'library' },
    createObjectStore: () => {
      storeCreated = true;
      return {};
    },
    transaction: () => {
      const tx = {
        objectStore: () => ({
          get: (key: string) => {
            const req: { result?: unknown; onsuccess?: () => void } = {};
            queueMicrotask(() => {
              req.result = records.get(key);
              req.onsuccess?.();
            });
            return req;
          },
          put: (value: unknown, key: string) => {
            records.set(key, value);
            queueMicrotask(() => tx.oncomplete?.());
            return {};
          },
        }),
        oncomplete: null as (() => void) | null,
        onerror: null as (() => void) | null,
      };
      return tx;
    },
  };

  const factory = {
    open: () => {
      const req: { result?: unknown; onupgradeneeded?: () => void; onsuccess?: () => void } = { result: db };
      queueMicrotask(() => {
        if (!storeCreated) req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  } as unknown as IDBFactory;

  return { factory, records };
}

/* --------------------------------- 用例 -------------------------------- */

describe('Electron 文件后端 · 桥往返', () => {
  it('saveAll → load 原样读回（含音符与速度语境）', async () => {
    const memory = makeMemoryBridge();
    const backend = new ElectronFilePatternLibraryBackend(memory.bridge);
    const saved = [
      pattern(),
      pattern({
        id: 'p2',
        name: 'Pattern 2',
        createdAt: 2,
        notes: [{ type: 'Slide', connections: [{ beat: 2, lane: 1 }, { beat: 3, lane: 2 }] }],
        bpmContext: { startBpm: 180, events: [{ deltaBeat: 1, bpm: 90 }] },
      }),
    ];

    await backend.saveAll(saved);
    await expect(backend.load()).resolves.toEqual(saved);
    expect(memory.saves).toHaveLength(1);
  });

  it('桥回 null（文件不存在 / 主进程已判损坏）→ 空库', async () => {
    const backend = new ElectronFilePatternLibraryBackend(makeMemoryBridge(null).bridge);
    await expect(backend.load()).resolves.toEqual([]);
  });

  it('桥回不认识的 schema → 空库，不凭空造条目', async () => {
    const backend = new ElectronFilePatternLibraryBackend(
      makeMemoryBridge({ schemaVersion: 2, patterns: [pattern()] }).bridge,
    );
    await expect(backend.load()).resolves.toEqual([]);
  });

  it('issue 191 · 库文件里的 pinnedAt 正常读回', async () => {
    const memory = makeMemoryBridge({
      schemaVersion: 1,
      patterns: [pattern({ id: 'p1', pinnedAt: 1700000000000 })],
    });
    const backend = new ElectronFilePatternLibraryBackend(memory.bridge);
    const loaded = await backend.load();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.pinnedAt).toBe(1700000000000);
  });

  it('issue 191 · 非法 pinnedAt 按未置顶处理且不丢整条', async () => {
    const invalidValues = ['not-a-number', NaN, Infinity, -Infinity, null, {}, []];
    for (const bad of invalidValues) {
      const memory = makeMemoryBridge({
        schemaVersion: 1,
        patterns: [{ ...pattern({ id: 'p1', name: '好条目' }), pinnedAt: bad }],
      });
      const backend = new ElectronFilePatternLibraryBackend(memory.bridge);
      const loaded = await backend.load();
      expect(loaded).toHaveLength(1);
      expect(loaded[0]!.name).toBe('好条目');
      expect(loaded[0]!.pinnedAt).toBeUndefined();
      expect('pinnedAt' in loaded[0]!).toBe(false);
    }
  });
});

describe('IndexedDB 后端 · 单 record 往返', () => {
  it('saveAll → load 原样读回', async () => {
    const { factory } = makeFakeIndexedDb();
    const backend = new IndexedDbPatternLibraryBackend(factory);
    const saved = [pattern(), pattern({ id: 'p2', name: '片段 2' })];

    await backend.saveAll(saved);
    await expect(backend.load()).resolves.toEqual(saved);
  });

  it('没有 record → 空库，且**不写**（用户没收藏过就不造数据）', async () => {
    const { factory, records } = makeFakeIndexedDb();
    const backend = new IndexedDbPatternLibraryBackend(factory);
    await expect(backend.load()).resolves.toEqual([]);
    expect(records.size).toBe(0);
  });
});

describe('Electron 真文件后端 · 数据根布局与损坏兜底', () => {
  it('片段库固定落在 <数据根>/patterns/patterns.json', () => {
    expect(PATTERNS_FILENAME).toBe('patterns.json');
    expect(PATTERNS_DIRNAME).toBe('patterns');
    expect(patternsDir(join('/tmp', 'data-root'))).toBe(join('/tmp', 'data-root', 'patterns'));
    expect(patternLibraryPath(join('/tmp', 'data-root'))).toBe(
      join('/tmp', 'data-root', 'patterns', 'patterns.json'),
    );
  });

  it('ensureDataRootLayoutSync 确保 patterns/ 目录创建', () => {
    const root = tmpDir('aao-patterns-layout-');
    try {
      ensureDataRootLayoutSync(root);
      expect(existsSync(patternsDir(root))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('文件不存在：load 回 null，且不落盘', async () => {
    const root = tmpDir('aao-patterns-missing-');
    try {
      await expect(loadPatternLibrary(root)).resolves.toBeNull();
      expect(existsSync(patternLibraryPath(root))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('文件损坏：回空库、原文件改名 .broken 保留原内容且不污染数据根', async () => {
    const root = tmpDir('aao-patterns-broken-');
    try {
      ensureDataRootLayoutSync(root);
      const original = '{ not json';
      writeFileSync(patternLibraryPath(root), original);

      await expect(loadPatternLibrary(root)).resolves.toBeNull();
      expect(existsSync(patternLibraryPath(root))).toBe(false);
      expect(readFileSync(`${patternLibraryPath(root)}.broken`, 'utf8')).toBe(original);
      // 数据根顶层无 .broken 污染
      expect(existsSync(join(root, 'patterns.json.broken'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('已有 .broken 时序号后缀不覆盖上一份备份', async () => {
    const root = tmpDir('aao-patterns-broken-twice-');
    try {
      ensureDataRootLayoutSync(root);
      writeFileSync(`${patternLibraryPath(root)}.broken`, 'older');
      writeFileSync(patternLibraryPath(root), '{ not json');

      await expect(loadPatternLibrary(root)).resolves.toBeNull();
      expect(readFileSync(`${patternLibraryPath(root)}.broken`, 'utf8')).toBe('older');
      expect(readFileSync(`${patternLibraryPath(root)}.1.broken`, 'utf8')).toBe('{ not json');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('schema 不认识也走同一备份口径（不静默覆盖）', async () => {
    const root = tmpDir('aao-patterns-version-');
    try {
      ensureDataRootLayoutSync(root);
      const original = JSON.stringify({ schemaVersion: 2, patterns: [] });
      writeFileSync(patternLibraryPath(root), original);

      await expect(loadPatternLibrary(root)).resolves.toBeNull();
      expect(readFileSync(`${patternLibraryPath(root)}.broken`, 'utf8')).toBe(original);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('saveAll → load 文件往返；主进程套 schemaVersion 信封', async () => {
    const root = tmpDir('aao-patterns-roundtrip-');
    try {
      const saved = [pattern()];
      await savePatternLibrary(root, saved);

      const doc = JSON.parse(readFileSync(patternLibraryPath(root), 'utf8')) as {
        schemaVersion: number;
        patterns: Pattern[];
      };
      expect(doc.schemaVersion).toBe(1);
      expect(doc.patterns).toEqual(saved);
      await expect(loadPatternLibrary(root)).resolves.toEqual(doc);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('PatternStore · 采集、命名与整库追加', () => {
  it('空选区不产出、不写盘', async () => {
    const memory = makeMemoryBridge();
    const store = new PatternStore(new ElectronFilePatternLibraryBackend(memory.bridge));
    const notes = [{ type: 'Single', beat: 1, lane: 1 } as ChartNote];

    await expect(store.capture([], notes, [])).resolves.toBeNull();
    expect(memory.saves).toHaveLength(0);
  });

  it('命名 = 库内最大序号 + 1，名字按生成时界面语言定格', async () => {
    const memory = makeMemoryBridge();
    const store = new PatternStore(new ElectronFilePatternLibraryBackend(memory.bridge));
    const notes = [
      { type: 'BPM', beat: 0, bpm: 120 } as ChartNote,
      { type: 'Single', beat: 1, lane: 1 } as ChartNote,
    ];
    const existing = [pattern({ name: '片段 4' })];

    const created = await store.capture(existing, notes, [{ kind: 'note', noteIndex: 1 }], 1234);
    expect(created).toMatchObject({ name: '片段 5', createdAt: 1234 });
    expect(created!.id).not.toBe('');
    expect(created!.notes).toEqual([{ type: 'Single', beat: 1, lane: 1 }]);
    expect(memory.saves[0]!.map((p) => p.name)).toEqual(['片段 4', '片段 5']);
  });

  it('删除不回收序号：库里只剩 1 与 3 → 下一个是 4', async () => {
    const memory = makeMemoryBridge();
    const store = new PatternStore(new ElectronFilePatternLibraryBackend(memory.bridge));
    const created = await store.add([pattern({ name: '片段 1' }), pattern({ name: '片段 3' })], {
      notes: [{ type: 'Single', beat: 1, lane: 1 }],
      bpmContext: { startBpm: 120, events: [] },
    });
    expect(created.name).toBe('片段 4');
  });

  it('切到英文后新片段用 "Pattern N"，但序号仍跨语言取最大', async () => {
    const memory = makeMemoryBridge();
    const store = new PatternStore(new ElectronFilePatternLibraryBackend(memory.bridge));
    try {
      setActiveUiLanguage('en');
      const created = await store.add([pattern({ name: '片段 4' })], {
        notes: [{ type: 'Single', beat: 1, lane: 1 }],
        bpmContext: { startBpm: 120, events: [] },
      });
      expect(created.name).toBe('Pattern 5');
    } finally {
      setActiveUiLanguage('zh-CN');
    }
  });
});

describe('体量阈值 · 5 MB 初值', () => {
  it('小库不提示；超过阈值提示导出备份', () => {
    expect(exceedsPatternBackupThreshold([])).toBe(false);

    const huge = pattern({
      notes: [{
        type: 'Single',
        beat: 0,
        lane: 1,
        pad: 'x'.repeat(PATTERN_LIBRARY_BACKUP_THRESHOLD_BYTES),
      } as unknown as ChartNote],
    });
    expect(patternLibraryBytes([huge])).toBeGreaterThan(PATTERN_LIBRARY_BACKUP_THRESHOLD_BYTES);
    expect(exceedsPatternBackupThreshold([huge])).toBe(true);
  });
});
