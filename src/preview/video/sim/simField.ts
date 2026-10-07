// 仿真场的一帧绘制（ADR-0016 §1.2 / §5；chart-preview 05）：
//
//   场地 → 带体 → 同时点击线 → 音符 → 特效 → HUD（combo）
//
// **任意秒出帧**：`drawSimFrameAt(ctx, frame, seconds)` 是唯一入口 —— 实时回放（`simPlayback`）
// 与 07 的离线逐帧导出共用它（导出只换 ctx 与场地尺寸，不换画法）。
//
// 口径一致（票面「复用与边界」，不另立一套）：
//   - `beat < 0` 的音符 / 滑条非 hidden 结点不渲染（ADR-0014）；
//   - 带体取点走 `displayConnections` 同一显示投影（ADR-0009 §2.2 / issue 115）——倒流区折返照旧；
//   - combo 与键音**同一份事件表**（`AudioTiming.buildKeyEvents`）：会出声 = 会过线 = 计 combo；
//   - 精灵选款走 `singleIconConfig` / `slideNodeIconConfig` / `dirSideOf`（与编辑器画布同一份）；
//   - 音符尺寸与相对比例取 `rendering/primitives/noteMetrics`（唯一定义处）。
//
// 素材边界：引官方素材的只有场地三图（04 的开发期直读通道）+ 音符精灵（既有运行时资产）
// + 同时点击线精灵；**特效全程序化自绘**（票面「特效」一行）。
import type { ChartNote, ConnectionNote, SlideNote } from '../../../chart/types';
import { LANE_WIDTH, directionalLanes } from '../../../chart/geometry/ChartGeometry';
import { displayConnections, slideUsesSpBand } from '../../../chart/editing/SlideSegments';
import { trueBeat } from '../../../chart/editing/ChartEndBounds';
import { comboNodePreciseBeats } from '../../../chart/editing/NoteEditing';
import {
  DIRECTIONAL_HEIGHT_SCALE,
  DIRECTIONAL_ICON_SIZE,
  NOTE_HEIGHT_SCALE,
  NOTE_ICON_SIZE,
  SLIDE_HEIGHT_SCALE,
  SLIDE_ICON_SIZE,
} from '../../../rendering/primitives/noteMetrics';
import { dirSideOf, singleIconConfig, slideNodeIconConfig, type IconChoiceCtx } from '../../../rendering/render';
import type { ActiveNoteIcons } from '../../../rendering/skin/noteSkin';
import type CanvasSpriteIcon from '../../../ui/CanvasSpriteIcon';
import type { SpriteIconConfig } from '../../../ui/CanvasSpriteIcon';
import { beatToSeconds, getBpmEvents, type BpmEvent } from '../../../audio/AudioTiming';
import type { KeySoundKind } from '../../../audio/KeySound';
import {
  APPROACH,
  approachA,
  approachSeconds,
  bandQuad,
  clampApproach,
  comboAnchor,
  effectAlpha,
  effectProgress,
  elementPoint,
  fieldImageRect,
  fieldY,
  laneCenterX,
  laneFlashAlpha,
  mirrorLane,
  pingRadius,
  playLineRect,
  simEffectColor,
  simSpriteScale,
  SIM_BAND_COLORS,
  SIM_EFFECT_DURATION,
  SIM_LANE_FLASH_SPAN,
  visibleApproach,
  type SimFieldMetrics,
  type SimPoint,
} from './simGeometry';

/** 缺素材时的场地底色（近黑，与游戏场地暗部同族） */
export const SIM_FALLBACK_BG = '#0d1017';
/** HUD 字体（自绘文本，不引官方 digits / combo 精灵） */
const SIM_HUD_FONT = '"Segoe UI", system-ui, -apple-system, sans-serif';
/** 数值容差（A 贴到渐近值 = 整段还在很远处） */
const EPS = 1e-6;

/** 仿真场要画的那份谱面 + 作者设置（与 `settings` 同源，不含播放状态） */
export interface SimScene {
  notes: ChartNote[];
  /** 当前细分档（subBeat 的单位 = 1/beatDisplay） */
  beatDisplay: number;
  /** 音符速度档（1..11；T = (12 − n)/2 秒） */
  noteSpeed: number;
  /** `settings.display.noteSize`：节奏图示大小 */
  noteSize: number;
  /** `settings.display.slideOpacity`：带体不透明度（票面的 `longAlpha`） */
  slideOpacity: number;
  /** `settings.display.simultaneousClickLines`：同时点击线（票面的 `dualLine`） */
  simultaneousClickLines: boolean;
  /** `settings.display.colorAssist`：色觉辅助（票面的 `offBeat`，单键虚拍款） */
  colorAssist: boolean;
  /** `settings.preview.mirror`：整轨镜像（车道对调 + 方向箭头翻面） */
  mirror: boolean;
}

