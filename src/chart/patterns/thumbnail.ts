// 片段缩略图的**取景**（issue 185 / ADR-0023 Consequences；2026-10-31 验收改为真实音符皮肤）。
//
// 两条硬口径：
// 1. **按布局轴取景**，不按 beat 跨度归一化 —— 倒流片段会折返（同一段 y 被来回扫），
//    用 beat 线性映射会把折返压平成一条直线。这里走 `ChartGeometry` 的 `BpmTimeline`（画布同一份
//    正向映射）拿每件元素的**布局坐标 pos**，再按 pos 的极值取景。
// 2. 缩略图是**卡片尺寸的形状速写**：整条画布渲染（`renderChart` / `FrameView`）只支持等比缩放，
//    而 1 拍 = 220 虚拟 px、7 轨只有 210 虚拟 px 宽 —— 88×56 的卡片要装下 8 拍片段，等比缩完
//    轨道只剩 6.7px。故这里**非等比取景**：纵向由布局轴定、横向按车道铺满（形状与相对拍距不变）。
//
// 音符本体**不复刻形状**：由 `thumbnailPaint` 用当前音符皮肤的真实精灵按点贴图（2026-10-31 验收：
// 自绘的方块/横条把单键、滑键、技能键画成了一个样）。
// 本文件是纯几何（无 DOM、无皮肤注册表），node 可直接单测。
import { BEAT_HEIGHT, ChartGeometry, LANES, LANE_WIDTH } from '../geometry/ChartGeometry';
import { displayConnections, slideUsesSpBand } from '../editing/SlideSegments';
import type { ChartNote } from '../types';
import type { Pattern } from './types';

/** 缩略图内容盒（CSS px） */
export interface ThumbnailSize {
  w: number;
  h: number;
}

export interface ThumbnailPoint {
  x: number;
  y: number;
}

/**
 * 一个要贴精灵的点位。**取款只给身份，不给款式** —— 款式由绘制侧按与画布同一套选款
 * （`singleIconConfig` / `slideNodeIconConfig`）从当前音符皮肤解析。
 */
export interface ThumbnailMark {
  x: number;
  y: number;
  lane: number;
  /**
   * 方向键整组：**只出一个点**（锚点轨中心），组内各轨本体与最外侧箭头由
   * `renderDirGroup` 一次画完 —— 自己按轨摆散点会画成互不相连的几个小块。
   */
  dirSide?: 'L' | 'R';
  dirLength?: number;
  flick?: boolean;
  skill?: boolean;
  /** 滑条结点：端点（首/尾）另画端帽款；中间结点按 among 款 */
  endpoint?: 'first' | 'last';
}

export interface ThumbnailSpan {
  /**
   * 中心线：按画布同一份点序（`displayConnections`：稳定排序 + 掐首尾 hidden）。
   * **倒流折返就体现在这里**：同一 x 段上 y 去而复返。
   */
  points: ThumbnailPoint[];
  /**
   * 是否 SP 材质（ADR-0009 §5 / issue 157：整条传染 —— 源 connections 任一 hidden 即整条 SP）。
   * 材质剖面由绘制侧按 `slideBandSp` / `slideBand` 选，缩略图不再自己调色。
   */
  sp: boolean;
}

export interface PatternThumbnailScene {
  /** 7 条车道的 x 区间（缩略图坐标系），画背景用 */
  lanes: { x: number; w: number }[];
  /** 滑条 / 长条的中心线 + 材质归属 */
  spans: ThumbnailSpan[];
  /** 滑条结点（hidden 不出点；端点/中间结点分开标） */
  slideMarks: ThumbnailMark[];
  /** 键型音符（单键 / 滑键 / 技能键 / 方向键逐轨） */
  keyMarks: ThumbnailMark[];
  /** 跨度内 BPM 事件的参考线 y（"这里换过速"） */
  bpmLines: number[];
}

/** 内容盒内边距（CSS px）：给折返的顶点与端点留出不被裁掉的余量 */
const PAD_X = 3;
const PAD_Y = 5;

const LANE_VIRTUAL_WIDTH = LANES * LANE_WIDTH;

/** 全部连接点（含 hidden：它们仍在跨度内，决定取景高度）；非实体音符 → 空数组 */
function notePoints(note: ChartNote): { beat: number; lane: number }[] {
  if (note.type === 'Slide' || note.type === 'Long') {
    return note.connections.map((conn) => ({ beat: conn.beat, lane: conn.lane }));
  }
  if (note.type === 'Single' || note.type === 'LDirectional' || note.type === 'RDirectional') {
    return [{ beat: note.beat, lane: note.lane }];
  }
  return [];
}

/**
 * 片段自带的速度语境重建布局轴（相对片段最早拍）。
 *
 * 片段音符保留**绝对拍位**，而速度语境里的 `deltaBeat` 是相对 `minBeat` 的 —— 这里把
 * 起点 BPM 落回 `minBeat`，跨度内事件按同一偏移还原，于是 `positionOfBeat(beat)` 与它在
 * 源谱面上的布局坐标只差一个常数平移（取景只看极值，平移无影响）。
 */
