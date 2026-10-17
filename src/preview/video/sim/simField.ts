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
//   - 音符盒子的**宽**取 `rendering/primitives/noteMetrics` 的设计宽（单键/滑条 36、方向键 45，
//     唯一定义处），**高**取精灵源格的自然比（`simGeometry.simNoteRect` / `simSpriteAspect`，
//     票 23 #2：设计盒的 36×21.6 不是精灵的比例，照它画会把音符纵向拉高 1.54 倍）。
//
// 素材边界：引官方素材的只有场地三图（04 的开发期直读通道）+ 音符精灵（既有运行时资产）
// + 同时点击线精灵；**特效与 combo 自 21 起优先用 Bestdori 自家精灵**（`particles` / `digits` /
// `combo`，同一开发期直读通道），缺精灵时回落程序化自绘 + 文本（两套都在本文件里）。
import type { ChartNote, ConnectionNote, SlideNote } from '../../../chart/types';
import { LANE_WIDTH, directionalLanes } from '../../../chart/geometry/ChartGeometry';
import { displayConnections, slideUsesSpBand } from '../../../chart/editing/SlideSegments';
import { trueBeat } from '../../../chart/editing/ChartEndBounds';
import { comboNodePreciseBeats } from '../../../chart/editing/NoteEditing';
import {
  DIRECTIONAL_ICON_SIZE,
  NOTE_HEIGHT_SCALE,
  NOTE_ICON_SIZE,
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
  backgroundRect,
  bandLaneAt,
  bandQuad,
  clamp01,
  clampApproach,
  comboAnchor,
  comboMetrics,
  comboPopScale,
  easeInCubic,
  easeOutCubic,
  effectAlpha,
  elementPoint,
  fieldImageRect,
  fieldY,
  laneCenterX,
  laneFlashShear,
  mirrorLane,
  pingRadius,
  playLineRect,
  simDualLineThickness,
  simEffectColor,
  simNoteRect,
  simSpriteAspect,
  simSpriteScale,
  SIM_BAND_COLORS,
  SIM_EFFECT_DURATION,
  SIM_EFFECT_TINTS,
  SIM_HOLD_RING_SQUASH,
  SIM_LANE_FLASH_ALPHA,
  SIM_LANE_FLASH_DURATION,
  SIM_LANE_FLASH_SPAN,
  SIM_SPRITE_EFFECT,
  SIM_SPRITE_EFFECT_DURATION,
  visibleApproach,
  type SimBandMaterial,
  type SimFieldMetrics,
  type SimPoint,
} from './simGeometry';
import { digitRect, particleTile, radialCircleOf, type TileSource } from './simSprites';
import type { SimSprites } from './simAssets';

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
  /** 音符速度档（1..12；T = max(0.1, (12 − n)/2) 秒） */
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
  /** 精灵（已按皮肤 + flick/skill + 色觉辅助选好款）；绘制盒子由 `simNoteRect` 从它的源格比例算出 */
  icon: SpriteIconConfig;
  /** 是否补 flick 顶部箭头（单键 / 滑条端点上的 flick） */
  flickDecorator: boolean;
}

/** 带体的一段：投影序里相邻两结点的 `(lane, A)` */
export interface SimBand {
  /**
   * 所属滑条的分组号（谱面数组序递增，同一条滑条的段连续）。
   * `drawBands` 按它把同一条滑条合成一条路径（防接缝）并逐条上色；
   * 绘制序 = 谱面数组序 ⇒ 与画布一致（后放置者在上）。
   */
  slide: number;
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
  /** 接近时长 T（秒）= max(APPROACH_MIN_SECONDS, (12 − noteSpeed)/2) */
  approachS: number;
  /** 全部元素，按 time 升序 */
  elements: SimElement[];
  /**
   * 全部带体段，**按谱面数组序**（同一条滑条的段连续）。
   * 不做时间排序：绘制序 = 后放置者在上（与画布 `renderNotes` 同口径）；
   * 两个消费方（`drawBands` / `drawHoldEffects`）都全表遍历，顺序不影响可见窗口。
   */
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
  /** 带体材质（皮肤带体图剖面采样；缺图 = 兜底常量） */
  bandMaterial: SimBandMaterial;
  /** SP 带体材质（同上，取 SP 带图） */
  bandMaterialSp: SimBandMaterial;
  /** Bestdori 自家精灵（combo / 特效）；null = 回落自绘（chart-preview 21） */
  sprites: SimSprites | null;
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
  /** 带体分组号：每条滑条一个（同一条滑条的段连续，绘制时合并成一条路径） */
  let slideSeq = 0;
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
        icon: noteIcons.dirLaneFor(side, lane),
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
      const slide = slideSeq++;
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
          slide,
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
  // bands **不排序**：谱面数组序就是绘制序（后放置者在上，与画布 `renderNotes` 同口径）；
  // 同一条滑条的段天然连续，`drawBands` 按 `slide` 分组时不必再找回来。

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
  drawCombo(ctx, metrics, chart, seconds, input.assets.sprites);
}

