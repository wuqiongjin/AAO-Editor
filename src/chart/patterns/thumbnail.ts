// 片段缩略图的**取景与画法**（issue 185 / ADR-0023 Consequences）。
//
// 两条硬口径：
// 1. **按布局轴取景**，不按 beat 跨度归一化 —— 倒流片段会折返（同一段 y 被来回扫），
//    用 beat 线性映射会把折返压平成一条直线。这里走 `ChartGeometry` 的 `BpmTimeline`（画布同一份
//    正向映射）拿每件元素的**布局坐标 pos**，再按 pos 的极值取景。
// 2. 缩略图是**卡片尺寸的形状速写**，不存位图。整条画布渲染（`renderChart` / `FrameView`）要求
//    等比缩放：一段 8 拍的片段在布局轴上是 7 车道 × 几千虚拟 px 的细条，塞进 240×90 的卡片只剩
//    20px 宽的窄带、音符糊成一团。故这里走**非等比取景**：纵向由布局轴定，横向按车道铺满 ——
//    形状（含折返）与相对拍距仍与画布一致。
// 纯函数（无 DOM）：场景构建与绘制分开，`drawPatternThumbnail` 只吃 2d 上下文，可喂假 ctx 单测。
import { BEAT_HEIGHT, ChartGeometry, LANES, LANE_WIDTH } from '../geometry/ChartGeometry';
import { displayConnections } from '../editing/SlideSegments';
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

export interface PatternThumbnailScene {
  /** 7 条车道的 x 区间（缩略图坐标系），画背景用 */
  lanes: { x: number; w: number }[];
  /** 键型音符（单键 / 方向键根点）中心 */
  taps: ThumbnailPoint[];
  /** 方向键：横跨整组的一条线段 */
  bars: { x1: number; x2: number; y: number }[];
  /**
   * 滑条 / 长条：按画布同一份点序（`displayConnections`：稳定排序 + 掐首尾 hidden）的折线。
   * **倒流折返就体现在这里**：同一 x 段上 y 去而复返。
   */
  spans: ThumbnailPoint[][];
  /** 跨度内 BPM 事件的参考线 y（"这里换过速"） */
  bpmLines: number[];
}

/** 内容盒内边距（CSS px）：给折返的顶点与端点留出不被裁掉的余量 */
const PAD_X = 3;
const PAD_Y = 5;

const LANE_VIRTUAL_WIDTH = LANES * LANE_WIDTH;

/**
 * 参与取景的实体音符（BPM / System / Opaque 不进缩略图）。
 * 判据只看 `notePoints` —— 音符类型的枚举只写一份，别在这里再列一遍。
 */
function hittableNotes(notes: readonly ChartNote[]): ChartNote[] {
  return notes.filter((note) => notePoints(note).length > 0);
}

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

/**
 * 构建缩略图场景：纵向按**布局坐标极值**取景（折返深度照实画），横向按车道铺满。
 * 空片段（无实体音符）→ 空场景（只有车道底），调用方不必特判。
 */
export function buildPatternThumbnailScene(pattern: Pattern, size: ThumbnailSize): PatternThumbnailScene {
  const innerW = Math.max(1, size.w - 2 * PAD_X);
  const innerH = Math.max(1, size.h - 2 * PAD_Y);

  const laneX = (index: number) => PAD_X + (index * LANE_WIDTH / LANE_VIRTUAL_WIDTH) * innerW;
  const laneW = (LANE_WIDTH / LANE_VIRTUAL_WIDTH) * innerW;
  const lanes = Array.from({ length: LANES }, (_, index) => ({ x: laneX(index), w: laneW }));
  const centerX = (lane: number) => laneX(lane) + laneW / 2;

  const notes = hittableNotes(pattern.notes);
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

  const taps: ThumbnailPoint[] = [];
  const bars: { x1: number; x2: number; y: number }[] = [];
  const spans: ThumbnailPoint[][] = [];

  for (const note of notes) {
    if (note.type === 'Single') {
      taps.push({ x: centerX(note.lane), y: yOfPos(posOf(note.beat)) });
      continue;
    }
    if (note.type === 'LDirectional' || note.type === 'RDirectional') {
      const y = yOfPos(posOf(note.beat));
      const sign = note.type === 'LDirectional' ? -1 : 1;
      const length = note.length > 0 ? Math.ceil(note.length) : 1;
      taps.push({ x: centerX(note.lane), y });
      // 组尾同样夹进轨道：越界那截在缩略图里没有信息量
      const tail = Math.min(LANES - 1, Math.max(0, note.lane + sign * (length - 1)));
      bars.push({ x1: centerX(Math.min(note.lane, tail)), x2: centerX(Math.max(note.lane, tail)), y });
      continue;
    }
    if (note.type === 'Slide' || note.type === 'Long') {
      const { conns } = displayConnections(note.connections);
      if (conns.length === 0) continue;
      spans.push(conns.map((conn) => ({ x: centerX(conn.lane), y: yOfPos(posOf(conn.beat)) })));
    }
  }

  const bpmLines = pattern.bpmContext.events
    .filter((event) => Number.isFinite(event.deltaBeat) && Number.isFinite(event.bpm) && event.bpm !== 0)
    // deltaBeat 相对片段起点（= `minBeat`，与 capture 同口径）
    .map((event) => yOfPos(posOf(minBeat + event.deltaBeat)));

  return { lanes, taps, bars, spans, bpmLines };
}

