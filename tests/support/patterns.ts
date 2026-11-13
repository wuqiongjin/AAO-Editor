// 片段库的测试替身（issue 185）：内存后端 + 片段夹具。
// 契约与生产同形：`load` 每次给一份深拷贝（近似 IndexedDB / 文件反序列化），
// `saveAll` 整库覆盖（v1 单文件全量）。
import { PatternStore, type PatternLibraryBackend } from '@/src/patterns/PatternStore';
import type { Pattern } from '@/src/patterns/types';

/** 一条片段夹具：默认是「一个单键、120 BPM 无变速」的最小形态 */
export function makePattern(overrides: Partial<Pattern> = {}): Pattern {
  return {
    id: 'p1',
    name: '片段 1',
    createdAt: 1,
    notes: [{ type: 'Single', beat: 0, lane: 3 }],
    bpmContext: { startBpm: 120, events: [] },
    ...overrides,
  };
}

/** 内存版片段库：`disk` = 已经落盘的内容，`saves` = 落盘次数（断言"没写盘"用） */
export function makeMemoryPatternStore(seed: Pattern[] = []) {
  let disk = structuredClone(seed);
  let saves = 0;
  const backend: PatternLibraryBackend = {
    load: async () => structuredClone(disk),
    saveAll: async (patterns) => {
      disk = structuredClone([...patterns]);
      saves += 1;
    },
  };
  return {
    store: new PatternStore(backend),
    get disk() { return disk; },
    get saves() { return saves; },
  };
}
