// 片段导入的判重与合并策略（issue 189 / ADR-0023 §3「分享」；2026-10-31 用户修订）。
//
// 判重键 = `notes + bpmContext` 的规范化 JSON（递归键排序）。`id / name / createdAt`
// 与本地视图偏好（如 191 的 `pinnedAt`）都不是内容，**不进指纹**：名字是标签，不是唯一键。
//
// **只和本地库比对**：文件内部的同内容条目不再互相判重 —— 空库导入一份含多条同内容片段的
// JSON 时，全部按新片段进来。冲突仅指「导入条目 ↔ 本地已有片段」。
//
// 三种动作（默认跳过）：
//   skip       本地完全不变，同内容条目不写入（保留本地已有的那条）；
//   overwrite  保留本地 `id / createdAt` 与本地字段，只把 `name` 换成导入名；
//   keep-both  同内容条目也作为新片段追加（各自 id）。
//
// 目标选择：库内已有同内容多条时，只认**当前排序下最靠前**的一条（输入数组的现有顺序），
// 不批量改名。
import type { Pattern } from './types';

export type PatternImportStrategy = 'skip' | 'overwrite' | 'keep-both';

/** 一条「导入条目命中了哪个本地同内容目标」的明细（预览清单 / 覆盖目标都靠它）。 */
export interface PatternImportTarget {
  /** 该条目在解析结果好条目里的序号（文件顺序） */
  importIndex: number;
  importName: string;
  targetId: string;
  /** 命中目标当时的名字（预览时是本地名） */
  targetName: string;
}

/** 合并结果：`patterns` 是可直接落盘的新库；`imported` = 实际写入（含覆盖 / 保留两者）的条目数。 */
export interface PatternImportPlan {
  patterns: Pattern[];
  imported: number;
  /** 因内容已存在而跳过的条目数（覆盖 / 保留两者时恒为 0） */
  skippedExisting: number;
  targets: PatternImportTarget[];
  /** 同名但内容不同的条数（不是冲突；两条都保留，预览可据此提示） */
  sameNameDifferentContent: number;
}

/** 预览（默认跳过口径）给弹层用的计数与清单。 */
export interface PatternImportPreview {
  /** 文件里的片段总数（好条目 + 坏条目） */
  total: number;
  valid: number;
  /** 默认「跳过」下会新加入的条数 */
  newCount: number;
  duplicateCount: number;
  invalidCount: number;
  targets: PatternImportTarget[];
  sameNameDifferentContent: number;
}

/** 规范化为键排序的 JSON 值：对象递归排序键，数组保持顺序。 */
function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) sorted[key] = stableJsonValue(source[key]);
    return sorted;
  }
  return value;
}

/** 内容指纹：只有 `notes + bpmContext`，与 id / 名字 / 收藏时间 / 本地偏好无关。 */
export function patternContentFingerprint(pattern: Pick<Pattern, 'notes' | 'bpmContext'>): string {
  return JSON.stringify(stableJsonValue({
    notes: pattern.notes,
    bpmContext: pattern.bpmContext,
  }));
}

/**
 * 现有库 + 解析结果（好条目，id 已重发）+ 策略 → 新库与冲突明细。
 *
 * `existing` 必须按**当前显示顺序**传入（库层传的是 `sortPatternsNewestFirst` 后的数组），
 * 「最靠前的一条」就是这份顺序里的第一条。纯函数：不改输入数组与条目。
 */
export function planPatternImport(
  existing: readonly Pattern[],
  incoming: readonly Pattern[],
  strategy: PatternImportStrategy,
): PatternImportPlan {
  const patterns = [...existing];
  /** 指纹 → 本地库里第一条同内容片段的 id。**只建一次**：文件内重复不参与判重。 */
  const localTargetByFingerprint = new Map<string, string>();
  for (const pattern of existing) {
    const fingerprint = patternContentFingerprint(pattern);
    if (!localTargetByFingerprint.has(fingerprint)) {
      localTargetByFingerprint.set(fingerprint, pattern.id);
    }
  }

  const targets: PatternImportTarget[] = [];
  let imported = 0;
  let skippedExisting = 0;
  let sameNameDifferentContent = 0;

  incoming.forEach((pattern, importIndex) => {
    const fingerprint = patternContentFingerprint(pattern);
    const targetId = localTargetByFingerprint.get(fingerprint);

    if (targetId !== undefined) {
      const index = patterns.findIndex((candidate) => candidate.id === targetId);
      const target = index >= 0 ? patterns[index]! : null;
      if (target) {
        targets.push({
          importIndex,
          importName: pattern.name,
          targetId: target.id,
          targetName: target.name,
        });

        if (strategy === 'skip') {
          skippedExisting += 1;
          return;
        }
        if (strategy === 'overwrite') {
          // 只换名字：保留本地 id / createdAt / 置顶等本地字段，内容本来就相同
          patterns[index] = { ...target, name: pattern.name };
          imported += 1;
          return;
        }
        // keep-both：同内容也作为新片段追加，目标仍是本地第一条
        patterns.push(pattern);
        imported += 1;
        return;
      }
    }

    // 没有本地同内容目标：一律保留（文件内部的同内容条目也各自进来）。
    // 这里只记「同名但内容不同」的提示，不按名字覆盖。
    if (patterns.some(
      (candidate) => candidate.name === pattern.name
        && patternContentFingerprint(candidate) !== fingerprint,
    )) {
      sameNameDifferentContent += 1;
    }
    patterns.push(pattern);
    imported += 1;
  });

  return { patterns, imported, skippedExisting, targets, sameNameDifferentContent };
}

/** 弹层预览：按默认「跳过」口径算新增 / 重复，并把坏条目一起算进总数。 */
export function previewPatternImport(
  existing: readonly Pattern[],
  incoming: readonly Pattern[],
  invalidCount: number,
): PatternImportPreview {
  const plan = planPatternImport(existing, incoming, 'skip');
  return {
    total: incoming.length + invalidCount,
    valid: incoming.length,
    newCount: plan.imported,
    duplicateCount: plan.skippedExisting,
    invalidCount,
    targets: plan.targets,
    sameNameDifferentContent: plan.sameNameDifferentContent,
  };
}
