export type NoteType = "Single" | "LDirectional" | "RDirectional" | "Slide" | "Long" | "BPM" | "System";

// SP 段参数（issue 09 / ADR-0009 §1：参数随行，hidden 采样点是唯一真相）。
// 只存在于内部模型：谱面代码（convertSlideNote）不写、Bestdori 导入没有——
// 谱面工程持久化存 ChartNote[]，本字段随之 JSON 往返自动保存。
export interface SpanEasingParam {
  kind: 'easing';
  family: import('./editing/Easing').EasingFamily;
  type: import('./editing/Easing').EasingType;
  precision: import('./editing/Easing').CurvePrecision;
}

/**
 * 段参数表：按**可见结点序数**键（span k = 第 k 与 k+1 个可见结点之间，hidden 不分界）。
 * `visibleCount` = 创建/重投影时的可见结点数——**自失效护栏**：任何改动可见结点序列的操作
 * （92 删结点转 hidden、80 删段、拆条、组合、代码回写……）都会让计数失配 → 参数整体视为
 * 不存在（退化为普通点集段），无需在各条改动路径上逐个清参数（ADR-0009 §1 一致性规则）。
 */
export interface SlideSpanParams {
  visibleCount: number;
  bySpan: Record<number, SpanEasingParam>;
}

export interface BaseNote {
  beat: number;
  lane: number;
  subBeat?: number; // 子节拍位置，0表示在节拍线上
  type: NoteType;
}

export interface SingleNote extends BaseNote {
  type: "Single";
  flick?: boolean; // flicker 特殊标记
  skill?: boolean; // 技能音符标记
}

export interface LDirectionalNote extends BaseNote {
  type: "LDirectional";
  length: number; // 组合长度 (1-3)
  flick?: boolean; // 是否带flick
  skill?: boolean; // 技能音符标记
}

export interface RDirectionalNote extends BaseNote {
  type: "RDirectional";
  length: number; // 组合长度 (1-3)
  flick?: boolean; // 是否带flick
  skill?: boolean; // 技能音符标记
}

// SlideNote 和 LongNote 完全等价，都使用connections结构
export interface SlideNote {
  type: "Slide";
  connections: ConnectionNote[];
  /** SP 段参数（ADR-0009 §1 参数随行）；缺省 = 全部段为普通点集段（含自由段） */
  spanParams?: SlideSpanParams;
}

export interface LongNote {
  type: "Long";
  connections: ConnectionNote[];
  /** 同 SlideNote（Long 与 Slide 同构，SP 段能力同款适用） */
  spanParams?: SlideSpanParams;
}

export interface ConnectionNote {
  beat: number;
  lane: number;
  subBeat?: number;
  hidden?: boolean; // 隐藏连接点（用于滑条中间点）
  flick?: boolean; // 连接点是否带flick
  skill?: boolean; // 技能音符标记
}

export interface BpmNote {
  type: "BPM";
  beat: number;
  bpm: number;
}

export interface SystemNote {
  type: "System";
  beat: number;
  data: string; // 系统数据
}

export type ChartNote = SingleNote | LDirectionalNote | RDirectionalNote | SlideNote | LongNote | BpmNote | SystemNote;

// 选择条目（ADR-0001 §6）：滑条可分区域/端点/中间结点独立选中与编辑
export type SelectionItem =
  | { kind: 'note'; noteIndex: number }                    // 整条音符（含 Ctrl+左键选中的整条滑条）
  | { kind: 'slideRegion'; noteIndex: number; connIndex: number } // 滑条"段/区域"：connIndex↔connIndex+1 两结点间的连接带
  | { kind: 'slideNode'; noteIndex: number; connIndex: number }; // 滑条端点或中间结点
