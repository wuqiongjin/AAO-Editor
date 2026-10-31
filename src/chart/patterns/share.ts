// 片段库分享（issue 184 / ADR-0023 §3「分享」；文件读写入口归 187）。
//
// 统一信封 `{ schemaVersion, exportedAt, patterns }`——**单条也用同一信封**（解析只有一条路）。
// 导入语义：**只合并、不做整库替换**；每条生成新 id；**允许重名**（名字是标签，不改写别人的命名）。
// 逐条校验：坏条目收集成清单随结果返回，不整包失败；整包版本不认识才整包拒绝并说明。
import { t } from '../../i18n/t';
import { patternInvalidReason, type PatternInvalidReason } from './record';
import type { Pattern } from './types';

export const PATTERN_EXPORT_SCHEMA_VERSION = 1;

export interface PatternExportFile {
  schemaVersion: number;
  exportedAt: string;
  patterns: Pattern[];
}

export interface SkippedPattern {
  index: number;
  /** 条目自报的名字（如果有），方便 UI 说清哪条没进来 */
  name: string | null;
  reason: PatternInvalidReason;
}

export type ParsePatternsFailureReason = 'invalid-json' | 'invalid-envelope' | 'unsupported-version';

export type ParsePatternsResult =
  | { ok: true; patterns: Pattern[]; skipped: SkippedPattern[] }
  | {
      ok: false;
      reason: ParsePatternsFailureReason;
      /** 可直接展示给用户的说明（已按当前界面语言取文案） */
      message: string;
      /** 仅 unsupported-version：文件自称的版本 */
      version?: unknown;
    };

/** 整库 / 单条导出共用：信封 + ISO 时间戳 + 片段本体（**不含缩略图**，缩略图是实渲染）。 */
export function serializePatterns(patterns: readonly Pattern[], now: Date = new Date()): string {
  const doc: PatternExportFile = {
    schemaVersion: PATTERN_EXPORT_SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    patterns: [...patterns],
  };
  return JSON.stringify(doc);
}

function readName(value: unknown): string | null {
  if (value === null || typeof value !== 'object') return null;
  const name = (value as { name?: unknown }).name;
  return typeof name === 'string' ? name : null;
}

/**
 * 解析分享文件 → 可合并的片段（**id 已重发**，与源库同 id 不会撞车）。
 *
 * 单条结构不成立 → 进 `skipped` 并继续；整包 JSON 坏 / 信封不成立 / 版本不认识 → `ok: false`。
 */
export function parsePatternsFile(text: string): ParsePatternsResult {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'invalid-json', message: t('patternLibrary.import.badFile') };
  }

  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    return { ok: false, reason: 'invalid-envelope', message: t('patternLibrary.import.badFile') };
  }

  const envelope = doc as { schemaVersion?: unknown; patterns?: unknown };
  if (envelope.schemaVersion !== PATTERN_EXPORT_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: 'unsupported-version',
      message: t('patternLibrary.import.badVersion', { version: String(envelope.schemaVersion) }),
      version: envelope.schemaVersion,
    };
  }
  if (!Array.isArray(envelope.patterns)) {
    return { ok: false, reason: 'invalid-envelope', message: t('patternLibrary.import.badFile') };
  }

  const patterns: Pattern[] = [];
  const skipped: SkippedPattern[] = [];
  envelope.patterns.forEach((entry, index) => {
    const reason = patternInvalidReason(entry);
    if (reason !== null) {
      skipped.push({ index, name: readName(entry), reason });
      return;
    }
    patterns.push({ ...(entry as Pattern), id: crypto.randomUUID() });
  });

  return { ok: true, patterns, skipped };
}