/** 一个会过线的元素（单键 / 方向键 / 滑条可见结点）；已含镜向与精灵选款 */
export interface SimElement {
  /** 命中时刻（秒） */
  time: number;
  /** 轨号（已含镜向） */
  lane: number;
  /** 击打样式：决定特效配色（与键音 / combo 同一套口径） */
  kind: KeySoundKind;
  /**
   * 方向键：组合长度**原值**（渲染时喂 `dirGroup`）—— 本体数由它 `ceil` 出、外侧箭头按
   * **原始有符号值**定位（源数据允许小数值，照 ADR-0014 §3；非有限值按 1）。其余类型恒 1。
   */
  length: number;
  /** 方向键：侧别（已含镜向）；其余为 null */
  dirSide: 'L' | 'R' | null;
  /** 方向键：整组覆盖的轨号（已含镜向）；其余为 null */
  dirLanes: number[] | null;
  /** 精灵（已按皮肤 + flick/skill + 色觉辅助选好款） */
  icon: SpriteIconConfig;
  /** 精灵设计宽（× 场地缩放 = 绘制尺寸） */
  designW: number;
  /** 精灵设计高 */
  designH: number;
  /** 是否补 flick 顶部箭头（单键 / 滑条端点上的 flick） */
  flickDecorator: boolean;
}

/** 带体的一段：投影序里相邻两结点的 `(lane, A)` */
export interface SimBand {
  t0: number;
  lane0: number;
  t1: number;
  lane1: number;
  /** SP 材质（整条传染，ADR-0009 §5） */
  sp: boolean;
}

/** 同时点击线的分组：同一拍（同 tick）的一组轨号（已含镜向，升序） */
export interface SimSimultaneous {
  time: number;
  lanes: number[];
}

/**
 * 谱面派生表（谱面 / 细分档 / 速度档变才重建）：
 * 一帧只做「按秒窗口取可见元素」的二分 + 画，不每帧重算 beat→秒。
 */
export interface SimChart {
  /** 接近时长 T（秒）= (12 − noteSpeed)/2 */
  approachS: number;
  /** 全部元素，按 time 升序 */
  elements: SimElement[];
  /** 全部带体段，按进场时刻升序 */
  bands: SimBand[];
  /** 同时点击线分组，按 time 升序 */
  simultaneous: SimSimultaneous[];
  /**
   * combo 口径：**画布那一份**（`NoteEditing.comboNodePreciseBeats` 的同一枚举）折成的秒，升序。
   * 与键音事件表刻意不同：`beat < 0` 的可击打物**不键音但计 combo**（开播即已过线，ADR-0014 / CONTEXT
   * 「负 beat 击打物」），故它们的时刻是负数、`t = 0` 时就已经算进去了。
   */
  hitTimes: number[];
}

/** 一帧要用的素材（缺图 = 不画该层；带体取色缺 = 走兜底色） */
export interface SimFrameAssets {
  /** 背景（bgskin `liveBG_normal.png`） */
  background: CanvasImageSource | null;
  /** 场地图（fieldskin `bg_line_rhythm.png`） */
  field: CanvasImageSource | null;
  /** 场地判定线（fieldskin `game_play_line.png`） */
  playLine: CanvasImageSource | null;
  /** 带体颜色（皮肤带体图中心取样） */
  bandColor: string;
  /** SP 带体颜色（同上，取 SP 带图） */
  bandColorSp: string;
}

export interface SimFrameInput {
  chart: SimChart;
  scene: SimScene;
  metrics: SimFieldMetrics;
  assets: SimFrameAssets;
  noteIcons: ActiveNoteIcons;
  spriteIcon: CanvasSpriteIcon;
}

// ---------------------------------------------------------------- 谱面派生

