// issue 189 锁测：片段导入的内容判重与合并策略（ADR-0023 §3「分享」）。
//
// 判重键 = `notes + bpmContext` 的规范化 JSON（递归键排序）；`id / name / createdAt`
// 与本地视图偏好（`pinnedAt`）都不参与。策略三选一：跳过（默认）/ 覆盖 / 保留两者。
import { describe, expect, it } from 'vitest';
import type { ChartNote } from '@/src/chart/types';
import {
  patternContentFingerprint,
  planPatternImport,
  previewPatternImport,
} from '@/src/patterns/importConflict';
import type { Pattern } from '@/src/patterns/types';
import { makePattern } from '@/tests/support/patterns';

const NOTE_A: ChartNote[] = [{ type: 'Single', beat: 0, lane: 3 }];
const NOTE_B: ChartNote[] = [{ type: 'Single', beat: 0, lane: 1 }];

/** 带本地置顶字段的片段（191 未落地前 `pinnedAt` 不在类型里，用交叉类型表达） */
function pinned(pattern: Pattern, pinnedAt: number): Pattern & { pinnedAt: number } {
  return { ...pattern, pinnedAt };
}

describe('issue 189 · 内容指纹', () => {
  it('忽略 id / name / createdAt / pinnedAt：只认 notes + bpmContext', () => {
    const base = makePattern({ id: 'a', name: 'A', createdAt: 1, notes: NOTE_A });
    const other = pinned(makePattern({ id: 'b', name: 'B', createdAt: 999, notes: NOTE_A }), 42);
    expect(patternContentFingerprint(base)).toBe(patternContentFingerprint(other));
  });

  it('对象键递归排序：键序不同、值相同 → 同一指纹', () => {
    const left = {
      notes: [{ type: 'Single', beat: 1, lane: 2 } as ChartNote],
      bpmContext: { startBpm: 120, events: [] },
    };
    const right = {
      notes: [{ lane: 2, beat: 1, type: 'Single' } as ChartNote],
      bpmContext: { events: [], startBpm: 120 },
    };
    expect(patternContentFingerprint(left)).toBe(patternContentFingerprint(right));
  });

  it('数组顺序参与指纹：音符顺序不同就是不同内容', () => {
    const left = makePattern({ notes: [NOTE_A[0]!, NOTE_B[0]!] });
    const right = makePattern({ notes: [NOTE_B[0]!, NOTE_A[0]!] });
    expect(patternContentFingerprint(left)).not.toBe(patternContentFingerprint(right));
  });

  it('BPM 语境不同 → 不同指纹', () => {
    const left = makePattern({ notes: NOTE_A, bpmContext: { startBpm: 120, events: [] } });
    const right = makePattern({
      notes: NOTE_A,
      bpmContext: { startBpm: 120, events: [{ deltaBeat: 2, bpm: 180 }] },
    });
    expect(patternContentFingerprint(left)).not.toBe(patternContentFingerprint(right));
  });
});

describe('issue 189 · 判重口径', () => {
  it('同内容不同名 → 冲突，目标 = 当时排序下最靠前的同内容条目', () => {
    const local = makePattern({ id: 'local', name: '本地名', notes: NOTE_A, createdAt: 100 });
    const incoming = makePattern({ id: 'imp', name: '导入名', notes: NOTE_A, createdAt: 500 });

    const plan = planPatternImport([local], [incoming], 'skip');
    expect(plan.targets).toEqual([{
      importIndex: 0,
      importName: '导入名',
      targetId: 'local',
      targetName: '本地名',
    }]);
    // 跳过：本地完全不变，导入条目不写入
    expect(plan.imported).toBe(0);
    expect(plan.skippedExisting).toBe(1);
    expect(plan.patterns).toEqual([local]);
  });

  it('同名不同内容 → 不是冲突，两条都保留（允许重名）', () => {
    const local = makePattern({ id: 'local', name: '花活', notes: NOTE_A, createdAt: 100 });
    const incoming = makePattern({ id: 'imp', name: '花活', notes: NOTE_B, createdAt: 500 });

    const plan = planPatternImport([local], [incoming], 'skip');
    expect(plan.targets).toEqual([]);
    expect(plan.imported).toBe(1);
    expect(plan.skippedExisting).toBe(0);
    expect(plan.sameNameDifferentContent).toBe(1);
    expect(plan.patterns.map((pattern) => pattern.name)).toEqual(['花活', '花活']);
    expect(plan.patterns.map((pattern) => pattern.id)).toEqual(['local', 'imp']);
  });

  it('库里同内容多条：覆盖只作用于当时排序下最靠前的一条，不批量改名', () => {
    const first = makePattern({ id: 'l1', name: '本一', notes: NOTE_A, createdAt: 200 });
    const second = makePattern({ id: 'l2', name: '本二', notes: NOTE_A, createdAt: 100 });
    const incoming = makePattern({ id: 'imp', name: '外来', notes: NOTE_A, createdAt: 500 });

    const plan = planPatternImport([first, second], [incoming], 'overwrite');
    expect(plan.targets).toEqual([{
      importIndex: 0,
      importName: '外来',
      targetId: 'l1',
      targetName: '本一',
    }]);
    expect(plan.patterns.map((pattern) => pattern.id)).toEqual(['l1', 'l2']);
    expect(plan.patterns.map((pattern) => pattern.name)).toEqual(['外来', '本二']);
    expect(plan.imported).toBe(1);
    expect(plan.skippedExisting).toBe(0);
  });
});