/**
 * 场地三图：背景（按 Bestdori 的取景矩形铺）→ 场地图 → 判定线（贴场地判定线）。
 * 三张图的矩形都来自 `simGeometry`（**素材按设计 px 1:1**，见 `fieldImageRect` 的注释）——
 * 拉满画布会让素材自带的轨道标记 / 车道线与音符错位（chart-preview 18 问题 4）；
 * 背景此前走"cover 居中裁两侧"，也不是 Bestdori 的取景（票 23 #2③ → `backgroundRect`）。
 */
function drawField(ctx: CanvasRenderingContext2D, input: SimFrameInput): void {
  const { metrics: m, assets } = input;
  ctx.save();
  ctx.fillStyle = SIM_FALLBACK_BG;
  ctx.fillRect(0, 0, m.w, m.h);
  if (assets.background) {
    const r = backgroundRect(m);
    ctx.drawImage(assets.background, r.x, r.y, r.w, r.h);
  }
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

/**
 * 带体（票面「相邻结点 `(lane, A)` 两点构成的四边形填充」）：投影序相邻两点各一个四边形。
 * **已过线的一端沿带子行进**（票 23 #1，照 Bestdori 的 `L`）：A 钉 1（贴判定线）、轨位按时间
 * 插值到未过线端 —— 横向滑条的观感是"接触点沿带子扫过去"，而不是"整条被折回头部结点那条轨"。
 * 没过线的一端保持自己的轨位；两端都还没进场的那一段直接跳过。
 *
 * **按"一条滑条"分组绘制**（issue 46）：同一条滑条的四边形仍**合成一条路径再填**（分片各自
 * fill 会在共享边留下接缝，且倒流折返要用 nonzero + 绕向归一防抵消 —— issue 45）；不同滑条
 * 各自 fill ⇒ 半透明体在交叉处自然二次合成（叠亮）、后放置者在上（与画布 `renderNotes` 同口径）。
 * 此前把**同材质全谱**并成一条路径只填一次：重叠处只应用一次 α、同材质无 z 序 —— 用户所见
 * "一色平铺、重叠处毫无变化"。
 *
 * **材质**（issue 46）：不再把"贴图中心 1 像素色"平涂。体用半透明色（皮肤带体图实测：普通
 * α≈0.55、SP≈0.48），再沿两条长边内侧铺一道亮缘（贴图边缘峰值 α≈1.0 / 体色同色）——
 * 与画布带体的"亮边 + 中间光泽"同构；亮缘是薄四边形（水平内缩，与贴图剪切同口径），不溢出几何。
 */
function drawBands(ctx: CanvasRenderingContext2D, input: SimFrameInput, seconds: number): void {
  const { chart, metrics: m, assets, scene } = input;
  const T = chart.approachS;
  const alpha = Math.min(1, Math.max(0, scene.slideOpacity));
  if (alpha <= 0) return;
  ctx.save();
  /** 当前正在累积的滑条（谱面数组序：同一条滑条的段连续） */
  let group: { slide: number; sp: boolean; quads: SimPoint[][] } | null = null;
  const flush = () => {
    if (!group) return;
    const g = group;
    group = null;
    if (g.quads.length === 0) return;
    const color = g.sp ? (assets.bandColorSp || SIM_BAND_COLORS.sp) : (assets.bandColor || SIM_BAND_COLORS.band);
    drawBandGroup(ctx, g.quads, g.sp ? assets.bandMaterialSp : assets.bandMaterial, color, alpha);
  };
  for (const band of chart.bands) {
    const minT = Math.min(band.t0, band.t1);
    const maxT = Math.max(band.t0, band.t1);
    if (maxT < seconds) continue; // 整段已过线
    if (minT > seconds + T) continue; // 整段还没进场（A 都贴在下限）
    // 过线端：A 自然落到 1（`clampApproach` 的同一支），轨位改走带子插值；
    // 未过线端：保持原轨位、A 由接近模型给（未进场时贴下限）。
    const a0 = clampApproach(approachA(seconds - band.t0, T));
    const a1 = clampApproach(approachA(seconds - band.t1, T));
    if (a0 <= APPROACH.floor + EPS && a1 <= APPROACH.floor + EPS) continue;
    const lane0 = seconds > band.t0 ? bandLaneAt(band, seconds) : band.lane0;
    const lane1 = seconds > band.t1 ? bandLaneAt(band, seconds) : band.lane1;
    if (!group || group.slide !== band.slide) {
      flush();
      group = { slide: band.slide, sp: band.sp, quads: [] };
    }
    // issue 47：段宽与结点图标同口径 × noteSize（亮缘由四边形自身半宽推出，随之自动跟随）
    group.quads.push(bandQuad(m, { lane: lane0, a: a0 }, { lane: lane1, a: a1 }, scene.noteSize));
  }
  flush();
  ctx.restore();
}

// ---------------------------------------------------------------- 带体材质

/**
 * 一条滑条的可见带体：体填充 + 自叠加亮 + 两侧亮缘（材质来自皮肤带体图剖面采样）。
 * - 体：合并路径一次 fill（防接缝、绕向归一，见 `drawBands` 注释）；
 * - 自叠：同一条滑条的段在屏幕上真的重叠时（折返 / 绕圈），重叠区再补一层体色 ——
 *   合并路径只填一次，不补就"自叠也不变亮"；画布那边是逐像素合成。
 *   只在存在折返段时扫描：正向流各段的 y 区间首尾相接、互不相交，没有自叠可能；
 * - 亮缘：沿两条长边的内侧各铺一条**薄四边形**（朝带子中心水平内缩，宽度按该段自己的
 *   半宽缩放），再合并成一条路径一次 fill。不用 `clip` + `stroke`：每滑条一次裁剪在
 *   密集谱里是主要开销，而薄四边形与体共用同一套顶点 / 绕向，同样不会外溢，
 *   接缝也与体一样被合并路径吃掉。
 */
function drawBandGroup(
  ctx: CanvasRenderingContext2D,
  quads: SimPoint[][],
  material: SimBandMaterial,
  color: string,
  alpha: number,
): void {
  const body = clamp01(material.bodyAlpha * alpha);
  if (body <= 0) return;
  // issue 45：并入同一条路径前绕向归一（正向流原生为负；倒流段 > 0 的反序）。
  // 同向重叠 = 缠绕 2 仍填充；反向不归一 ⇒ 缠绕 0 ⇒ 洞。
  const polys = quads.map(normalizeWinding);

  ctx.globalAlpha = body;
  ctx.fillStyle = color;
  ctx.beginPath();
  for (const p of polys) addPolygonPath(ctx, p);
  ctx.fill();

  // 自叠：非相邻段（含折返的相邻重合段）真重叠时补一层；相邻段只共享边（面积 0）→ 跳过。
  if (quads.some(isFoldedQuad)) {
    const boxes = quads.map(quadBBox);
    for (let i = 0; i < quads.length; i++) {
      for (let j = i + 1; j < quads.length; j++) {
        if (!bboxOverlap(boxes[i]!, boxes[j]!)) continue;
        const inter = intersectConvex(quads[i]!, quads[j]!);
        if (inter.length < 3 || Math.abs(signedArea(inter)) < 0.5) continue;
        ctx.beginPath();
        addPolygonPath(ctx, inter);
        ctx.fill();
      }
    }
  }

  const rimTarget = clamp01(material.rimAlpha * alpha);
  const rimAlpha = body >= 1 ? 1 : clamp01((rimTarget - body) / (1 - body));
  if (rimAlpha <= 0) return;
  const rimPolys = bandRimQuads(quads, material.rimFrac).map(normalizeWinding);
  if (rimPolys.length === 0) return;

  ctx.globalAlpha = rimAlpha;
  ctx.beginPath();
  for (const p of rimPolys) addPolygonPath(ctx, p);
  ctx.fill();
}

/** 折返段：b 边落在 a 边下方（正常前向流是 b 在上、y 更小） */
function isFoldedQuad(q: readonly SimPoint[]): boolean {
  return q[2]!.y > q[0]!.y + 0.5;
}

/** 绕向归一（issue 45）：面积 > 0 的反序再并入，nonzero 下同向重叠不抵消 */
function normalizeWinding(poly: SimPoint[]): SimPoint[] {
  return signedArea(poly) > 0 ? [...poly].reverse() : poly;
}

/** 四边形并入当前路径（调用方负责 `beginPath` / `fill`） */
function addPolygonPath(ctx: CanvasRenderingContext2D, poly: readonly SimPoint[]): void {
  poly.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
}

interface BandBBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function quadBBox(q: readonly SimPoint[]): BandBBox {
  const box: BandBBox = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const p of q) {
    if (p.x < box.minX) box.minX = p.x;
    if (p.x > box.maxX) box.maxX = p.x;
    if (p.y < box.minY) box.minY = p.y;
    if (p.y > box.maxY) box.maxY = p.y;
  }
  return box;
}