/* ------------------------------------------------------------------ */
/* 绘制                                                                 */
/* ------------------------------------------------------------------ */

/**
 * 缩略图固定深色（谱面画布本身就是固定深色，卡片不跟主题换底）。
 * `background` 与 `src/app/styles/tokens.css` 的 `--canvas-bg` 同值 —— canvas 画不了 var()，
 * 这里是本模块唯一一份字面色（改主题底色时两处一起改）。
 */
export const THUMBNAIL_COLORS = {
  background: '#0c0e11',
  lane: 'rgba(255, 255, 255, 0.045)',
  bpm: 'rgba(255, 255, 255, 0.16)',
  note: '#7cc9ff',
  span: '#4ee0a0',
} as const;

/** 把场景画进给定尺寸的 2d 上下文（CSS 像素坐标系，调用方负责 dpr 变换） */
export function drawPatternThumbnail(
  ctx: CanvasRenderingContext2D,
  scene: PatternThumbnailScene,
  size: ThumbnailSize,
): void {
  ctx.fillStyle = THUMBNAIL_COLORS.background;
  ctx.fillRect(0, 0, size.w, size.h);

  for (const lane of scene.lanes) {
    ctx.fillStyle = THUMBNAIL_COLORS.lane;
    ctx.fillRect(lane.x, 0, lane.w, size.h);
  }

  // BPM 事件参考线：虚线，画在音符之下
  if (scene.bpmLines.length > 0) {
    ctx.save();
    ctx.strokeStyle = THUMBNAIL_COLORS.bpm;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    for (const y of scene.bpmLines) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size.w, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  const laneW = scene.lanes[0]?.w ?? 4;
  const noteSize = Math.max(2.5, Math.min(5, laneW * 0.55));

  // 滑条 / 长条：折线（折返在 y 上原样可见）
  const spanWidth = Math.max(1.2, Math.min(3, laneW * 0.18));
  ctx.save();
  ctx.strokeStyle = THUMBNAIL_COLORS.span;
  ctx.lineWidth = spanWidth;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const span of scene.spans) {
    if (span.length === 1) {
      const point = span[0]!;
      ctx.beginPath();
      ctx.arc(point.x, point.y, spanWidth / 2, 0, Math.PI * 2);
      ctx.fillStyle = THUMBNAIL_COLORS.span;
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    span.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();
  }
  ctx.restore();

  // 方向键：整组一条横线
  ctx.save();
  ctx.strokeStyle = THUMBNAIL_COLORS.note;
  ctx.lineWidth = Math.max(1.5, noteSize * 0.6);
  ctx.lineCap = 'round';
  for (const bar of scene.bars) {
    ctx.beginPath();
    ctx.moveTo(bar.x1, bar.y);
    ctx.lineTo(bar.x2, bar.y);
    ctx.stroke();
  }
  ctx.restore();

  ctx.fillStyle = THUMBNAIL_COLORS.note;
  for (const tap of scene.taps) {
    ctx.fillRect(tap.x - noteSize / 2, tap.y - noteSize / 2, noteSize, noteSize);
  }
}