/** 谱面 → 仿真场元素表（纯函数；实时回放与离线导出共用同一份） */
export function buildSimChart(scene: SimScene, noteIcons: ActiveNoteIcons): SimChart {
  const { notes, beatDisplay, mirror } = scene;
  const bpmEvents: BpmEvent[] = getBpmEvents(notes);
  const iconCtx: IconChoiceCtx = {
    noteIcons,
    beatDisplay,
    display: { colorAssist: scene.colorAssist, mirror },
  };
  const secondsAt = (beat: number, subBeat?: number): number =>
    beatToSeconds(bpmEvents, trueBeat(beat, subBeat, beatDisplay));

  const elements: SimElement[] = [];
  const bands: SimBand[] = [];
  // 同时点击线的分组：同 tick → 一组轨号（口径与编辑器那份相同：同拍、链式相邻、只端点参与；
  // 键是把精确拍按 1e-6 取整，编辑器那边是逐个比 |Δ| < 1e-6 —— 同一容差的两写法）
  const groups = new Map<number, number[]>();
  const groupKey = (beat: number) => Math.round(beat * 1e6) / 1e6;
  const addToGroup = (beat: number, lane: number) => {
    const key = groupKey(beat);
    const arr = groups.get(key);
    if (arr) arr.push(lane);
    else groups.set(key, [lane]);
  };

  for (const note of notes as ChartNote[]) {
    if (note.type === 'Single') {
      if (note.beat < 0) continue; // ADR-0014：负 beat 不渲染
      const lane = mirrorLane(note.lane, mirror);
      elements.push({
        time: secondsAt(note.beat, note.subBeat),
        lane,
        kind: note.flick ? 'flick' : note.skill ? 'skill' : 'tap',
        length: 1,
        dirSide: null,
        dirLanes: null,
        icon: singleIconConfig(iconCtx, { ...note, lane }),
        designW: NOTE_ICON_SIZE,
        designH: NOTE_ICON_SIZE * NOTE_HEIGHT_SCALE,
        flickDecorator: note.flick === true,
      });
      addToGroup(trueBeat(note.beat, note.subBeat, beatDisplay), lane);
      continue;
    }

    if (note.type === 'LDirectional' || note.type === 'RDirectional') {
      if (note.beat < 0) continue;
      // 镜向 = 锚点轨对调 + 侧别翻面（`dirSideOf` 与编辑器同一份规则，别再自己取反一次）
      const side = dirSideOf(iconCtx, note.type === 'LDirectional');
      const lane = mirrorLane(note.lane, mirror);
      // 长度取**原值**（小数 / 越界都照实喂给 dirGroup；本体数由它自己 ceil）
      const length = Number.isFinite(note.length) ? note.length : 1;
      elements.push({
        time: secondsAt(note.beat, note.subBeat),
        lane,
        kind: 'directional',
        length,
        dirSide: side,
        dirLanes: directionalLanes(lane, side === 'L' ? 'LDirectional' : 'RDirectional', length),
        icon: noteIcons.dirFor(side, lane),
        designW: DIRECTIONAL_ICON_SIZE,
        designH: DIRECTIONAL_ICON_SIZE * DIRECTIONAL_HEIGHT_SCALE,
        flickDecorator: false,
      });
      addToGroup(trueBeat(note.beat, note.subBeat, beatDisplay), lane);
      continue;
    }

    if (note.type === 'Slide' || note.type === 'Long') {
      const conns = (note as SlideNote).connections;
      // 显示投影（ADR-0009 §2.2）：稳定排序 + 掐首尾 hidden；带体与端点身份都按它
      const projected: ConnectionNote[] = displayConnections(conns).conns;
      if (projected.length === 0) continue; // 全 hidden：画布上没有任何效果（数据保留）
      const sp = slideUsesSpBand(conns);
      const lastIdx = projected.length - 1;
      projected.forEach((conn, i) => {
        const lane = mirrorLane(conn.lane, mirror);
        const time = secondsAt(conn.beat, conn.subBeat);
        const isEnd = i === 0 || i === lastIdx;
        if (!conn.hidden && conn.beat >= 0) {
          elements.push({
            time,
            lane,
            // issue 145 #3：flick/skill 只有端点才表现；中间结点一律普通款
            kind: conn.flick && isEnd ? 'flick' : conn.skill && isEnd ? 'skill' : 'slide',
            length: 1,
            dirSide: null,
            dirLanes: null,
            icon: slideNodeIconConfig(iconCtx, { ...conn, lane }, i === 0, i === lastIdx),
            designW: SLIDE_ICON_SIZE,
            designH: SLIDE_ICON_SIZE * SLIDE_HEIGHT_SCALE,
            flickDecorator: conn.flick === true && isEnd,
          });
        }
        if (isEnd && conn.beat >= 0) addToGroup(trueBeat(conn.beat, conn.subBeat, beatDisplay), lane);
      });
      // 带体：投影序的相邻两点一段（段内 hidden 采样点就是 SP 曲线的弯，走序照投影）
      for (let i = 0; i + 1 < projected.length; i++) {
        const a = projected[i]!;
        const b = projected[i + 1]!;
        if (a.beat < 0 && b.beat < 0) continue; // 整段都在负 beat：不渲染
        bands.push({
          t0: secondsAt(a.beat, a.subBeat),
          lane0: mirrorLane(a.lane, mirror),
          t1: secondsAt(b.beat, b.subBeat),
          lane1: mirrorLane(b.lane, mirror),
          sp,
        });
      }
      continue;
    }
    // BPM / System / Opaque：不渲染不发声（与编辑器同口径）
  }

  elements.sort((a, b) => a.time - b.time);
  bands.sort((a, b) => Math.min(a.t0, a.t1) - Math.min(b.t0, b.t1));
  const simultaneous: SimSimultaneous[] = [...groups.entries()]
    .filter(([, lanes]) => lanes.length > 1)
    .map(([beat, lanes]) => ({ time: secondsAt(beat), lanes: [...lanes].sort((a, b) => a - b) }))
    .sort((a, b) => a.time - b.time);

  return {
    approachS: approachSeconds(scene.noteSpeed),
    elements,
    bands,
    simultaneous,
    // combo 走**画布那份枚举**（单键/方向键各 1、滑条逐非 hidden 结点），不是键音事件表：
    // `beat < 0` 的击打物不键音、但开播即已过线要计 combo（负 beat 击打物，ADR-0014）。
    // 按拍枚举 → 折成秒 → 按**播放时钟**排序（倒流区里拍序与秒序不一致）。
    hitTimes: comboNodePreciseBeats(notes, beatDisplay)
      .map((beat) => beatToSeconds(bpmEvents, beat))
      .sort((a, b) => a - b),
  };
}