function bboxOverlap(a: BandBBox, b: BandBBox): boolean {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}

/**
 * 亮缘四边形：沿每条长边朝带子中心**水平**内缩 —— 与画布 `drawBandQuad` 的贴图剪切同口径
 * （贴图 X = 世界横向），且宽度按**该段自己的半宽**缩放（带子随 A 收缩时亮缘同步变窄，
 * 与画布贴图横截面的局部比例一致），不外溢。
 * 相邻段共享结点 ⇒ 相邻薄四边形共享一条边，合并成一条路径一次 fill（接缝被 union 吃掉）。
 * 零面积段（同拍水平段，两端同时刻 ⇒ 同 A）不铺亮缘 —— 它本来就不填充
 * （画布 `drawBandQuad` 同判据：`|dy| < 0.5` 直接 return）。
 */
function bandRimQuads(quads: readonly SimPoint[][], frac: number): SimPoint[][] {
  const rim: SimPoint[][] = [];
  for (const q of quads) {
    if (Math.abs(q[0]!.y - q[3]!.y) < 0.5) continue; // a 边与 b 边同高 = 零面积
    const half = (Math.abs(q[1]!.x - q[0]!.x) + Math.abs(q[2]!.x - q[3]!.x)) / 4;
    const w = half * frac;
    if (w < 0.4) continue; // 远端 A 很小时亮缘退到亚像素：不画，省几笔
    const aL = q[0]!, aR = q[1]!, bR = q[2]!, bL = q[3]!;
    rim.push([aL, bL, { x: bL.x + w, y: bL.y }, { x: aL.x + w, y: aL.y }]);
    rim.push([aR, bR, { x: bR.x - w, y: bR.y }, { x: aR.x - w, y: aR.y }]);
  }
  return rim;
}

