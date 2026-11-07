// 片段（Pattern）的载荷形状（ADR-0023 §1）。
//
// 片段 = 选区音符的形态归一产物（与剪贴板同源，**剥掉 `source`**）+ 一律存的速度语境。
// 库文件（`patterns.json` / IndexedDB 单 record）与分享信封（187）都围着这份形状转，
// 上层只消费，不各自碰数据。
import type { ChartNote } from '../chart/types';

/** 库文件版本。v1 = 单文件全量（将来分片只换存储实现，不动语义）。 */
export const PATTERN_LIBRARY_SCHEMA_VERSION = 1;

/**
 * 「体量超阈值提示导出备份」的阈值（ADR-0023 §3「容量」）。
 * 用户只定了「要提示」没定数字；本轮实现口径初值 5 MB（= 5 * 1024 * 1024 B，待验收）。
 */
export const PATTERN_LIBRARY_BACKUP_THRESHOLD_BYTES = 5 * 1024 * 1024;

/** 跨度内的 BPM 事件：相对片段起点记 `deltaBeat`（起拍那条即 `startBpm`，不重复存）。 */
export interface PatternBpmEvent {
  deltaBeat: number;
  bpm: number;
}

/** 片段速度语境：起点生效 BPM + 跨度内事件（ADR-0023 §1）。 */
export interface PatternBpmContext {
  startBpm: number;
  events: PatternBpmEvent[];
}

export interface Pattern {
  id: string;
  /** 生成时按界面语言定格（「片段 N」/ "Pattern N"），之后切语言不追改 */
  name: string;
  createdAt: number;
  /** `copySelection` 的形态归一产物，`source` 已递归剥掉 */
  notes: ChartNote[];
  bpmContext: PatternBpmContext;
  /** 本地置顶时间戳（毫秒）；未置顶时不存 / undefined（issue 191） */
  pinnedAt?: number;
}

/** 采集产物：还没有名字 / id（命名与领 id 在 PatternStore）。 */
export interface PatternPayload {
  notes: ChartNote[];
  bpmContext: PatternBpmContext;
}

/** v1 库文件：`{ schemaVersion: 1, patterns: [...] }`（Electron 文件与浏览器单 record 同形）。 */
export interface PatternLibraryDoc {
  schemaVersion: number;
  patterns: Pattern[];
}