/** 该秒的 combo 数（口径见 `SimChart.hitTimes`；二分，不每次全量扫） */
export function simComboAt(chart: SimChart, seconds: number): number {
  return upperBound(chart.hitTimes, seconds);
}

/** 首个 > target 的下标（= 该秒已有多少件过线） */
function upperBound(sorted: readonly number[], target: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}



// ---------------------------------------------------------------- 一帧绘制

/**
 * 画出 `seconds` 这一秒的仿真场（**同一份实现**服务实时回放与离线逐帧导出）。
 * `ctx` 需已按目标密度设好 transform：本函数一律用场地 CSS 像素坐标。
 */
export function drawSimFrameAt(ctx: CanvasRenderingContext2D, input: SimFrameInput, seconds: number): void {
  const { chart, metrics } = input;
  drawField(ctx, input);
  drawBands(ctx, input, seconds);
  if (input.scene.simultaneousClickLines) drawSimultaneousLines(ctx, input, seconds);
  drawElements(ctx, input, seconds);
  drawEffects(ctx, input, seconds);
  drawCombo(ctx, metrics, chart, seconds);
}

/**
 * 场地三图：背景（cover 铺满）→ 场地图 → 判定线（贴场地判定线）。
 * 后两张的矩形来自 `simGeometry`（**素材按设计 px 1:1**，见 `fieldImageRect` 的注释）——
 * 拉满画布会让素材自带的轨道标记 / 车道线与音符错位（chart-preview 18 问题 4）。
 */
function drawField(ctx: CanvasRenderingContext2D, input: SimFrameInput): void {
  const { metrics: m, assets } = input;
  ctx.save();
  ctx.fillStyle = SIM_FALLBACK_BG;
  ctx.fillRect(0, 0, m.w, m.h);
  if (assets.background) drawCover(ctx, assets.background, m.w, m.h);
  if (assets.field) {
    const r = fieldImageRect(m);
    ctx.drawImage(assets.field, r.x, r.y, r.w, r.h);
  }
  if (assets.playLine) {
    const r = playLineRect(m);
    ctx.drawImage(assets.playLine, r.x, r.y, r.w, r.h);
  }
  ctx.restore();
}