describe('issue 189 · 三种动作', () => {
  const local = makePattern({ id: 'local', name: '本地名', notes: NOTE_A, createdAt: 100 });
  const incoming = makePattern({ id: 'imp', name: '导入名', notes: NOTE_A, createdAt: 500 });

  it('覆盖：保留本地 id / createdAt / pinnedAt，只换名字', () => {
    const localPinned = pinned(local, 7);
    const plan = planPatternImport([localPinned], [incoming], 'overwrite');
    expect(plan.patterns).toHaveLength(1);
    const merged = plan.patterns[0]! as Pattern & { pinnedAt?: number };
    expect(merged.id).toBe('local');
    expect(merged.createdAt).toBe(100);
    expect(merged.pinnedAt).toBe(7);
    expect(merged.name).toBe('导入名');
    // 内容相同，所以 notes / bpmContext 原样
    expect(merged.notes).toEqual(local.notes);
    expect(merged.bpmContext).toEqual(local.bpmContext);
  });

  it('保留两者：新 id 追加，名字 / createdAt 沿用导入文件', () => {
    const plan = planPatternImport([local], [incoming], 'keep-both');
    expect(plan.imported).toBe(1);
    expect(plan.skippedExisting).toBe(0);
    expect(plan.patterns).toHaveLength(2);
    expect(plan.patterns[1]).toEqual(incoming);
    expect(plan.patterns[1]!.id).not.toBe('local');
  });

  it('不修改输入数组 / 条目（纯函数）', () => {
    const existing = [local];
    const incomingList = [incoming];
    planPatternImport(existing, incomingList, 'overwrite');
    expect(existing[0]!.name).toBe('本地名');
    expect(incomingList[0]!.name).toBe('导入名');
  });
});

describe('issue 189 · 文件内重复：只和本地库判重', () => {
  const first = makePattern({ id: 'f1', name: '文件一', notes: NOTE_A, createdAt: 500 });
  const second = makePattern({ id: 'f2', name: '文件二', notes: NOTE_A, createdAt: 600 });

  it('空库 + 跳过：文件内同内容多条也全部加入，不算冲突', () => {
    const plan = planPatternImport([], [first, second], 'skip');
    expect(plan.patterns).toEqual([first, second]);
    expect(plan.imported).toBe(2);
    expect(plan.skippedExisting).toBe(0);
    expect(plan.targets).toEqual([]);
  });

  it('空库 + 覆盖：没有本地目标 → 两条都加入', () => {
    const plan = planPatternImport([], [first, second], 'overwrite');
    expect(plan.patterns).toEqual([first, second]);
    expect(plan.imported).toBe(2);
    expect(plan.targets).toEqual([]);
  });

  it('空库 + 保留两者：全部加入（各自 id）', () => {
    const plan = planPatternImport([], [first, second], 'keep-both');
    expect(plan.patterns).toHaveLength(2);
    expect(new Set(plan.patterns.map((pattern) => pattern.id)).size).toBe(2);
    expect(plan.imported).toBe(2);
    expect(plan.skippedExisting).toBe(0);
    expect(plan.targets).toEqual([]);
  });

  it('本地已有同内容时，文件内多条都命中同一个本地目标', () => {
    const local = makePattern({ id: 'local', name: '本地名', notes: NOTE_A, createdAt: 100 });
    const plan = planPatternImport([local], [first, second], 'skip');
    expect(plan.imported).toBe(0);
    expect(plan.skippedExisting).toBe(2);
    expect(plan.patterns).toEqual([local]);
    expect(plan.targets.map((target) => target.targetId)).toEqual(['local', 'local']);
  });
});

describe('issue 189 · 预览计数', () => {
  it('文件总条数 / 新增 / 重复 / 坏条目', () => {
    const local = makePattern({ id: 'local', name: '本地名', notes: NOTE_A, createdAt: 100 });
    const fresh = makePattern({ id: 'fresh', name: '新片段', notes: NOTE_B, createdAt: 500 });
    const duplicate = makePattern({ id: 'dup', name: '导入名', notes: NOTE_A, createdAt: 600 });

    const preview = previewPatternImport([local], [fresh, duplicate], 1);
    expect(preview).toMatchObject({
      total: 3,
      valid: 2,
      newCount: 1,
      duplicateCount: 1,
      invalidCount: 1,
    });
    expect(preview.targets).toHaveLength(1);
  });

  it('空库 + 文件内同内容多条：重复 0、新增 = 文件好条目数', () => {
    const first = makePattern({ id: 'f1', name: '文件一', notes: NOTE_A });
    const second = makePattern({ id: 'f2', name: '文件二', notes: NOTE_A });
    const preview = previewPatternImport([], [first, second], 0);
    expect(preview).toMatchObject({
      total: 2,
      valid: 2,
      newCount: 2,
      duplicateCount: 0,
      invalidCount: 0,
    });
    expect(preview.targets).toEqual([]);
  });
});