/**
 * 两个凸四边形（带体四边形恒凸）的交集多边形（Sutherland–Hodgman）。
 * 只用于"同一条滑条自叠"的补层；相邻段只共享一条边 ⇒ 交集退化成线（面积 0）被调用方滤掉。
 */
function intersectConvex(subject: readonly SimPoint[], clip: readonly SimPoint[]): SimPoint[] {
  const orient = Math.sign(signedArea(clip));
  if (orient === 0) return [];
  let out: SimPoint[] = [...subject];
  for (let i = 0; i < clip.length && out.length > 0; i++) {
    const a = clip[i]!;
    const b = clip[(i + 1) % clip.length]!;
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j]!;
      const q = input[(j + 1) % input.length]!;
      const pIn = orient * cross(a, b, p) >= -1e-9;
      const qIn = orient * cross(a, b, q) >= -1e-9;
      if (pIn) out.push(p);
      if (pIn !== qIn) {
        const hit = lineIntersect(p, q, a, b);
        if (hit) out.push(hit);
      }
    }
  }
  return out;
}

function cross(a: SimPoint, b: SimPoint, p: SimPoint): number {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
}

function lineIntersect(p: SimPoint, q: SimPoint, a: SimPoint, b: SimPoint): SimPoint | null {
  const rx = q.x - p.x, ry = q.y - p.y;
  const sx = b.x - a.x, sy = b.y - a.y;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((a.x - p.x) * sy - (a.y - p.y) * sx) / denom;
  return { x: p.x + rx * t, y: p.y + ry * t };
}