/** 背景图 cover 铺满（保持图片比例，超出部分裁掉、居中） */
function drawCover(ctx: CanvasRenderingContext2D, img: CanvasImageSource, w: number, h: number): void {
  const size = sourceSize(img);
  if (size.w <= 0 || size.h <= 0) return;
  const s = Math.max(w / size.w, h / size.h);
  const sw = w / s;
  const sh = h / s;
  ctx.drawImage(img, (size.w - sw) / 2, (size.h - sh) / 2, sw, sh, 0, 0, w, h);
}

/** 图片源尺寸（`CanvasImageSource` 各分支的尺寸字段名不同，收口在这里） */
function sourceSize(img: CanvasImageSource): { w: number; h: number } {
  const any = img as { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number };
  return { w: any.naturalWidth ?? any.width ?? 0, h: any.naturalHeight ?? any.height ?? 0 };
}

/**
 * 带体（票面「相邻结点 `(lane, A)` 两点构成的四边形填充」）：投影序相邻两点各一个四边形，
 * 过线 / 未进场的一端由 `clampApproach` 钉住。
 * 同一组（普通 / SP）的四边形**合成一条路径再填**：分片各自 fill 会在共享边留下接缝。
 */
function drawBands(ctx: CanvasRenderingContext2D, input: SimFrameInput, seconds: number): void {
  const { chart, metrics: m, assets, scene } = input;
  const T = chart.approachS;
  const alpha = Math.min(1, Math.max(0, scene.slideOpacity));
  if (alpha <= 0) return;
  const normal: SimPoint[][] = [];
  const spBands: SimPoint[][] = [];
  for (const band of chart.bands) {
    const minT = Math.min(band.t0, band.t1);
    const maxT = Math.max(band.t0, band.t1);
    if (maxT < seconds) continue; // 整段已过线
    if (minT > seconds + T) continue; // 整段还没进场（A 都贴在下限）
    const a0 = clampApproach(approachA(seconds - band.t0, T));
    const a1 = clampApproach(approachA(seconds - band.t1, T));
    if (a0 <= APPROACH.floor + EPS && a1 <= APPROACH.floor + EPS) continue;
    (band.sp ? spBands : normal).push(bandQuad(m, { lane: band.lane0, a: a0 }, { lane: band.lane1, a: a1 }));
  }
  ctx.save();
  ctx.globalAlpha = alpha;
  fillPolys(ctx, normal, assets.bandColor || SIM_BAND_COLORS.band);
  fillPolys(ctx, spBands, assets.bandColorSp || SIM_BAND_COLORS.sp);
  ctx.restore();
}

/** 一批四边形**合成一条路径**再填（seam 见 drawBands 注释） */
function fillPolys(ctx: CanvasRenderingContext2D, polys: SimPoint[][], color: string): void {
  if (polys.length === 0) return;
  ctx.fillStyle = color;
  ctx.beginPath();
  for (const poly of polys) {
    poly.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
  }
  ctx.fill();
}

/** 同时点击线：同 tick 的相邻轨之间拉一条官方精灵（横向拉伸，两端软收） */
function drawSimultaneousLines(ctx: CanvasRenderingContext2D, input: SimFrameInput, seconds: number): void {
  const { chart, metrics: m, noteIcons, spriteIcon, scene } = input;
  const sprite = noteIcons.simultaneousLine;
  if (!sprite) return;
  const T = chart.approachS;
  for (const group of chart.simultaneous) {
    const a = visibleApproach(seconds, group.time, T);
    if (a === null) continue;
    if (group.lanes.length < 2) continue;
    const y = fieldY(m, a);
    const thickness = Math.max(1, m.laneWidth * 0.3 * a * scene.noteSize);
    const xs = group.lanes.map((lane) => laneCenterX(m, lane, a));
    for (let i = 0; i + 1 < xs.length; i++) {
      const gap = xs[i + 1]! - xs[i]!;
      if (gap <= 0) continue;
      spriteIcon.render(ctx, {
        ...sprite,
        canvasX: (xs[i]! + xs[i + 1]!) / 2,
        canvasY: y,
        canvasSize: 0,
        canvasWidth: gap,
        canvasHeight: thickness,
        // 端点由相邻音符盖住：线画在音符**之前**（照编辑器画布的顺序）
      });
    }
  }
}