function patternGeometry(
  pattern: Pattern,
  notes: readonly ChartNote[],
): { geometry: ChartGeometry; minBeat: number } {
  const beats = notes.flatMap((note) => notePoints(note)).map((point) => point.beat).filter(Number.isFinite);
  const minBeat = beats.length > 0 ? Math.min(...beats) : 0;
  const maxBeat = beats.length > 0 ? Math.max(...beats) : minBeat;
  const startBpm = Number.isFinite(pattern.bpmContext.startBpm) ? pattern.bpmContext.startBpm : 120;
  const events = [
    { beat: minBeat, bpm: startBpm },
    ...pattern.bpmContext.events.map((event) => ({ beat: minBeat + event.deltaBeat, bpm: event.bpm })),
  ]
    .filter((event) => Number.isFinite(event.beat) && Number.isFinite(event.bpm) && event.bpm !== 0)
    .sort((a, b) => a.beat - b.beat);
  // surface / 谱面末端都不参与取景（只借 timeline 的正向映射），给最省的一组值
  return {
    geometry: new ChartGeometry(events, { endBeat: Math.max(minBeat + 1, maxBeat) }, { w: 1, h: 1 }),
    minBeat,
  };
}

const sceneCache = new WeakMap<Pattern, Map<string, PatternThumbnailScene>>();

/**
 * 构建缩略图场景：纵向按**布局坐标极值**取景（折返深度照实画），横向按车道铺满。
 * 空片段（无实体音符）→ 空场景（只有车道底），调用方不必特判。
 * 带 WeakMap 引用级场景缓存，同一 pattern 与尺寸只计算一次几何。
 */
export function buildPatternThumbnailScene(pattern: Pattern, size: ThumbnailSize): PatternThumbnailScene {
  const cacheKey = `${size.w}x${size.h}`;
  let sizeMap = sceneCache.get(pattern);
  if (!sizeMap) {
    sizeMap = new Map();
    sceneCache.set(pattern, sizeMap);
  }
  const cached = sizeMap.get(cacheKey);
  if (cached) return cached;

  const innerW = Math.max(1, size.w - 2 * PAD_X);
  const innerH = Math.max(1, size.h - 2 * PAD_Y);

  const laneX = (index: number) => PAD_X + (index * LANE_WIDTH / LANE_VIRTUAL_WIDTH) * innerW;
  const laneW = (LANE_WIDTH / LANE_VIRTUAL_WIDTH) * innerW;
  const lanes = Array.from({ length: LANES }, (_, index) => ({ x: laneX(index), w: laneW }));
  const centerX = (lane: number) => laneX(lane) + laneW / 2;

  // BPM / System / Opaque 不进缩略图：判据只看"有没有连接点"，类型枚举不在这里再列一遍
  const notes = pattern.notes.filter((note) => notePoints(note).length > 0);
  const { geometry, minBeat } = patternGeometry(pattern, notes);
  const posOf = (beat: number) => geometry.timeline.positionOfBeat(beat);

  const positions: number[] = [];
  for (const note of notes) {
    for (const point of notePoints(note)) {
      if (Number.isFinite(point.beat)) positions.push(posOf(point.beat));
    }
  }
  let posMax = positions.length > 0 ? Math.max(...positions) : 0;
  let posMin = positions.length > 0 ? Math.min(...positions) : 0;
  // 单点 / 全部同高：给一拍的高度当取景，音符落在中间而不是贴上边缘
  if (posMax - posMin < 1e-6) {
    const half = BEAT_HEIGHT / 2;
    posMax += half;
    posMin -= half;
  }
  const span = posMax - posMin;
  const yOfPos = (pos: number) => PAD_Y + ((posMax - pos) / span) * innerH;

  const spans: ThumbnailSpan[] = [];
  const slideMarks: ThumbnailMark[] = [];
  const keyMarks: ThumbnailMark[] = [];

  for (const note of notes) {
    if (note.type === 'Single') {
      keyMarks.push({
        x: centerX(note.lane), y: yOfPos(posOf(note.beat)), lane: note.lane,
        flick: note.flick === true, skill: note.skill === true,
      });
      continue;
    }
    if (note.type === 'LDirectional' || note.type === 'RDirectional') {
      const side = note.type === 'LDirectional' ? 'L' : 'R';
      // 只出一个组锚点：覆盖轨与外侧箭头的组合几何交给 `renderDirGroup`（画布同一份）
      const lane = Math.min(LANES - 1, Math.max(0, note.lane));
      keyMarks.push({
        x: centerX(lane), y: yOfPos(posOf(note.beat)), lane,
        dirSide: side, dirLength: note.length,
        flick: note.flick === true, skill: note.skill === true,
      });
      continue;
    }
    if (note.type === 'Slide' || note.type === 'Long') {
      const { conns } = displayConnections(note.connections);
      if (conns.length === 0) continue;
      spans.push({
        points: conns.map((conn) => ({ x: centerX(conn.lane), y: yOfPos(posOf(conn.beat)) })),
        sp: slideUsesSpBand(note.connections),
      });
      conns.forEach((conn, index) => {
        if (conn.hidden) return; // 与画布同口径：重合衔接点不画图标
        slideMarks.push({
          x: centerX(conn.lane),
          y: yOfPos(posOf(conn.beat)),
          lane: conn.lane,
          flick: conn.flick === true,
          skill: conn.skill === true,
          ...(index === 0 ? { endpoint: 'first' as const } : {}),
          ...(index === conns.length - 1 ? { endpoint: 'last' as const } : {}),
        });
      });
    }
  }

  const bpmLines = pattern.bpmContext.events
    .filter((event) => Number.isFinite(event.deltaBeat) && Number.isFinite(event.bpm) && event.bpm !== 0)
    // deltaBeat 相对片段起点（= `minBeat`，与 capture 同口径）
    .map((event) => yOfPos(posOf(minBeat + event.deltaBeat)));

  const scene: PatternThumbnailScene = { lanes, spans, slideMarks, keyMarks, bpmLines };
  sizeMap.set(cacheKey, scene);
  return scene;
}