/** 多边形的有符号面积（shoelace 公式；canvas 坐标 y 向下，正向流带体为负） */
function signedArea(poly: readonly SimPoint[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

/**
 * 同时点击线：同 tick 的一组相邻轨之间**一根跨全程**（票 23 #2②）。
 * Bestdori 就是一根（`lane .. lane + width`，两端点轨之间横向拉伸），不是逐 gap 一根；
 * 粗细走 `simDualLineThickness`（约 0.118 系数，修前 0.3 约 2.5 倍粗）。
 */
function drawSimultaneousLines(ctx: CanvasRenderingContext2D, input: SimFrameInput, seconds: number): void {
  const { chart, metrics: m, noteIcons, spriteIcon, scene } = input;
  const sprite = noteIcons.simultaneousLine;
  if (!sprite) return;
  const T = chart.approachS;
  for (const group of chart.simultaneous) {
    const a = visibleApproach(seconds, group.time, T);
    if (a === null) continue;
    if (group.lanes.length < 2) continue;
    // 分组是升序轨号：两端就是 min / max
    const x0 = laneCenterX(m, group.lanes[0]!, a);
    const x1 = laneCenterX(m, group.lanes[group.lanes.length - 1]!, a);
    const width = x1 - x0;
    if (width <= 0) continue;
    spriteIcon.render(ctx, {
      ...sprite,
      canvasX: (x0 + x1) / 2,
      canvasY: fieldY(m, a),
      canvasSize: 0,
      canvasWidth: width,
      canvasHeight: simDualLineThickness(m, a, scene.noteSize),
      // 端点由相邻音符盖住：线画在音符**之前**（照编辑器画布的顺序）
    });
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
      // 方向键本体与单键同一套盒子（票 23 #2）：只差设计宽（45 vs 36），高按精灵源格的自然比
      // —— 全组共用**锚点轨**那张的源格比（Bestdori 也是整组一个 a×s 盒子；现役包七张全 308×120）
      const body = simNoteRect(m, a, scene.noteSize, simSpriteAspect(el.icon), DIRECTIONAL_ICON_SIZE);
      // 逐轨取图（票 25 #1）：图集 7 张各自带该轨位的舞台倾角 —— 全组同一张（扁平轨那张）会让
      // 外侧本体浮在舞台平面之上（Bestdori 模拟器就是逐轨取 `note_flick_<l/r>_<lane>`）
      for (const lane of el.dirLanes) {
        spriteIcon.render(ctx, {
          ...noteIcons.dirLaneFor(el.dirSide, lane),
          canvasX: laneCenterX(m, lane, a),
          canvasY: y,
          canvasSize: body.w,
          canvasWidth: body.w,
          canvasHeight: body.h,
          scale: 1,
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
    // 音符盒子（票 23 #2）：宽 = 1.35 × noteSize × laneWidth × A、高 = 宽 × 精灵源格的自然比。
    // `simNoteRect` 给的就是**场地 px**，故这里 scale 归 1（设计 px 那一步换算已经在 rect 里）。
    const box = simNoteRect(m, a, scene.noteSize, simSpriteAspect(el.icon));
    spriteIcon.render(ctx, {
      ...el.icon,
      canvasX: pt.x,
      canvasY: pt.y,
      canvasSize: box.w,
      canvasWidth: box.w,
      canvasHeight: box.h,
      scale: 1,
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
 * 命中特效（chart-preview 21）：**有 Bestdori 精灵时照它的效果表**（`particles.png` 图块 + 生成圆 +
 * 轨道闪），缺精灵时退回程序化自绘。位置恒取**场地判定线上**（A = 1）——元素过线后消失，命中表现留在线上。
 *
 * 局部坐标：单位 = 一个 lane 宽（x/y 同尺），原点 = 命中点 `(laneCenterX(lane, 1), laneHeight)`；
 * 尺寸都是 `noteSize` 的倍数；`e = easeOutCubic(p)`、`i = easeInCubic(p)`：
 *
 * | 类型 | 窗口 | 元素（图块 col,row / 生成圆） | 尺寸 | α |
 * | --- | --- | --- | --- | --- |
 * 四样参数（窗口 / 图块 / 尺寸 / α）都在 `SIM_SPRITE_EFFECT`（`simGeometry`）里，**本文件只消费**。
 *
 * 另有**连按（带体按住）**那两笔（`drawHoldEffects`）：正在按住的那段带子，在判定线上的
 * 插值轨位画 `connectionRing`（(2,1)，不染）+ 一对对转的 `rotatingRing`（(3,1)，青），α 恒 1。
 *
 * 滑条结点（`slide`）在 Bestdori 里就是 **tap**（命中样式与配色都照 tap）。
 */
function drawEffects(ctx: CanvasRenderingContext2D, input: SimFrameInput, seconds: number): void {
  const { chart, metrics: m, assets, scene } = input;
  const elements = chart.elements;
  const sprites = assets.sprites;
  const window = sprites ? SIM_SPRITE_EFFECT_DURATION : SIM_EFFECT_DURATION;
  // 起点 = 寿命窗口的下界；之后按 time 升序扫，遇到还没命中的就收手
  const lo = elementBound(elements, seconds - window, true);
  ctx.save();
  for (let i = lo; i < chart.elements.length; i++) {
    const el = chart.elements[i]!;
    const since = seconds - el.time;
    if (since < 0) break; // 之后的都还没命中
    drawLaneFlash(ctx, m, el.lane, since);
    if (sprites) {
      if (since <= SIM_SPRITE_EFFECT_DURATION) {
        drawSpriteEffect(ctx, sprites, m, el, since, scene.noteSize);
      }
    } else if (since <= SIM_EFFECT_DURATION) {
      drawProceduralEffect(ctx, m, el, since);
    }
  }
  ctx.restore();
  if (sprites) drawHoldEffects(ctx, input, seconds);
}

/** 图块 / 生成圆的一次绘制：`center` = 以命中点为中心，`bottom` = 底边贴命中点（照 Bestdori 的 $e / He） */
interface EffectCanvas {
  ctx: CanvasRenderingContext2D;
  /** 局部单位（一个 lane 宽，CSS px） */
  u: number;
  /** 命中点 */
  x: number;
  y: number;
  /** `noteSize` 倍数 → CSS px 的换算 */
  size: number;
}

function drawCentered(c: EffectCanvas, tile: TileSource, w: number, h: number, alpha: number, dx = 0, dy = 0): void {
  c.ctx.globalAlpha = alpha;
  c.ctx.drawImage(
    tile.source, tile.sx, tile.sy, tile.sw, tile.sh,
    c.x + dx * c.u - (w * c.size * c.u) / 2, c.y + dy * c.u - (h * c.size * c.u) / 2,
    w * c.size * c.u, h * c.size * c.u,
  );
}

function drawBottom(c: EffectCanvas, tile: TileSource, w: number, h: number, alpha: number): void {
  c.ctx.globalAlpha = alpha;
  c.ctx.drawImage(
    tile.source, tile.sx, tile.sy, tile.sw, tile.sh,
    c.x - (w * c.size * c.u) / 2, c.y - h * c.size * c.u,
    w * c.size * c.u, h * c.size * c.u,
  );
}

function drawSpriteEffect(
  ctx: CanvasRenderingContext2D,
  sprites: SimSprites,
  m: SimFieldMetrics,
  el: SimElement,
  since: number,
  noteSize: number,
): void {
  const c: EffectCanvas = { ctx, u: m.laneWidth, x: laneCenterX(m, el.lane, 1), y: m.laneHeight, size: noteSize };
  const kind = el.kind === 'slide' ? 'tap' : el.kind; // Bestdori 的滑条结点 = tap
  const tint = kind === 'directional'
    ? (el.dirSide === 'R' ? SIM_EFFECT_TINTS.directionalR : SIM_EFFECT_TINTS.directionalL)
    : SIM_EFFECT_TINTS[kind];
  const white = radialCircleOf(SIM_EFFECT_TINTS.white);
  const circle = radialCircleOf(tint);
  const { window: W, tile: TILE, size: S, alpha: A } = SIM_SPRITE_EFFECT;
  const tile = (at: readonly [number, number], color: string | null = tint) =>
    particleTile(sprites, at[0], at[1], color);

  if (kind === 'tap') {
    if (since < W.beam) {
      const p = since / W.beam;
      const a = A.beam * (1 - easeInCubic(p));
      drawBottom(c, tile(TILE.beam), S.beam[0], S.beam[1], a);
      drawCentered(c, tile(TILE.slot), S.slot, S.slot, a);
    }
    if (circle && since < W.circle) {
      const p = since / W.circle;
      const e = easeOutCubic(p);
      drawCentered(c, circle, S.circle[0] * e, S.circle[1] * e, A.circle * (1 - easeInCubic(p)));
    }
    if (white && since < W.white) {
      const p = since / W.white;
      const e = easeOutCubic(p);
      drawCentered(c, white, S.circle[0] * e, S.circle[1] * e, A.white * (1 - easeInCubic(p)));
    }
    if (since < W.circle) {
      const p = since / W.circle;
      const e = easeOutCubic(p);
      const a = A.ring * (1 - easeInCubic(p));
      drawCentered(c, tile(TILE.ring), S.ring[0] * e, S.ring[1] * e, a);
      drawCentered(c, tile(TILE.ring), S.ringInner[0] * e, S.ringInner[1] * e, a);
    }
    return;
  }

  if (kind === 'flick') {
    if (since < W.beam) drawCentered(c, tile(TILE.slot), S.slot, S.slot, A.beam * (1 - easeInCubic(since / W.beam)));
    if (since < W.flickCircle) {
      const u = since / W.flickCircle;
      const w = S.flickCircleW * (1 - u);
      if (circle) drawCentered(c, circle, w, S.flickCircleH * (1 + 4 * u), 1);
      // 白圆那笔只有宽跟着收（高度恒 `2`）—— 照 bundle 原文，别顺手"对齐"成一样
      if (white) drawCentered(c, white, w, S.flickCircleH, 1);
    }
    if (since < W.circle) {
      const p = since / W.circle;
      const e = easeOutCubic(p);
      drawCentered(c, tile(TILE.ring), S.ring[0] * e, S.ring[1] * e, A.ring * (1 - easeInCubic(p)));
    }
    return;
  }

  if (kind === 'skill') {
    if (since < W.beam) {
      const a = A.beam * (1 - easeInCubic(since / W.beam));
      drawBottom(c, tile(TILE.skillBeam), S.skillBeam[0], S.skillBeam[1], a);
      drawCentered(c, tile(TILE.slot), S.slot, S.slot, a);
    }
    if (white && since < W.white) {
      const p = since / W.white;
      const e = easeOutCubic(p);
      drawCentered(c, white, S.circle[0] * e, S.circle[1] * e, A.white * (1 - easeInCubic(p)));
    }
    if (since < W.circle) {
      const p = since / W.circle;
      const e = easeOutCubic(p);
      const a = A.ring * (1 - easeInCubic(p));
      drawCentered(c, tile(TILE.star), S.star[0] * e, S.star[1] * e, a);
      drawCentered(c, tile(TILE.ring), S.ring[0] * e, S.ring[1] * e, a);
    }
    return;
  }

  // directionalFlick：斜扫一记 + 正位圆 + 箭头（照 Bestdori 的旋转 / 位移）
  const dir = el.dirSide === 'R' ? 1 : -1;
  if (circle && white && since < W.dirSweep) {
    const t = easeOutCubic(since / W.dirSweep);
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate((Math.PI / 3) * dir);
    ctx.globalAlpha = 1 - t;
    const w = S.dirSweep[0] * t * noteSize * m.laneWidth;
    const h = S.dirSweep[1] * t * noteSize * m.laneWidth;
    ctx.drawImage(circle.source, circle.sx, circle.sy, circle.sw, circle.sh, -w / 2, -h, w, h);
    ctx.drawImage(white.source, white.sx, white.sy, white.sw, white.sh, -w / 2, -h, w, h);
    ctx.restore();
    const u = since / W.dirSweep;
    drawCentered(c, circle, S.flickCircleW * (1 - u), S.flickCircleH * (1 + 4 * u), 1);
    drawCentered(c, white, S.flickCircleW * (1 - u), S.flickCircleH, 1);
  }
  if (since < W.dirArrow) {
    const p = since / W.dirArrow;
    const arrow = tile(TILE.arrow);
    const shift = easeOutCubic(p) * dir; // 圆心外移 1 个 lane
    ctx.save();
    ctx.translate(c.x + shift * m.laneWidth, c.y);
    ctx.rotate((Math.PI / 2) * dir);
    ctx.globalAlpha = A.beam * (1 - easeInCubic(p));
    const s = S.arrow * noteSize * m.laneWidth;
    // 箭头是**底边贴判定线**（bundle 的 `He`），不是居中：居中的话整枚会浮到线下面半个身位
    ctx.drawImage(arrow.source, arrow.sx, arrow.sy, arrow.sw, arrow.sh, -s / 2, -s, s, s);
    ctx.restore();
    const e = easeOutCubic(p);
    drawCentered(c, tile(TILE.ring), S.ring[0] * e, S.ring[1] * e, A.ring * (1 - easeInCubic(p)));
  }
}

/**
 * 连按（带体按住）特效（chart-preview 21 + 25 #2/#3；bundle 的 `y.forEach` **三段**）：
 * **正在按住的那一段带子**在判定线上画三笔 ——
 *   ① 滑条端点本体 `note_long_<lane>`（21 漏誊的一段；逐轨精灵，随接触点走，画在最下层）；
 *   ② `connectionRing`（(2,1)，**不染**）；
 *   ③ 一对**反向对转**的 `rotatingRing`（(3,1)，青；1× 与 0.75×），α 恒 1。
 *
 * 命中点 = 段内按秒插值的轨位（照 bundle 的 `L = from.lane + (to.lane − from.lane)·(t − t0)/(t1 − t0)`），
 * 只在 `t ∈ (段起点, 段终点]` 期间给 —— 那一段就是"正被按住"（倒流区里段可能反向，故按 min/max 判）。
 * 旋转角 = `t · 2π`（两环一个正转一个反转）。
 */
function drawHoldEffects(ctx: CanvasRenderingContext2D, input: SimFrameInput, seconds: number): void {
  const { chart, metrics: m, scene, assets, noteIcons, spriteIcon } = input;
  const sprites = assets.sprites;
  if (!sprites) return;
  const noteSize = scene.noteSize;
  const { tile: TILE, size: S, alpha: A } = SIM_SPRITE_EFFECT;
  const ring = particleTile(sprites, TILE.connectionRing[0], TILE.connectionRing[1], null);
  const rotating = particleTile(sprites, TILE.rotatingRing[0], TILE.rotatingRing[1], SIM_EFFECT_TINTS.tap);
  for (const band of chart.bands) {
    const span = band.t1 - band.t0;
    if (span === 0) continue;
    const lo = Math.min(band.t0, band.t1);
    const hi = Math.max(band.t0, band.t1);
    if (seconds <= lo || seconds > hi) continue; // 这段没被按住
    // 按住位与带体的过线端**同一条插值**（票 23 #1 把它收进 `simGeometry.bandLaneAt`，不许两份）
    const lane = bandLaneAt(band, seconds);
    const x = laneCenterX(m, lane, 1);

    // ① 端点本体（照 bundle：画在两环**之前**，故被环盖着）：逐轨 `note_long`，轨位就近取整。
    // 显式锁定 globalAlpha = 1（issue 36）：免受任何外部/命中特效 alpha 残余污染
    ctx.save();
    ctx.globalAlpha = 1;
    const endpoint = noteIcons.slideEndpointLaneFor(lane);
    const box = simNoteRect(m, 1, noteSize, simSpriteAspect(endpoint));
    spriteIcon.render(ctx, {
      ...endpoint,
      canvasX: x,
      canvasY: m.laneHeight,
      canvasSize: box.w,
      canvasWidth: box.w,
      canvasHeight: box.h,
      scale: 1,
    });
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = A.connection;
    const w = S.connectionRing[0] * noteSize * m.laneWidth;
    const h = S.connectionRing[1] * noteSize * m.laneWidth;
    ctx.drawImage(ring.source, ring.sx, ring.sy, ring.sw, ring.sh, x - w / 2, m.laneHeight - h / 2, w, h);

    // ③ 旋转环：`2n` 的**方图**（纵向 × `SIM_HOLD_RING_SQUASH` 压扁）绕命中点转 `t·2π`（第二枚反向、0.75 倍）。
    // **先转入舞台平面、再纵向压扁 2/3**（票 25 #3）：`S·R` ⇒ 椭圆轮廓恒定（横长轴）、纹样在平面内扫；
    // 修前是"转完直接画 3:2 的椭圆图"（`R·S` = 刚体翻转）⇒ 观感成 3D 转圈。
    const rw = S.rotatingRing * noteSize * m.laneWidth;
    const spin = seconds * Math.PI * 2;
    ctx.translate(x, m.laneHeight);
    ctx.scale(1, SIM_HOLD_RING_SQUASH);
    ctx.rotate(spin);
    ctx.drawImage(rotating.source, rotating.sx, rotating.sy, rotating.sw, rotating.sh, -rw / 2, -rw / 2, rw, rw);
    ctx.rotate(-2 * spin);
    const inner = rw * S.rotatingRingInner;
    ctx.drawImage(
      rotating.source, rotating.sx, rotating.sy, rotating.sw, rotating.sh,
      -inner / 2, -inner / 2, inner, inner,
    );
    ctx.restore();
  }
}

/** 程序化自绘（缺 Bestdori 精灵时的回落）：圆 / 环 / 光柱 / 槽，配色走 `SIM_EFFECT_COLORS` */
function drawProceduralEffect(ctx: CanvasRenderingContext2D, m: SimFieldMetrics, el: SimElement, since: number): void {
  const p = since / SIM_EFFECT_DURATION;
  const alpha = effectAlpha(p);
  if (alpha <= 0) return;
  const color = simEffectColor(el.kind, el.dirSide ?? undefined);
  const x = laneCenterX(m, el.lane, 1);
  const y = m.laneHeight;
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

/**
 * 轨道闪（照 Bestdori）：**满高三角楔** —— 底边贴判定线、上端随轨道斜向消失点收成一点，
 * 白 0.5 → 0 的线性渐变，命中后 0.2s 内 α = 1 − p。
 * 局部坐标：原点在画布顶中心，`x' = x + shear·y`（`laneFlashShear` 给出 shear）。
 */
function drawLaneFlash(ctx: CanvasRenderingContext2D, m: SimFieldMetrics, lane: number, since: number): void {
  if (since >= SIM_LANE_FLASH_DURATION) return;
  const p = since / SIM_LANE_FLASH_DURATION;
  const alpha = 1 - p;
  if (alpha <= 0) return;
  ctx.save();
  ctx.transform(1, 0, laneFlashShear(m, lane), 1, m.centerX, 0);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, m.laneHeight);
  ctx.lineTo(m.laneWidth, m.laneHeight);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, m.laneHeight, 0, 0);
  grad.addColorStop(0, `rgba(255,255,255,${SIM_LANE_FLASH_ALPHA * alpha})`);
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.restore();
}

/**
 * HUD：combo（chart-preview 21）—— 有 Bestdori 精灵时用 `digits.png`（10 列数字）+ `combo.png`
 * （"COMBO" 标签），整体按 `canvasHeight` 缩放、锚点 `0.85W × 0.4375H`、命中后有 0.2s 弹跳
 * （0.8 → 1.1 → 1，`comboPopScale`）；缺精灵时退回自绘文本（原实现）。
 */
function drawCombo(
  ctx: CanvasRenderingContext2D,
  m: SimFieldMetrics,
  chart: SimChart,
  seconds: number,
  sprites: SimSprites | null,
): void {
  const combo = simComboAt(chart, seconds);
  if (combo <= 0) return;
  const { x, y } = comboAnchor(m);
  if (!sprites) {
    drawComboText(ctx, m, combo);
    return;
  }
  const last = chart.hitTimes[combo - 1] ?? seconds;
  const scale = comboPopScale(Math.max(0, seconds - last));
  const { digitW, digitH, labelW, labelH, labelGap } = comboMetrics(m);
  const text = String(combo);
  ctx.save();
  ctx.globalAlpha = 1;
  // 数字：整串水平居中于锚点（照 Bestdori 的 `Ae = -length/2`）
  let dx = (-text.length / 2) * digitW;
  for (const ch of text) {
    const digit = Number(ch);
    const rect = digitRect(sprites, Number.isFinite(digit) ? digit : 0);
    ctx.drawImage(
      sprites.digits, rect.sx, rect.sy, rect.sw, rect.sh,
      x + dx * scale, y - (digitH * scale) / 2, digitW * scale, digitH * scale,
    );
    dx += digitW;
  }
  ctx.drawImage(
    sprites.combo, 0, 0, sprites.combo.width, sprites.combo.height,
    x - (labelW * scale) / 2, y + labelGap * scale, labelW * scale, labelH * scale,
  );
  ctx.restore();
}

/** combo 的自绘文本回落（缺 Bestdori 精灵时；系统无衬线 + 右对齐 + 小字 COMBO） */
function drawComboText(ctx: CanvasRenderingContext2D, m: SimFieldMetrics, combo: number): void {
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