/** 音符层：单键 / 方向键整组 / 滑条可见结点（+ flick 顶部箭头第二层） */
function drawElements(ctx: CanvasRenderingContext2D, input: SimFrameInput, seconds: number): void {
  const { chart, metrics: m, scene, noteIcons, spriteIcon } = input;
  const T = chart.approachS;
  const elements = chart.elements;
  // 可见窗口 = Δ = seconds − time ∈ [−T, 0] ⇒ **元素时刻落在 [seconds, seconds + T]**（音符是将来才过线的，
  // chart-preview 18 问题 5：早先写成 [seconds − T, seconds] 取反，结果除"正好压线"外一个音符都不画）。
  // 在**已按 time 升序**的元素表上二分出上下界，别在长谱上每帧扫全表。
  const lo = elementBound(elements, seconds, true);
  const hi = elementBound(elements, seconds + T, false);
  const dec = noteIcons.flickTopDecorator;
  for (let i = lo; i < hi; i++) {
    const el = chart.elements[i]!;
    const a = visibleApproach(seconds, el.time, T);
    if (a === null) continue;
    const scale = simSpriteScale(m, a, scene.noteSize);
    if (el.dirLanes && el.dirSide) {
      const y = fieldY(m, a);
      const group = noteIcons.dirGroup(el.dirSide, el.length);
      for (const lane of el.dirLanes) {
        spriteIcon.render(ctx, {
          ...noteIcons.dirFor(el.dirSide, lane),
          canvasX: laneCenterX(m, lane, a),
          canvasY: y,
          canvasSize: DIRECTIONAL_ICON_SIZE,
          canvasWidth: DIRECTIONAL_ICON_SIZE,
          canvasHeight: DIRECTIONAL_ICON_SIZE * DIRECTIONAL_HEIGHT_SCALE,
          scale,
        });
      }
      const chevron = group.chevron;
      if (chevron) {
        spriteIcon.render(ctx, {
          ...chevron.config,
          // 外侧箭头照编辑器那份定位：锚点轨 + 组偏移（`offsetVirtualX` 是**原始 length** 推出的
          // 虚拟位移，`length - 1` 条轨道 —— 小数 / ≤0 的 width 也照实落位，ADR-0014 §3）
          // + 墨迹偏心修正（设计 px，随 spriteScale 放大）
          canvasX: laneCenterX(m, el.lane + chevron.offsetVirtualX / LANE_WIDTH, a) + chevron.extraDesignX * scale,
          canvasY: y,
          canvasSize: DIRECTIONAL_ICON_SIZE,
          canvasWidth: chevron.drawW,
          canvasHeight: chevron.drawH,
          scale,
        });
      }
      continue;
    }
    const pt = elementPoint(m, el.lane, a);
    spriteIcon.render(ctx, {
      ...el.icon,
      canvasX: pt.x,
      canvasY: pt.y,
      canvasSize: el.designW,
      canvasWidth: el.icon.out?.w ?? el.designW,
      canvasHeight: el.icon.out?.h ?? el.designH,
      scale,
    });
    if (el.flickDecorator && dec) {
      const flickCfg = noteIcons.flickFor(el.lane);
      spriteIcon.renderDecorator(ctx, {
        canvasX: pt.x,
        canvasY: pt.y,
        drawW: flickCfg.out?.w ?? NOTE_ICON_SIZE,
        drawH: flickCfg.out?.h ?? NOTE_ICON_SIZE * NOTE_HEIGHT_SCALE,
      }, dec, scale);
    }
  }
}

/**
 * 元素表上的二分（元素按 `time` 升序，故直接按元素读时刻，不为二分另存一份时刻数组）。
 * `inclusive` = 取"首个 ≥ t"（窗口下界）还是"首个 > t"（窗口上界）。
 */
function elementBound(elements: readonly SimElement[], time: number, inclusive: boolean): number {
  let lo = 0;
  let hi = elements.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const hit = inclusive ? elements[mid]!.time < time : elements[mid]!.time <= time;
    if (hit) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * 特效（全程序化自绘）：命中后 SIM_EFFECT_DURATION 秒内 ——
 * 轨道闪（白 0.5 → 0 的线性渐变，沿轨道透视 shear）+ 打击环 + 按样式的一笔（光柱 / 横扫 / 槽）。
 * 位置恒取**场地判定线上**（A = 1）：元素过线后消失，命中表现留在线上（游戏同观感）。
 */
function drawEffects(ctx: CanvasRenderingContext2D, input: SimFrameInput, seconds: number): void {
  const { chart, metrics: m } = input;
  const elements = chart.elements;
  // 起点 = 寿命窗口的下界；之后按 time 升序扫，遇到还没命中的就收手
  const lo = elementBound(elements, seconds - SIM_EFFECT_DURATION, true);
  ctx.save();
  for (let i = lo; i < chart.elements.length; i++) {
    const el = chart.elements[i]!;
    const p = effectProgress(seconds, el.time);
    if (p < 0) break; // 之后的都还没命中
    if (p > 1) continue;
    const alpha = effectAlpha(p);
    if (alpha <= 0) continue;
    const color = simEffectColor(el.kind, el.dirSide ?? undefined);
    const x = laneCenterX(m, el.lane, 1);
    const y = m.laneHeight;
    drawLaneFlash(ctx, m, el.lane, p);
    // 打击环
    const r = pingRadius(m, 1, p);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.5, m.laneWidth * 0.06);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    if (el.kind === 'skill') {
      // 光柱：从判定线往上的一道竖直亮带
      const beamH = m.h * SIM_LANE_FLASH_SPAN * p;
      const halfW = m.laneWidth * 0.16;
      const grad = ctx.createLinearGradient(0, y, 0, y - beamH);
      grad.addColorStop(0, color);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(x - halfW, y - beamH, halfW * 2, beamH);
    } else if (el.kind === 'flick') {
      // 横扫：两道水平短线（左右各一）
      const len = m.laneWidth * (0.42 + 0.5 * p);
      ctx.lineWidth = Math.max(1.5, m.laneWidth * 0.09);
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(x - len, y);
      ctx.lineTo(x - len * 0.35, y);
      ctx.moveTo(x + len * 0.35, y);
      ctx.lineTo(x + len, y);
      ctx.stroke();
    } else if (el.kind === 'directional') {
      // 槽：方向键整组范围内的横槽（长度随组合长度）
      const span = Math.max(1, el.length) * m.laneWidth;
      const halfH = Math.max(1.5, m.laneWidth * 0.07);
      const growth = 0.5 + 0.5 * p;
      ctx.fillStyle = color;
      ctx.fillRect(x - (span * growth) / 2, y - halfH, span * growth, halfH * 2);
    } else {
      // tap / slide：实心圆（环内）
      ctx.fillStyle = color;
      ctx.globalAlpha = alpha * 0.55;
      ctx.beginPath();
      ctx.arc(x, y, r * 0.55, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** 轨道闪：轨道透视范围内（下宽上窄）的白色线性渐变，命中后 0.5 → 0 */
function drawLaneFlash(ctx: CanvasRenderingContext2D, m: SimFieldMetrics, lane: number, p: number): void {
  const alpha = laneFlashAlpha(p);
  if (alpha <= 0) return;
  const bottomX = laneCenterX(m, lane, 1);
  const topA = Math.max(APPROACH.floor, 1 - SIM_LANE_FLASH_SPAN);
  const topX = laneCenterX(m, lane, topA);
  const bottomHalf = m.laneWidth / 2;
  const topHalf = (m.laneWidth * topA) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(bottomX - bottomHalf, m.laneHeight);
  ctx.lineTo(bottomX + bottomHalf, m.laneHeight);
  ctx.lineTo(topX + topHalf, m.laneHeight * topA);
  ctx.lineTo(topX - topHalf, m.laneHeight * topA);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, m.laneHeight, 0, m.laneHeight * topA);
  grad.addColorStop(0, `rgba(255,255,255,${alpha})`);
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.restore();
}

/** HUD：combo 计数（自绘文本，不引官方 digits / combo 精灵） */
function drawCombo(ctx: CanvasRenderingContext2D, m: SimFieldMetrics, chart: SimChart, seconds: number): void {
  const combo = simComboAt(chart, seconds);
  if (combo <= 0) return;
  const { x, y, fontSize } = comboAnchor(m);
  ctx.save();
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
  ctx.shadowBlur = fontSize * 0.25;
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 ${fontSize.toFixed(1)}px ${SIM_HUD_FONT}`;
  ctx.fillText(String(combo), x, y);
  ctx.shadowBlur = 0;
  ctx.font = `700 ${(fontSize * 0.3).toFixed(1)}px ${SIM_HUD_FONT}`;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
  ctx.fillText('COMBO', x, y + fontSize * 0.72);
  ctx.restore();
}
