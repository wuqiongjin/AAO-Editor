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
import { displayConnections, slideSpans, slideUsesSpBand } from '../../../chart/editing/SlideSegments';
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
import { beatSecondsAt, getBpmEvents, type BpmEvent } from '../../../audio/AudioTiming';
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
} from './simGeometry';
import {
  drawSimBandRaster,
  SIM_BAND_RASTER_MATERIAL,
  SIM_BAND_RASTER_MATERIAL_SP,
  type SimBandRasterGroup,
  type SimBandRasterMaterial,
  type SimBandRasterScale,
  type SimBandRenderer,
} from './simBandRaster';
import { digitRect, particleTile, radialCircleOf, type TileSource } from './simSprites';
import { EMPTY_SIM_HUD_ASSETS, type SimHudAssets, type SimSprites } from './simAssets';
import {
  HUD_SPRITES,
  LETTER_TEXTS,
  LIFE_MAX,
  SCORE_MAX,
  SCORE_TIERS,
  SIM_HUD,
  SIM_JUDGE,
  comboApActive,
  formatScore,
  judgeSprite,
  judgeStateAt,
  plusAgesAt,
  plusMotionAt,
  scoreAt,
  scoreIncrement,
  scoreTierAt,
  type SimJudgeStyle,
} from './simHud';
import { HEADER_SANS } from '../../fontStack';

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
  /** 音符速度档（1..12；T = 分段映射：n ≤ 11 → (12 − n)/2，n > 11 → (16 − n)/10 秒，见 `approachSeconds`） */
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
  /**
   * `settings.preview.apCombo`：combo 是否走 AP 态（白芯 + 渐变描边 + 呼吸光晕）。
   * **可选**，缺省 `true`（Auto 恒 PERFECT ⇒ 一直是 AP 态）；关掉就是游戏常态的纯白数字。
   */
  apCombo?: boolean;
  /**
   * `settings.preview.autoMode`（票 71；2026-11-08 验收改默认关）：**可选，缺省 `false`**。
   * 开 = 判定字切 AUTO 格 + 显示 `AUTO LIVE`；关 = PERFECT 格 + 无提示。
   * **不影响 `apCombo`**；随 scene 走 ⇒ 实时预览与视频导出同一份（不做手动打歌）。
   */
  autoMode?: boolean;
  /**
   * `settings.preview.showGameUi`：**分数条 / 生命条总开关**（可选，缺省开）。
   * 关 = 分数框 / 生命 / 暂停钮 / `AUTO LIVE` 整层不画；场地与音符照常。
   * 界面文案叫「分数条与生命条显示」，自解释、不挂 `?` 说明，不露 HUD 行话。
   */
  showGameUi?: boolean;
  /**
   * `settings.preview.bgPackId`：表演背景包 ID（chart-preview 41 · ADR-0018）。
   * **可选**（缺省 = 默认 `skin00`）：只喂 `loadSimAssets` 取文件名，画面不直接消费；
   * 实时预览 / 视频导出 / 开场第③段走同一份 scene ⇒ 三处画面一致。
   */
  bgPackId?: string;
  /** `settings.preview.fieldPackId`：场地皮肤包（轨道）ID；口径同 `bgPackId` */
  fieldPackId?: string;
  /**
   * `settings.preview.bgBrightness`：表演背景亮度（chart-preview 43 · ADR-0018 §5）。
   * **可选**（缺省 = 1 = 原图）：只影响背景层的黑罩，场地图 / 判定线 / 音符不动；
   * 实时预览 / 视频导出 / 开场第③段走同一份 scene ⇒ 三处画面一致。
   */
  bgBrightness?: number;
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
  /**
   * 按住帽款式：本逻辑段**播放时间上刚经过**的那枚可见结点是不是中间结点。
   * `false` = 端点款 `note_long`、`true` = 中间结点款 `note_slide_among`；
   * hidden 采样点对逻辑段透明（`slideSpans` 口径），故段内所有小段共用同一个值。
   */
  holdAmong: boolean;
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
  /** 接近时长 T（秒）= 游戏分段映射（`approachSeconds`：n ≤ 11 → (12 − n)/2，n > 11 → (16 − n)/10） */
  approachS: number;
  /** 全部元素，按 time 升序 */
  elements: SimElement[];
  /**
   * 全部带体段，**按谱面数组序**（同一条滑条的段连续）。
   * 不做时间排序：绘制序 = 后放置者在上（与画布 `renderNotes` 同口径）；
   * 两个消费方按派生期建好的时间块跳过离屏段，保留数组序。
   * 与 elements 的时间排序一样，此派生表随输入重建，不原地编辑。
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

interface SimBandTimeBlock {
  start: number;
  end: number;
  lo: number;
  hi: number;
}

// 带体不能按秒重排（交叠处按谱面数组序上色），也不能用只前进的游标（支持任意 seek）。
// 在派生期给连续小块记 min/max 秒，播放时只进入与窗口相交的块。
// 倒流段用两端的 min/max；一条很长的段仍会保留，不按起点二分而漏掉跨窗带体。
const BAND_TIME_BLOCK_SIZE = 64;
const bandTimeBlocks = new WeakMap<SimBand[], { length: number; blocks: SimBandTimeBlock[] }>();

function indexBandTimes(bands: SimBand[]): void {
  const blocks: SimBandTimeBlock[] = [];
  for (let start = 0; start < bands.length; start += BAND_TIME_BLOCK_SIZE) {
    const end = Math.min(bands.length, start + BAND_TIME_BLOCK_SIZE);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = start; i < end; i++) {
      const band = bands[i]!;
      lo = Math.min(lo, band.t0, band.t1);
      hi = Math.max(hi, band.t0, band.t1);
    }
    blocks.push({ start, end, lo, hi });
  }
  bandTimeBlocks.set(bands, { length: bands.length, blocks });
}

function* bandsInWindow(bands: SimBand[], lo: number, hi: number): Generator<SimBand> {
  const index = bandTimeBlocks.get(bands);
  // 外部手工构造的派生表仍沿旧路径绘制；不在播放帧里补建索引。
  if (!index || index.length !== bands.length) {
    yield* bands;
    return;
  }
  for (const block of index.blocks) {
    if (block.hi < lo || block.lo > hi) continue;
    for (let i = block.start; i < block.end; i++) yield bands[i]!;
  }
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
  /** 逐像素光栅材质（chart-preview 65；`loadSimAssets` 预建 LUT，缺图 = skin00 实测兜底） */
  bandRaster: SimBandRasterMaterial;
  /** SP 逐像素光栅材质（同上，取 SP 带图） */
  bandRasterSp: SimBandRasterMaterial;
  /** Bestdori 自家精灵（combo / 特效）；null = 回落自绘（chart-preview 21） */
  sprites: SimSprites | null;
  /** 判定图集（chart-preview 51/71）；null = 判定字走纯字占位 */
  judge: HTMLImageElement | null;
  /** 打歌 HUD 顶栏（71/72）；逐件 null = 那一处留空 / 纯字 */
  hud: SimHudAssets;
}

export interface SimFrameInput {
  chart: SimChart;
  scene: SimScene;
  metrics: SimFieldMetrics;
  assets: SimFrameAssets;
  noteIcons: ActiveNoteIcons;
  spriteIcon: CanvasSpriteIcon;
  /** 票 69：与画面派生共用同一份 BPM 事件（键音事件表不再自己扫一遍谱面） */
  bpmEvents?: BpmEvent[];
  /**
   * 带体光栅比例（票 66）：离线导出显式固定 1；实时省略时固定 0.5。
   * 覆盖面积 LOD 漏算整图清零 / 复制 / 回写，真实谱全屏超预算仍不降档，已撤下。
   * 实时与导出仍共用同一份 `drawSimFrameAt`，只是输入不同（ADR-0016 §5）。
   */
  bandRasterScale?: SimBandRasterScale;
}

// ---------------------------------------------------------------- 谱面派生

/**
 * 分批派生的块大小（票 69）：每处理这么多条音符 / combo 结点让出一次主线程。
 * 取 1024：复用一条时间线后每块只有 1~2ms 的纯 JS 活，长谱（1.2 万音符）也就十余次让出；
 * 块太小会让 setTimeout(0) 的嵌套钳制（4ms）盖过派生本身，反而拖长切换。
 */
export const SIM_CHART_CHUNK_NOTES = 1024;

/**
 * 谱面 → 仿真场元素表，**可分批驱动**的唯一实现（票 69；实时回放与离线导出共用）。
 * 派生本身仍是纯逻辑：只在块边界 `yield`，同步消费方一口气跑到 done；实时预览在每个
 * yield 处让出主线程 ⇒ 长谱派生不再挤成一整段长任务。BPM 事件由调用方给（与键音
 * 事件表共用一份），整轮只构造一条 `BpmTimeline`（旧的逐音符 `beatToSeconds` 每次都 new）。
 */
export function* buildSimChartSteps(
  scene: SimScene,
  noteIcons: ActiveNoteIcons,
  bpmEvents: BpmEvent[],
  chunkNotes: number = SIM_CHART_CHUNK_NOTES,
): Generator<void, SimChart, void> {
  const { notes, beatDisplay, mirror } = scene;
  const chunk = Math.max(1, Math.floor(chunkNotes));
  const iconCtx: IconChoiceCtx = {
    noteIcons,
    beatDisplay,
    display: { colorAssist: scene.colorAssist, mirror },
  };
  const secondsOf = beatSecondsAt(bpmEvents);
  const secondsAt = (beat: number, subBeat?: number): number =>
    secondsOf(trueBeat(beat, subBeat, beatDisplay));

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

  const addNote = (note: ChartNote): void => {
    if (note.type === 'Single') {
      if (note.beat < 0) return; // ADR-0014：负 beat 不渲染
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
      return;
    }

    if (note.type === 'LDirectional' || note.type === 'RDirectional') {
      if (note.beat < 0) return;
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
      return;
    }

    if (note.type === 'Slide' || note.type === 'Long') {
      const conns = (note as SlideNote).connections;
      // 显示投影（ADR-0009 §2.2）：稳定排序 + 掐首尾 hidden；带体与端点身份都按它
      const projected: ConnectionNote[] = displayConnections(conns).conns;
      if (projected.length === 0) return; // 全 hidden：画布上没有任何效果（数据保留）
      const slide = slideSeq++;
      const sp = slideUsesSpBand(conns);
      const lastIdx = projected.length - 1;
      /** 投影序里的端点身份：首 / 尾可见结点（`displayConnections` 已掐首尾 hidden） */
      const isEndpointNode = (i: number): boolean => i === 0 || i === lastIdx;
      projected.forEach((conn, i) => {
        const lane = mirrorLane(conn.lane, mirror);
        const time = secondsAt(conn.beat, conn.subBeat);
        const isEnd = isEndpointNode(i);
        if (!conn.hidden && conn.beat >= 0) {
          elements.push({
            time,
            lane,
            // issue 145 #3：flick/skill 只有端点才表现；中间结点一律普通款
            kind: conn.flick && i === lastIdx ? 'flick' : conn.skill && isEnd ? 'skill' : 'slide',
            length: 1,
            dirSide: null,
            dirLanes: null,
            icon: slideNodeIconConfig(iconCtx, { ...conn, lane }, i === 0, i === lastIdx),
            flickDecorator: conn.flick === true && i === lastIdx,
          });
        }
        if (isEnd && conn.beat >= 0) addToGroup(trueBeat(conn.beat, conn.subBeat, beatDisplay), lane);
      });
      // 带体：投影序的相邻两点一段（段内 hidden 采样点就是 SP 曲线的弯，走序照投影）。
      // 按住帽按**逻辑段**选款：hidden 采样点对段透明（`slideSpans` 口径），段内所有小段共用
      // 「播放时间上刚经过的那枚可见结点」的款式（端点身份 = 投影下标 0 / lastIdx）。
      // 正流区它就是段起点；倒流区（负 BPM）里 t0 > t1，先经过的是秒更小的那一端 ——
      // 按玩家游玩顺序，不按投影数组序。
      for (const span of slideSpans(projected)) {
        const head = projected[span.start]!;
        const tail = projected[span.end]!;
        const leadIdx = secondsAt(head.beat, head.subBeat) <= secondsAt(tail.beat, tail.subBeat)
          ? span.start
          : span.end;
        const holdAmong = !isEndpointNode(leadIdx);
        for (let i = span.start; i < span.end; i++) {
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
            holdAmong,
          });
        }
      }
      return;
    }
    // BPM / System / Opaque：不渲染不发声（与编辑器同口径）
  };

  for (let i = 0; i < notes.length; i++) {
    addNote(notes[i] as ChartNote);
    if ((i + 1) % chunk === 0) yield;
  }

  yield; // 排序是同步长活：让出一拍再开始
  elements.sort((a, b) => a.time - b.time);
  // bands **不排序**：谱面数组序就是绘制序（后放置者在上，与画布 `renderNotes` 同口径）；
  // 同一条滑条的段天然连续，`drawBands` 按 `slide` 分组时不必再找回来。

  const simultaneous: SimSimultaneous[] = [...groups.entries()]
    .filter(([, lanes]) => lanes.length > 1)
    .map(([beat, lanes]) => ({ time: secondsAt(beat), lanes: [...lanes].sort((a, b) => a - b) }))
    .sort((a, b) => a.time - b.time);

  // combo 走**画布那份枚举**（单键/方向键各 1、滑条逐非 hidden 结点），不是键音事件表：
  // `beat < 0` 的击打物不键音、但开播即已过线要计 combo（负 beat 击打物，ADR-0014）。
  // 按拍枚举 → 折成秒 → 按**播放时钟**排序（倒流区里拍序与秒序不一致）。
  const hitTimes: number[] = [];
  const comboBeats = comboNodePreciseBeats(notes, beatDisplay);
  for (let i = 0; i < comboBeats.length; i++) {
    hitTimes.push(secondsOf(comboBeats[i]!));
    if ((i + 1) % chunk === 0) yield;
  }
  hitTimes.sort((a, b) => a - b);

  indexBandTimes(bands);

  return {
    approachS: approachSeconds(scene.noteSpeed),
    elements,
    bands,
    simultaneous,
    hitTimes,
  };
}

/** 谱面 → 仿真场元素表（纯函数；实时回放与离线导出共用同一份） */
export function buildSimChart(
  scene: SimScene,
  noteIcons: ActiveNoteIcons,
  bpmEvents: BpmEvent[] = getBpmEvents(scene.notes),
): SimChart {
  const steps = buildSimChartSteps(scene, noteIcons, bpmEvents);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

export interface SimChartChunkOptions {
  /** 让出一拍主线程（复用导出侧 `yieldToMainThread`） */
  yieldNow: () => Promise<void>;
  /** 这一轮派生已作废（切谱面 / 换皮肤 / 卸载）⇒ 结果丢弃 */
  isCancelled?: () => boolean;
  /** 调用方已算好的 BPM 事件（与键音事件表共用一份，票 69） */
  bpmEvents?: BpmEvent[];
  /** 覆盖默认块大小（单测可传小值验证分片） */
  chunkNotes?: number;
}

/** 分批派生：块间让出主线程；作废时返回 null（票 69，实时预览走这条） */
export async function buildSimChartInChunks(
  scene: SimScene,
  noteIcons: ActiveNoteIcons,
  opts: SimChartChunkOptions,
): Promise<SimChart | null> {
  const steps = buildSimChartSteps(
    scene, noteIcons, opts.bpmEvents ?? getBpmEvents(scene.notes), opts.chunkNotes,
  );
  let step = steps.next();
  while (!step.done) {
    if (opts.isCancelled?.()) return null;
    await opts.yieldNow();
    if (opts.isCancelled?.()) return null;
    step = steps.next();
  }
  return step.value;
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
export function drawSimFrameAt(
  ctx: CanvasRenderingContext2D,
  input: SimFrameInput,
  seconds: number,
  layers?: SimFrameLayers,
): void {
  const { chart, metrics } = input;
  // 2026-11-08 验收：默认关 AUTO；分数条 / 生命条只用一枚总开关（缺省全开）
  const autoMode = input.scene.autoMode ?? false;
  const showGameUi = input.scene.showGameUi ?? true;
  if (layers?.fieldBitmap) ctx.drawImage(layers.fieldBitmap, 0, 0, metrics.w, metrics.h);
  else drawField(ctx, input, layers?.backgroundAlpha ?? 1, layers?.trackAlpha ?? 1);
  // 票 74 回修：noteAlpha 只包住「正在接近」的三层（带体 / 双押线 / 音符）。
  // 带体走逐像素光栅，自己的 save/restore 会把 globalAlpha 钉成 1 ⇒ 改从 baseAlpha 传进去；
  // 其余两层是精灵 drawImage，直接借 ctx.globalAlpha；判定线 / 特效 / HUD 全不受影响。
  const noteAlpha = clamp01(layers?.noteAlpha ?? 1);
  drawBands(ctx, input, seconds, noteAlpha, layers?.bandRenderer);
  if (noteAlpha < 1) {
    ctx.save();
    ctx.globalAlpha = noteAlpha;
  }
  if (input.scene.simultaneousClickLines) drawSimultaneousLines(ctx, input, seconds);
  drawElements(ctx, input, seconds);
  if (noteAlpha < 1) ctx.restore();
  drawEffects(ctx, input, seconds);
  // 顶栏 HUD（71/72）画在判定字 / combo 之前：它是背景上的常驻层，不压字也不压数。
  // 结尾段把舞台按谱面末帧重画一次，那里只要场地，传 `hud: false` 收掉整层；
  // 用户关掉「分数条与生命条显示」时走同一道门。
  // 票 76：`hudAlpha` 是整层淡入 / 淡出倍率，缺省 1 ⇒ 实时回放观感不变。
  if (layers?.hud !== false && showGameUi) {
    drawTopBar(ctx, metrics, chart, seconds, input.assets.hud, autoMode,
      clamp01(layers?.hudAlpha ?? 1), seconds, layers?.lifeGauge);
  }
  // 判定字（51/71）在 combo 之下：两条 HUD 不重叠，先字后数只为免得字块压在数字上
  if (layers?.judge !== null) {
    drawJudgement(ctx, metrics, chart, seconds, input.assets.judge, autoMode, layers?.judge);
  }
  // AP 态只由 `settings.preview.apCombo` 决定（2026-11-08 验收：AUTO 不再干预）
  drawCombo(ctx, metrics, chart, seconds, input.assets.sprites, layers?.comboAlpha ?? 1, {
    ap: comboApActive(input.scene.apCombo ?? true),
    ...layers?.combo,
  }, layers?.comboShadows);
}

/**
 * 一帧的**图层开关**（chart-preview 52 的结尾段要分层收：轨道 / combo 各自淡出）。
 *
 * 全部可选，缺省 = 现有观感（一次画全）。`judge: null` = 这一帧不画判定字。
 */
export interface SimFrameLayers {
  /** 实时场地中固定的背景、亮度遮罩、轨道和判定线，按舞台位图尺寸合成。 */
  fieldBitmap?: ImageBitmap;
  /** 实时舞台可选的带体渲染器，显式指定光栅比例的离线帧仍走 CPU。 */
  bandRenderer?: SimBandRenderer;
  /** 背景（bgskin）alpha */
  backgroundAlpha?: number;
  /** 轨道（场地图 + 判定线）alpha */
  trackAlpha?: number;
  /** combo alpha */
  comboAlpha?: number;
  /**
   * 音符层（带体 / 双押线 / 音符）alpha（票 74 成片验收回修）。
   * 只在导出前导段头 15 帧（0.25s @60fps）给 <1，收掉慢速档首音符 A≈0.22 直现的突变；
   * 缺省 1，实时回放不传 ⇒ 观感不变。
   */
  noteAlpha?: number;
  /** 判定字样式（`null` = 不画） */
  judge?: Partial<SimJudgeStyle> | null;
  /** 打歌 HUD 顶栏（`false` = 不画；结尾段的舞台用它） */
  hud?: boolean;
  /**
   * 顶栏 HUD **整层** alpha（票 76 跨段独立层的淡入 / 淡出倍率）。
   * 缺省 1，实时回放不传 ⇒ 观感不变；结尾段由出帧入口按绝对秒算好传进来。
   */
  hudAlpha?: number;
  /** combo 样式 */
  combo?: Partial<SimComboStyle>;
  /** 实时预览已准备好的 COMBO 阴影贴图。 */
  comboShadows?: SimComboShadows;
  /** 实时预览按舞台物理像素准备的生命条填充。 */
  lifeGauge?: SimLifeGauge;
}

/**
 * 跨段 HUD 独立层（票 76）：开场 / 结尾段不经过 `drawSimFrameAt` 时，用同一个
 * `drawTopBar` 单独画顶栏。`drawSimFrameAt` 自己也走这里同一条绘制路径，不开第二份真相。
 * `flowSeconds` 只驱动 SS+ 星点相位，与 `seconds`（分数 / `+增量`）分开；缺省 = `seconds`。
 */
export function drawSimHudLayer(
  ctx: CanvasRenderingContext2D,
  input: SimFrameInput,
  seconds: number,
  alpha: number = 1,
  flowSeconds: number = seconds,
): void {
  if ((input.scene.showGameUi ?? true) === false) return;
  const a = clamp01(alpha);
  if (a <= 0) return;
  drawTopBar(ctx, input.metrics, input.chart, seconds, input.assets.hud,
    input.scene.autoMode ?? false, a, flowSeconds);
}

/**
 * 场地三图：背景（按 Bestdori 的取景矩形铺）→ 场地图 → 判定线（贴场地判定线）。
 * 三张图的矩形都来自 `simGeometry`（**素材按设计 px 1:1**，见 `fieldImageRect` 的注释）——
 * 拉满画布会让素材自带的轨道标记 / 车道线与音符错位（chart-preview 18 问题 4）；
 * 背景此前走"cover 居中裁两侧"，也不是 Bestdori 的取景（票 23 #2③ → `backgroundRect`）。
 *
 * 三层抽到 `drawFieldLayers`：**设置面板的 hover 大预览也画这三层**（票 56 Q1=D），
 * 预览与正片必须同一份几何与层序，不另写一份。
 */
function drawField(
  ctx: CanvasRenderingContext2D,
  input: SimFrameInput,
  backgroundAlpha = 1,
  trackAlpha = 1,
): void {
  ctx.save();
  drawFieldLayers(ctx, input.metrics, input.assets, input.scene.bgBrightness, backgroundAlpha, trackAlpha);
  ctx.restore();
}

/** 每次场地输入或像素密度变化时重绘。导出的轨道和背景有独立淡入淡出，逐层绘制。 */
export function prepareSimFieldBitmap(input: SimFrameInput, density: number): ImageBitmap | undefined {
  const { assets, metrics, scene } = input;
  if (typeof OffscreenCanvas === 'undefined' || !(assets.background || assets.field || assets.playLine)) return;
  const width = Math.max(1, Math.round(metrics.w * density));
  const height = Math.max(1, Math.round(metrics.h * density));
  try {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx || typeof canvas.transferToImageBitmap !== 'function') return;
    // 播放舞台画过音符后一直使用 high。底图也要用同一滤波缩放素材。
    ctx.imageSmoothingQuality = 'high';
    ctx.setTransform(width / metrics.w, 0, 0, height / metrics.h, 0, 0);
    drawFieldLayers(ctx, metrics, assets, scene.bgBrightness);
    return canvas.transferToImageBitmap();
  } catch (error) {
    console.warn('[preview] 场地底图准备失败，按原素材绘制', error);
    return;
  }
}

/** 场地三图 + 背景亮度黑罩（`brightness` 缺省 = 1 = 原图；两个 alpha 供结尾段分层收） */
export function drawFieldLayers(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  m: SimFieldMetrics,
  assets: Pick<SimFrameAssets, 'background' | 'field' | 'playLine'>,
  brightness: number = 1,
  backgroundAlpha: number = 1,
  trackAlpha: number = 1,
): void {
  drawSimBackground(ctx, m, assets.background, brightness, backgroundAlpha);
  // 轨道两层（场地图 + 判定线）一起退，背景留着 —— 结尾段"只剩舞台"就靠这个
  const track = clamp01(trackAlpha);
  if (assets.field && track > 0.002) {
    const r = fieldImageRect(m);
    ctx.globalAlpha = track;
    ctx.drawImage(assets.field, r.x, r.y, r.w, r.h);
    ctx.globalAlpha = 1;
  }
  if (assets.playLine && track > 0.002) {
    const r = playLineRect(m);
    ctx.globalAlpha = track;
    ctx.drawImage(assets.playLine, r.x, r.y, r.w, r.h);
    ctx.globalAlpha = 1;
  }
}

/**
 * 背景层：兜底底色 → 背景图 → 亮度黑罩（chart-preview 43 · ADR-0018 §5）。
 *
 * 黑罩 `alpha = 1 − 亮度`（`out = in × (1 − α)` 数学上就是 RGB × 亮度），**紧跟在背景图之后**
 * 落笔 ⇒ 只压背景，场地图 / 判定线 / 音符画在其后、不受影响。没有背景图时不压
 * （没有东西可压，兜底底色保持原样；缺素材空态也不该被无故压黑）。
 *
 * 动画段 / 视频导出 / 面板预览都走这里 —— "只压暗、只压背景层"只有这一处实现。
 */
export function drawSimBackground(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  m: SimFieldMetrics,
  img: CanvasImageSource | null,
  brightness: number = 1,
  backgroundAlpha: number = 1,
): void {
  // 兜底底色不受淡出影响：结尾段退掉的是背景图，露出的是这块底色
  ctx.fillStyle = SIM_FALLBACK_BG;
  ctx.fillRect(0, 0, m.w, m.h);
  if (!img) return;
  const alpha = clamp01(backgroundAlpha);
  if (alpha <= 0.002) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  const r = backgroundRect(m);
  ctx.drawImage(img, r.x, r.y, r.w, r.h);
  // 非有限值按"原图"（不是按 0：那会把整屏压黑）
  const level = Number.isFinite(brightness) ? Math.min(1, Math.max(0, brightness)) : 1;
  const dim = 1 - level;
  if (dim > 0) {
    ctx.fillStyle = `rgba(0, 0, 0, ${dim})`;
    ctx.fillRect(0, 0, m.w, m.h);
  }
  ctx.restore();
}

/**
 * 带体（chart-preview 65）：可见窗口里的段按滑条分组，交给 `simBandRaster` 做
 * **沿整条中心线连续求值**的逐像素光栅 —— 横截面 α 取皮肤贴图 17 点剖面（与画布同一口径），
 * 纵向曲线按整条一次（普通带两端实中间虚、SP 纵向恒定），半宽随接近值 A 逐点变化。
 * 一帧只写一张共享 RGBA 缓冲：一次 `putImageData` + 一次 `drawImage`；实时预览与视频导出
 * 共用这里的 `drawSimFrameAt`（ADR-0016 §5）。票 66 补修后实时固定 50%，
 * 导出在 `frameDriver` 显式给 1；几何、分组、叠亮口径均不变。
 *
 * 65 之前是「常数体 α + 3% 亮缘薄四边形」平涂，且把同材质全谱并成一条路径 ⇒ 段接缝、
 * 曲线暗缝、SP 绿条与游戏材质不符（原型 B 的暗缝指标 4.0 vs 现状 25.3，research §5）。
 * 逐像素写入天然消掉段间横纹；倒流折返由 `splitBandAtFolds` 切 y 单调 run + 像素内
 * screen 合成 ⇒ issue 45「不抵消成洞」与 issue 46「自叠 / 交叉叠亮」同源保留；
 * 组按谱面数组序写入 ⇒ RGB 后放置者在上。
 *
 * 几何口径一字未动：可见窗口 `[seconds, seconds+T]`、`clampApproach`、过线端 `bandLaneAt`
 * 插值、`bandQuad` 的 ×`noteSize`（issue 47）、端点 / 双押线 / 特效 / HUD 全不碰。
 */
export function visibleSimBandGroups(
  chart: SimChart,
  scene: SimScene,
  m: SimFieldMetrics,
  seconds: number,
): SimBandRasterGroup[] {
  const T = chart.approachS;
  const groups: SimBandRasterGroup[] = [];
  for (const band of bandsInWindow(chart.bands, seconds, seconds + T)) {
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
    // 谱面数组序：同一条滑条的段天然连续，换组才追加（后放置者在上）
    let group = groups[groups.length - 1];
    if (!group || group.slide !== band.slide) {
      group = { slide: band.slide, sp: band.sp, quads: [] };
      groups.push(group);
    }
    // issue 47：段宽与结点图标同口径 × noteSize
    group.quads.push(bandQuad(m, { lane: lane0, a: a0 }, { lane: lane1, a: a1 }, scene.noteSize));
  }
  return groups;
}

function drawBands(
  ctx: CanvasRenderingContext2D,
  input: SimFrameInput,
  seconds: number,
  noteAlpha: number,
  renderer?: SimBandRenderer,
): void {
  const { chart, metrics, assets, scene } = input;
  const alpha = clamp01(scene.slideOpacity) * noteAlpha;
  if (alpha <= 0) return;
  const groups = visibleSimBandGroups(chart, scene, metrics, seconds);
  if (groups.length === 0) return;
  const normal = assets.bandRaster ?? SIM_BAND_RASTER_MATERIAL;
  const sp = assets.bandRasterSp ?? SIM_BAND_RASTER_MATERIAL_SP;
  if (input.bandRasterScale === undefined && renderer?.(ctx, groups, normal, sp, alpha, metrics)) return;
  drawSimBandRaster(ctx, groups, normal, sp, alpha, metrics, input.bandRasterScale);
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
 *   ① 按住帽本体（21 漏誊的一段；票 77 起全轨统一扁平款，随接触点走，画在最下层）——
 *      经过中间结点后由 `note_long` 换成中间结点款 `note_slide_among`（`SimBand.holdAmong`）；
 *   ② `connectionRing`（(2,1)，**不染**）；
 *   ③ 一对**反向对转**的 `rotatingRing`（(3,1)，青；1× 与 0.75×），α 恒 1。
 *
 * 命中点 = 段内按秒插值的轨位（照 bundle 的 `L = from.lane + (to.lane − from.lane)·(t − t0)/(t1 − t0)`），
 * 只在 `t ∈ (段起点, 段终点]` 期间给 —— 那一段就是"正被按住"（倒流区里段可能反向，故按 min/max 判）。
 * 款式只跟**刚经过的可见结点**走，hidden 采样点不切换；两环不随款式变。
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
  for (const band of bandsInWindow(chart.bands, seconds, seconds)) {
    const span = band.t1 - band.t0;
    if (span === 0) continue;
    const lo = Math.min(band.t0, band.t1);
    const hi = Math.max(band.t0, band.t1);
    if (seconds <= lo || seconds > hi) continue; // 这段没被按住
    // 按住位与带体的过线端**同一条插值**（票 23 #1 把它收进 `simGeometry.bandLaneAt`，不许两份）
    const lane = bandLaneAt(band, seconds);
    const x = laneCenterX(m, lane, 1);

    // ① 按住帽本体（照 bundle：画在两环**之前**，故被环盖着）：票 77 统一取扁平款，
    // 逐轨 `note_long_<lane>` 自带舞台透视倾角（越靠外轨越歪），与全轨道扁平化定案冲突，不按轨取图。
    // 经过中间结点后换成 `note_slide_among`；款式由派生期按逻辑段定好，这里只负责取图。
    // 显式锁定 globalAlpha = 1（issue 36）：免受任何外部/命中特效 alpha 残余污染
    ctx.save();
    ctx.globalAlpha = 1;
    const holdIcon = band.holdAmong ? noteIcons.slideAmongFor(lane) : noteIcons.slideEndpointFor(lane);
    const box = simNoteRect(m, 1, noteSize, simSpriteAspect(holdIcon));
    spriteIcon.render(ctx, {
      ...holdIcon,
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

/** 缺 HUD 素材时的空槽（与 `emptySimAssets()` 同一份；手工拼的 fake frame 也走得过） */
const EMPTY_HUD: SimHudAssets = EMPTY_SIM_HUD_ASSETS;

/** 小圆角矩形路径（槽不是胶囊；`bandRadius` 是 × 槽高） */
function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/**
 * 组件横向 4 切片：星章 / 绿心 / 右端圆角固定，中间两段按原宽比例分掉剩余宽度。
 *
 * **竖线的根因**：`drawImage` 画在小数 x 上时左列按覆盖率与背景混合，相邻两块各混一次
 * 就成了一条透出背景的 1px 线（原型第五轮修掉的那两条）。原型按 **CSS 像素**取整，
 * 但生产帧可能带任意 CTM（实时回放 `bw/metrics.w`、dpr 1.25…），整数 CSS 像素落到
 * 物理像素上仍可能是半列 —— 所以这里取整到**物理像素列**，并给相邻切片各留一个物理
 * 像素的同源重叠（bleed），把边界那半透明列彻底盖住。外沿保留抗锯齿，不参与取整。
 */
function sliceX(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  src: readonly [number, number, number, number],
  dx: number, dy: number, dw: number, dh: number,
  slices: readonly { sx: number; sw: number; flex: boolean }[],
  ky: number,
): void {
  const t = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null;
  const a = t && Number.isFinite(t.a) && t.a > 0 ? t.a : 1;
  const e = t && Number.isFinite(t.e) ? t.e : 0;
  const px = 1 / a;
  const snap = (v: number) => (Math.round(v * a + e) - e) / a;
  const fixed = slices.filter((p) => !p.flex).reduce((r, p) => r + p.sw, 0) * ky;
  const flexTotal = slices.filter((p) => p.flex).reduce((r, p) => r + p.sw, 0) || 1;
  const flexSpace = Math.max(0, dw - fixed);
  const edges = [dx];
  let acc = dx;
  for (let i = 0; i < slices.length; i++) {
    const p = slices[i]!;
    acc += p.flex ? (p.sw / flexTotal) * flexSpace : p.sw * ky;
    edges.push(i === slices.length - 1 ? dx + dw : snap(acc));
  }
  for (let i = 0; i < slices.length; i++) {
    const p = slices[i]!;
    const x0 = edges[i]!;
    const w0 = edges[i + 1]! - x0;
    if (w0 <= 0) continue;
    const left = i > 0 ? px : 0;
    const right = i < slices.length - 1 ? px : 0;
    const srcPerCss = p.sw / w0;
    ctx.drawImage(
      img,
      p.sx - left * srcPerCss, src[1], p.sw + (left + right) * srcPerCss, src[3],
      x0 - left, dy, w0 + left + right, dh,
    );
  }
}

/** 分数组件几何：外框 + 空灰带（都按图片比例从 `boxH` 推） */
function scoreGeom(s: number): {
  x: number; y: number; w: number; h: number; ky: number;
  band: { x: number; y: number; w: number; h: number };
} {
  const x = SIM_HUD.boxX * s;
  const y = SIM_HUD.boxY * s;
  const w = SIM_HUD.boxW * s;
  const h = SIM_HUD.boxH * s;
  const ky = h / HUD_SPRITES.scoreBar[3];
  const b = HUD_SPRITES.scoreBand;
  return {
    x, y, w, h, ky,
    band: {
      x: x + b.x * ky,
      y: y + b.y * ky,
      w: w - (HUD_SPRITES.scoreBar[2] - b.x - b.w) * ky - b.x * ky,
      h: b.h * ky,
    },
  };
}

function drawScoreBox(
  ctx: CanvasRenderingContext2D,
  hud: SimHudAssets,
  s: number,
  flowSeconds: number,
  score: number,
  inc: number,
  ages: number[],
  alpha: number,
): void {
  const { x, y, w, h, ky, band } = scoreGeom(s);

  // 1) 整块分数组件；缺件只降级成描边框，不画假组件 / 不留白块
  if (!hud.scoreBar) {
    ctx.strokeStyle = 'rgba(255,255,255,.35)';
    ctx.lineWidth = 2 * s;
    roundRectPath(ctx, x, y, w, h, 18 * s);
    ctx.stroke();
  } else {
    sliceX(ctx, hud.scoreBar, HUD_SPRITES.scoreBar, x, y, w, h, HUD_SPRITES.scoreSlices, ky);
  }

  const tierIndex = scoreTierAt(score);
  const tier = SCORE_TIERS[tierIndex];
  const frac = clamp01((score / SCORE_MAX) * SIM_HUD.fillScale);
  // 0 分 = 空槽，绝不画填充条；有分才保住「左端一颗」的最小宽度（票 72 验收修正）
  const fillW = frac <= 0 ? 0 : Math.max(band.h * 1.7, band.w * frac);
  const br = Math.max(0, Math.min(0.5, SIM_HUD.bandRadius)) * band.h;

  // 2) 空槽里画填充条：从**官方渐变条 A** 取该档窗口拉伸
  if (hud.rhythmGameUI && fillW > 0) {
    ctx.save();
    roundRectPath(ctx, band.x, band.y, fillW, band.h, br);
    ctx.clip();
    const bar = HUD_SPRITES.barA;
    const f0 = Math.min(tier.from, tier.to);
    const f1 = Math.max(tier.from, tier.to);
    ctx.drawImage(
      hud.rhythmGameUI,
      bar[0] + bar[2] * f0, bar[1], Math.max(1, bar[2] * (f1 - f0)), bar[3],
      band.x, band.y, fillW, band.h,
    );
    // 3) SS+ 档：官方四芒星左→右流动、循环（S-SS 与 SS+ 共用同一条，只 SS+ 叠这层）
    if (tierIndex === SCORE_TIERS.length - 1 && hud.fever) {
      drawStarFlow(ctx, hud.fever, band, fillW, flowSeconds, s, alpha);
    }
    ctx.restore();
  }

  // 4) 等级字母 + ▽ 刻度（自绘；画在裁剪之外，刻度往下推才不会被裁掉）
  drawLetters(ctx, band, s, alpha);
  // 5) 7 位定宽分数（占位字：前导零灰、有效位洋红）
  drawDigits(ctx, x, y, w, h, s, score);
  // 6) `+增量`：窗口内每次命中各一条 `+inc`（不合并）；位移 / 亮度 / 渐隐按 SIM_HUD.plus* 可调
  drawPlus(ctx, x, w, s, inc, ages, alpha);
}

/** 灰带上的 C / B / A / S / SS + ▽：官方图集没有这套字母 / 刻度，Canvas 自绘 */
function drawLetters(
  ctx: CanvasRenderingContext2D,
  band: { x: number; y: number; w: number; h: number },
  s: number,
  alpha: number,
): void {
  const lh = Math.min(SIM_HUD.letterH * s, band.h * 0.66);
  const fontPx = lh / 0.72;
  const tickH = SIM_HUD.tickH * s;
  const tickW = tickH * 1.35;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 ${fontPx}px ${HEADER_SANS}`;
  for (let i = 0; i < LETTER_TEXTS.length; i++) {
    const cx = band.x + SIM_HUD.thresholds[i]! * band.w;
    const cy = band.y + band.h * 0.38 + SIM_HUD.letterDY * s;
    ctx.globalAlpha = SIM_HUD.letterAlpha * alpha;
    ctx.lineWidth = Math.max(1.2, fontPx * 0.13);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = SIM_HUD.letterEdge;
    ctx.strokeText(LETTER_TEXTS[i]!, cx, cy);
    ctx.fillStyle = SIM_HUD.letterColor;
    ctx.fillText(LETTER_TEXTS[i]!, cx, cy);

    const ty = band.y + band.h * 0.84 + SIM_HUD.tickGap * s;
    ctx.globalAlpha = SIM_HUD.letterAlpha * 0.92 * alpha;
    ctx.beginPath();
    ctx.moveTo(cx - tickW / 2, ty - tickH / 2);
    ctx.lineTo(cx + tickW / 2, ty - tickH / 2);
    ctx.lineTo(cx, ty + tickH / 2);
    ctx.closePath();
    ctx.fillStyle = SIM_HUD.letterColor;
    ctx.fill();
  }
  ctx.restore();
}

/** 7 位定宽（官方没有 0–9 精灵表，先用 HEADER_SANS 占位） */
function drawDigits(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, s: number, score: number,
): void {
  const px = SIM_HUD.digitFont * s;
  const text = formatScore(score);
  const live = String(Math.round(Math.max(0, Math.min(SCORE_MAX, score)))).length;
  const lead = Math.max(0, text.length - live);
  ctx.save();
  ctx.font = `700 ${px}px ${HEADER_SANS}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  let cx = x + w * SIM_HUD.digitDX;
  const cy = y + h * SIM_HUD.digitDY;
  for (let i = 0; i < text.length; i++) {
    ctx.fillStyle = i < lead ? SIM_HUD.zeroColor : SIM_HUD.liveColor;
    ctx.fillText(text[i]!, cx, cy);
    const measured = ctx.measureText(text[i]!);
    const adv = measured && Number.isFinite(measured.width) ? measured.width : px * 0.62;
    cx += adv + SIM_HUD.digitTrack * s;
  }
  ctx.restore();
}

/**
 * `+增量`（票 72 Q22；2026-11-09 验收回退合并）：窗口内**每次命中各画一条 `+${inc}`**，
 * 不设条数上限、不把多次命中并成一个数字。
 *
 * 2026-11-14 用户定案的两段运动由 `plusMotionAt` 给：极快地冲到最右侧，
 * 随后缓慢再右移一点点并同时淡出；`plusSpreadX/Y` 可再逐条错开
 * （默认 0 = 所有命中走同一条轨迹，实机口径）。全部是观感参数，不改命中语义。
 */
function drawPlus(
  ctx: CanvasRenderingContext2D,
  x: number, w: number, s: number, inc: number, ages: number[], alpha: number,
): void {
  if (inc <= 0 || ages.length === 0) return;
  ctx.save();
  ctx.font = `800 ${SIM_HUD.plusFont * s}px ${HEADER_SANS}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, SIM_HUD.plusFont * s * 0.14);
  for (let i = 0; i < ages.length; i++) {
    const motion = plusMotionAt(ages[i]!, {
      dur: SIM_HUD.plusDur,
      dashFrac: SIM_HUD.plusDashFrac,
      fadeFrac: SIM_HUD.plusFadeFrac,
      dx: SIM_HUD.plusDX,
      driftDX: SIM_HUD.plusDriftDX,
      baseAlpha: SIM_HUD.plusBaseAlpha,
    });
    const px = x + w * (SIM_HUD.plusX + motion.travel + i * SIM_HUD.plusSpreadX);
    const py = SIM_HUD.plusY * s - (motion.p * SIM_HUD.plusRise + i * SIM_HUD.plusSpreadY) * s;
    ctx.globalAlpha = motion.alpha * alpha;
    const text = `+${inc}`;
    ctx.strokeStyle = 'rgba(20,24,32,.5)';
    ctx.strokeText(text, px, py);
    ctx.fillStyle = SIM_HUD.plusColor;
    ctx.fillText(text, px, py);
  }
  ctx.restore();
}

/** SS+ 星点层：在分数条现有裁剪内叠加四芒星，大小不一、错相位、左→右循环。 */
function drawStarFlow(
  ctx: CanvasRenderingContext2D,
  fever: HTMLImageElement,
  band: { x: number; y: number; w: number; h: number },
  fillW: number,
  flowSeconds: number,
  s: number,
  alpha: number,
): void {
  const n = Math.max(1, Math.round(SIM_HUD.starCount));
  const span = Math.max(1, fillW);
  const box = HUD_SPRITES.star;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    const speed = 0.22 + (((i * 37) % 11) / 11) * 0.26;
    const phase = (flowSeconds * speed * SIM_HUD.starSpeed + i / n) % 1;
    const sz = SIM_HUD.starSize * s * (0.55 + (((i * 53) % 7) / 7) * 0.95);
    const sx = band.x + phase * span - sz * 0.5;
    const sy = band.y + band.h * (0.18 + (((i * 29) % 5) / 5) * 0.64) - sz * 0.5;
    ctx.globalAlpha = SIM_HUD.starAlpha * alpha;
    ctx.drawImage(fever, box[0], box[1], box[2], box[3], sx, sy, sz, sz);
  }
  ctx.restore();
}

/**
 * 生命组件：恒满 1000/1000（预览无伤）。
 * gauge 按 2026-11-08 用户给的实机截图：**上段亮绿 / 下段深绿**、中间一条短过渡的
 * 竖向两段渐变，没有网点也没有洋红层。色值取样自截图（`#6eff69` / `#47aa43`），
 * 参数落 `SIM_HUD`，不依赖任何图集切图。
 *
 * 2026-11-14：填充按 `lifeGaugeInset` 从 `lifeBand` 四边内缩，让 `life-bar.png`
 * 空槽自带的深色框露出来 —— 实机那圈「黑边」就是它，铺满 bbox 会把它盖掉。
 */
interface SimLifeGauge {
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
  w: number;
  h: number;
}

function lifeGaugeRect(s: number) {
  const ky = SIM_HUD.lifeH * s / HUD_SPRITES.lifeBar[3];
  const b = HUD_SPRITES.lifeBand;
  const inset = Math.max(0, SIM_HUD.lifeGaugeInset) * ky;
  const h = b.h * ky;
  return {
    x: SIM_HUD.lifeX * s + b.x * ky + inset,
    y: SIM_HUD.lifeY * s + b.y * ky + inset,
    w: SIM_HUD.lifeW * s - (HUD_SPRITES.lifeBar[2] - b.w) * ky - 2 * inset,
    h: h - 2 * inset,
    radius: Math.max(0, Math.min(0.5, SIM_HUD.bandRadius) * h - inset),
  };
}

function paintLifeGauge(ctx: CanvasRenderingContext2D, rect: ReturnType<typeof lifeGaugeRect>): void {
  const { x, y, w, h, radius } = rect;
  ctx.save();
  roundRectPath(ctx, x, y, w, h, radius);
  ctx.clip();
  const split = Math.max(0.05, Math.min(0.95, SIM_HUD.lifeGaugeSplit));
  const grad = ctx.createLinearGradient(0, y, 0, y + h);
  grad.addColorStop(0, SIM_HUD.lifeGaugeTop);
  grad.addColorStop(split, SIM_HUD.lifeGaugeTop);
  grad.addColorStop(Math.min(1, split + 0.08), SIM_HUD.lifeGaugeBottom);
  grad.addColorStop(1, SIM_HUD.lifeGaugeBottom);
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

/** 生命恒满。用舞台的像素比例和坐标相位准备一次，避免播放中反复裁剪。 */
export function prepareSimLifeGauge(metrics: SimFieldMetrics, density: number): SimLifeGauge | undefined {
  if (typeof document === 'undefined') return;
  const rect = lifeGaugeRect(metrics.w / 1920);
  if (rect.w <= 1 || rect.h <= 1) return;
  const sx = Math.max(1, Math.round(metrics.w * density)) / metrics.w;
  const sy = Math.max(1, Math.round(metrics.h * density)) / metrics.h;
  const left = Math.floor(rect.x * sx);
  const top = Math.floor(rect.y * sy);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil((rect.x + rect.w) * sx) - left;
  canvas.height = Math.ceil((rect.y + rect.h) * sy) - top;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  ctx.setTransform(sx, 0, 0, sy, -left, -top);
  paintLifeGauge(ctx, rect);
  return { canvas, x: left / sx, y: top / sy, w: canvas.width / sx, h: canvas.height / sy };
}

function drawLife(ctx: CanvasRenderingContext2D, hud: SimHudAssets, s: number, prepared?: SimLifeGauge): void {
  const x = SIM_HUD.lifeX * s;
  const y = SIM_HUD.lifeY * s;
  const w = SIM_HUD.lifeW * s;
  const h = SIM_HUD.lifeH * s;
  const ky = h / HUD_SPRITES.lifeBar[3];
  if (!hud.lifeBar) {
    ctx.strokeStyle = 'rgba(255,255,255,.35)';
    ctx.lineWidth = 2 * s;
    roundRectPath(ctx, x, y, w, h, h * 0.2);
    ctx.stroke();
  } else {
    sliceX(ctx, hud.lifeBar, HUD_SPRITES.lifeBar, x, y, w, h, HUD_SPRITES.lifeSlices, ky);
  }

  if (prepared) {
    ctx.drawImage(prepared.canvas, prepared.x, prepared.y, prepared.w, prepared.h);
  } else {
    const rect = lifeGaugeRect(s);
    if (rect.w > 1 && rect.h > 1) paintLifeGauge(ctx, rect);
  }
  ctx.save();
  ctx.font = `800 ${SIM_HUD.lifeFont * s}px ${HEADER_SANS}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#3cb44a';
  ctx.fillText(`${LIFE_MAX}/${LIFE_MAX}`, x + w - 14 * ky, y + h * 0.79);
  ctx.restore();
}

/** 游戏内暂停钮：只作视觉，不接点击（实时预览仍用底部 PlayBar） */
function drawPause(ctx: CanvasRenderingContext2D, hud: SimHudAssets, s: number): void {
  if (!hud.rhythmGameUI) return;
  const p = HUD_SPRITES.pause;
  ctx.drawImage(
    hud.rhythmGameUI, p[0], p[1], p[2], p[3],
    SIM_HUD.pauseX * s, SIM_HUD.pauseY * s, SIM_HUD.pauseW * s, SIM_HUD.pauseH * s,
  );
}

/**
 * `AUTO LIVE` 胶囊（票 71）：用户自备 `hud/auto-live.png`（512×113，**已抠底**，
 * 原件的棋盘格灰底不能带进画面），落在 `(36, 142) 278×51`（1920 设计坐标；票 81 上移 8），
 * **只与 autoMode 挂钩**（整层还要 `showGameUi` 开）。缺件留空 —— 不画自造字样。
 */
function drawAutoLive(
  ctx: CanvasRenderingContext2D,
  m: SimFieldMetrics,
  assets: SimHudAssets,
  autoMode: boolean,
): void {
  if (!autoMode || !assets.autoLive) return;
  const s = m.w / 1920;
  const w = SIM_HUD.autoW * s;
  const h = (113 / 512) * w;
  ctx.drawImage(assets.autoLive, 0, 0, 512, 113,
    SIM_HUD.autoX * s, SIM_HUD.autoY * s, w, h);
}

/** 顶栏离屏层：画布跨帧复用，导出逐帧不重建（尺寸变了才重设） */
let topBarLayerCanvas: HTMLCanvasElement | null = null;

interface TopBarLayer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** 层内 1 用户单位 = `sx` × `sy` 设备像素（取自当前 CTM；实时舞台两轴可能不同） */
  sx: number;
  sy: number;
  /** 层左上角在**设备像素**里的位置（贴回时与入层时的相位一致） */
  ox: number;
  oy: number;
}

/** 顶栏四件在绘制坐标系（场地 CSS 坐标）里的包围盒；只铺这一块，不铺整帧 */
function topBarBounds(s: number): { x: number; y: number; w: number; h: number } {
  const rects: readonly (readonly [number, number, number, number])[] = [
    [SIM_HUD.boxX, SIM_HUD.boxY, SIM_HUD.boxW, SIM_HUD.boxH],
    [SIM_HUD.lifeX, SIM_HUD.lifeY, SIM_HUD.lifeW, SIM_HUD.lifeH],
    [SIM_HUD.pauseX, SIM_HUD.pauseY, SIM_HUD.pauseW, SIM_HUD.pauseH],
    [SIM_HUD.autoX, SIM_HUD.autoY, SIM_HUD.autoW, (113 / 512) * SIM_HUD.autoW],
  ];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y, w, h] of rects) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x + w);
    y1 = Math.max(y1, y + h);
  }
  const pad = 2;
  return {
    x: (x0 - pad) * s, y: (y0 - pad) * s,
    w: (x1 - x0 + pad * 2) * s, h: (y1 - y0 + pad * 2) * s,
  };
}

/**
 * 按当前 CTM 取一张与目标**设备像素栅格对齐**的顶栏离屏层。
 * 无 DOM（Node 测试）或 CTM 带旋转 / 斜切时返回 null，调用方退回旧的逐元件画法。
 */
function topBarLayerAt(ctx: CanvasRenderingContext2D, s: number): TopBarLayer | null {
  if (typeof document === 'undefined' || typeof ctx.getTransform !== 'function') return null;
  const t = ctx.getTransform();
  if (Math.abs(t.b) > 1e-6 || Math.abs(t.c) > 1e-6) return null;
  const sx = Number.isFinite(t.a) && t.a > 0 ? t.a : 1;
  const sy = Number.isFinite(t.d) && t.d > 0 ? t.d : 1;
  const r = topBarBounds(s);
  const ox = Math.floor(t.e + r.x * sx);
  const oy = Math.floor(t.f + r.y * sy);
  const w = Math.max(1, Math.ceil(t.e + (r.x + r.w) * sx) - ox);
  const h = Math.max(1, Math.ceil(t.f + (r.y + r.h) * sy) - oy);
  if (!topBarLayerCanvas) topBarLayerCanvas = document.createElement('canvas');
  if (topBarLayerCanvas.width !== w || topBarLayerCanvas.height !== h) {
    topBarLayerCanvas.width = w;
    topBarLayerCanvas.height = h;
  }
  const g = topBarLayerCanvas.getContext('2d');
  if (!g) return null;
  return { canvas: topBarLayerCanvas, ctx: g, sx, sy, ox, oy };
}

/**
 * 打歌 HUD 顶栏（票 72）：整层由 `showGameUi` 收放；顺序 = 分数框 → 生命 → 暂停钮 → AUTO LIVE。
 *
 * 票 76：`alpha` 是整层淡入 / 淡出倍率。**半透明必须整层合成**（原型 `drawSimHud` 同一条
 * 路径）：这层里到处都是重叠 —— 4 切片接缝两侧各留 1px bleed、字母 / 数字 / 填充叠在卡上、
 * SS+ 星点用 `lighter`。若直接在外层设 `globalAlpha` 逐块画，重叠处会被合成两遍，接缝那条
 * 2px 的重叠带在半透明时就浮成一条比周围更亮的白线（成片淡入段的"白线"，2026-11-22 回修）。
 * 所以 alpha < 1 时先按 alpha=1 画进离屏层、再整层一次贴回；alpha = 1（实时回放常态、
 * 导出常驻段）仍旧直画，既不多开画布也不多一次合成。
 */
function drawTopBar(
  ctx: CanvasRenderingContext2D,
  m: SimFieldMetrics,
  chart: SimChart,
  seconds: number,
  assets: SimHudAssets,
  autoMode: boolean,
  alpha: number = 1,
  flowSeconds: number = seconds,
  lifeGauge?: SimLifeGauge,
): void {
  const hud = assets ?? EMPTY_HUD;
  const s = m.w / 1920;
  const layerAlpha = clamp01(alpha);
  if (layerAlpha <= 0.002) return;
  const score = scoreAt(chart, seconds);
  const inc = scoreIncrement(chart.hitTimes.length);
  const ages = plusAgesAt(chart, seconds, SIM_HUD.plusDur);
  if (layerAlpha >= 0.999) {
    drawTopBarParts(ctx, m, hud, s, flowSeconds, score, inc, ages, 1, lifeGauge, autoMode);
    return;
  }
  const layer = topBarLayerAt(ctx, s);
  if (!layer) {
    // 兜底：没有离屏画布可用 ⇒ 仍是旧的逐元件半透明（观感一致，只留接缝白线的老问题）
    drawTopBarParts(ctx, m, hud, s, flowSeconds, score, inc, ages, layerAlpha, lifeGauge, autoMode);
    return;
  }
  const g = layer.ctx;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
  g.setTransform(layer.sx, 0, 0, layer.sy, -layer.ox, -layer.oy);
  drawTopBarParts(g, m, hud, s, flowSeconds, score, inc, ages, 1, lifeGauge, autoMode);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = layerAlpha;
  ctx.drawImage(layer.canvas, layer.ox, layer.oy);
  ctx.restore();
}

/** 顶栏本体（顺序 = 分数框 → 生命 → 暂停钮 → AUTO LIVE）；`alpha` 是**层内**倍率 */
function drawTopBarParts(
  ctx: CanvasRenderingContext2D,
  m: SimFieldMetrics,
  hud: SimHudAssets,
  s: number,
  flowSeconds: number,
  score: number,
  inc: number,
  ages: number[],
  alpha: number,
  lifeGauge: SimLifeGauge | undefined,
  autoMode: boolean,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textBaseline = 'middle';
  drawScoreBox(ctx, hud, s, flowSeconds, score, inc, ages, alpha);
  drawLife(ctx, hud, s, lifeGauge);
  drawPause(ctx, hud, s);
  drawAutoLive(ctx, m, hud, autoMode);
  ctx.restore();
}

/**
 * 判定字（chart-preview 51 / 71）：每音一条、**位置固定**在场中央（0.497W × 判定线上 0.10H）。
 *
 * - AUTO 开 = `judge_auto`、关 = `judge_perfect`（只有两档，不接漏判档）；
 * - 缺 `judgeskin` ⇒ **纯字**（Q12：留空或纯字，不画假徽章）；
 * - `stacked`（上一字还没消失又打中）不重新淡入，避免每音"灭一下再亮"。
 */
function drawJudgement(
  ctx: CanvasRenderingContext2D,
  m: SimFieldMetrics,
  chart: SimChart,
  seconds: number,
  judge: HTMLImageElement | null,
  auto: boolean,
  style?: Partial<SimJudgeStyle>,
): void {
  const js: SimJudgeStyle = { ...SIM_JUDGE, ...style };
  const state = judgeStateAt(chart, seconds, js.life);
  if (!state) return;
  const { age, stacked } = state;
  const fadeOutA = clamp01((js.life - age) / Math.max(0.01, js.fadeOut));
  // 叠字（上一个还没消失就又打中）⇒ 不再淡入：满强度、只重新弹一下
  const fadeInA = stacked || js.fadeIn <= 0 ? 1 : Math.min(1, age / js.fadeIn);
  const alpha = fadeInA * fadeOutA;
  if (alpha <= 0.002) return;

  // 命中瞬间"弹一下"（与 combo 的 `pop` 同一条曲线）：0.8 → 1.1 → 1
  const pop = js.pop > 0 ? comboPopScale(age) : 1;
  const h = m.h * js.h * pop;
  const cx = m.w * js.cx;
  const cy = m.laneHeight - m.h * js.dy;

  ctx.save();
  ctx.globalAlpha = alpha;
  if (judge) {
    const box = judgeSprite(auto);
    const w = (h * box.w) / box.h;
    ctx.drawImage(judge, box.x, box.y, box.w, box.h, cx - w / 2, cy - h / 2, w, h);
  } else {
    // 缺判定图集（常态：素材不在安装包里）⇒ 纯字：位置 / 高度与图版同一框
    ctx.font = `800 ${h * 0.84}px ${SIM_HUD_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${(h * 0.05).toFixed(2)}px`;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = h * 0.18;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(auto ? 'AUTO' : 'PERFECT', cx, cy);
    (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '0px';
  }
  ctx.restore();
}

/**
 * combo 样式（chart-preview 52，按 `.cache/Combo-Style.mov` 逐帧重做）。
 *
 * 实机 AP 续航态长这样（不是"渐变字 + 白描边"）：
 *   - 字**芯是白的**；
 *   - 外边一圈**竖向渐变的描边**：上洋红 `#e35bd2` → 中紫 `#a163d8` → 下青 `#3fc9c7`；
 *   - 描边外是**同色的柔光**，并且**会脉动**（录屏里约 0.5 s 一个周期）；
 *   - 下面的「COMBO」也吃同一套描边 + 光晕（不是白字）。
 *
 * 非 AP 就是游戏常态：纯白数字 + 白字 COMBO，不发光。
 */
export interface SimComboStyle {
  /** 是否处在 AP（ALL PERFECT）续航态 */
  ap: boolean;
  /** 命中弹跳时长（秒；0 = 不弹） */
  pop: number;
  /** 数字高倍率（1 = `comboMetrics` 的 0.125H） */
  scale: number;
  /** 相对默认锚点（`0.85W × 0.4375H`）的偏移（场地 px） */
  dx: number;
  dy: number;
  /** 光晕强度倍率（0 = 不发光） */
  glow: number;
  /** 光晕脉动周期（秒；0 = 常亮不脉动） */
  glowPeriod: number;
}

/** combo 默认档：实机 AP 态 */
export const SIM_COMBO_STYLE: SimComboStyle = {
  ap: true,
  pop: 0.2,
  scale: 1,
  dx: 0,
  dy: 0,
  glow: 1,
  glowPeriod: 1,
};

/** 实机采样色（`.cache/Combo-Style.mov`，1920×1342 逐帧取平均） */
const AP_STROKE = { top: '#e35bd2', mid: '#a163d8', bottom: '#3fc9c7' } as const;

/** 描边/白芯瓦片缓存：精灵 → `切图|尺寸` → 画好的瓦片 */
const apTileCache = new WeakMap<CanvasImageSource, Map<string, HTMLCanvasElement>>();
/** 光晕瓦片缓存：同上，单独一张（太糊了不跟主体共用） */
const glowTileCache = new WeakMap<CanvasImageSource, Map<string, HTMLCanvasElement>>();
/** 每字「墨迹」在切图里的左右边（按 alpha 量一次）—— 居中要靠它，不能按字宽 */
const inkCache = new WeakMap<CanvasImageSource, Map<string, { left: number; right: number }>>();

interface ComboShadowTile {
  canvas: HTMLCanvasElement;
  pad: number;
  density: number;
}

interface SimComboShadows {
  normal: ComboShadowTile | null;
  ap: ComboShadowTile | null;
}

// 每张标签源图只保留最近一次准备的尺寸。播放中的舞台持有自己的贴图，
// 另一舞台或尺寸变化可准备新贴图，不会让现有舞台在出帧时重建。
const comboShadowCache = new WeakMap<HTMLImageElement, { key: string; shadows: SimComboShadows }>();

function makeComboShadow(
  img: CanvasImageSource, w: number, h: number, blur: number, density: number,
): ComboShadowTile | null {
  const pad = Math.ceil(blur * 1.6);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w * density) + pad * 2;
  canvas.height = Math.ceil(h * density) + pad * 2;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  if (!g) return null;
  // 标签本体画在画布外，留在贴图里的只有阴影。2D 的 shadowBlur 以位图像素计。
  const offset = canvas.width * 2;
  g.shadowOffsetX = -offset;
  g.shadowColor = 'rgba(0,0,0,0.5)';
  g.shadowBlur = blur;
  g.drawImage(img, pad + offset, pad, w * density, h * density);
  return { canvas, pad, density };
}

function tileKey(rect: { sx: number; sy: number; sw: number; sh: number }, tw: number, th: number): string {
  return `${rect.sx},${rect.sy},${rect.sw},${rect.sh}|${tw}x${th}`;
}

/** 量一格切图里字形的墨迹左右边（alpha > 24），按切图源 px 返回 */
function glyphInk(
  img: CanvasImageSource,
  rect: { sx: number; sy: number; sw: number; sh: number },
): { left: number; right: number } | null {
  if (typeof document === 'undefined') return null;
  let map = inkCache.get(img);
  if (!map) {
    map = new Map();
    inkCache.set(img, map);
  }
  const key = `${rect.sx},${rect.sy},${rect.sw},${rect.sh}`;
  const hit = map.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(rect.sw));
  canvas.height = Math.max(1, Math.round(rect.sh));
  const g = canvas.getContext('2d', { willReadFrequently: true });
  if (!g) return null;
  g.drawImage(img, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, canvas.width, canvas.height);
  const { data } = g.getImageData(0, 0, canvas.width, canvas.height);
  let left = canvas.width;
  let right = -1;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      if (data[(y * canvas.width + x) * 4 + 3] > 24) {
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }
  const box = right < 0 ? { left: 0, right: canvas.width - 1 } : { left, right };
  map.set(key, box);
  return box;
}

/**
 * 白芯 + 竖向渐变描边的字形瓦片（四周扩 `pad`）。
 * 描边 = 白色剪影按圆周铺 8 次（扩张）再挖掉原字形；颜色用 `source-in` 灌竖向渐变。
 */
function apTile(
  img: CanvasImageSource,
  rect: { sx: number; sy: number; sw: number; sh: number },
  w: number,
  h: number,
  /** 描边粗细（字高的比例） */
  strokeRatio = 0.065,
): { canvas: HTMLCanvasElement; pad: number } | null {
  if (typeof document === 'undefined') return null;
  const tw = Math.max(1, Math.round(w));
  const th = Math.max(1, Math.round(h));
  const key = `${tileKey(rect, tw, th)}|${strokeRatio}`;
  let map = apTileCache.get(img);
  if (!map) {
    map = new Map();
    apTileCache.set(img, map);
  }
  const pad = Math.max(2, Math.round(th * strokeRatio));
  const hit = map.get(key);
  if (hit) return { canvas: hit, pad };

  const white = document.createElement('canvas');
  white.width = tw;
  white.height = th;
  const wg = white.getContext('2d');
  const out = document.createElement('canvas');
  out.width = tw + pad * 2;
  out.height = th + pad * 2;
  const g = out.getContext('2d');
  if (!wg || !g) return null;
  wg.drawImage(img, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, tw, th);

  const spread = Math.max(1, Math.round(pad / 1.6));
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2;
    g.drawImage(white, pad + Math.cos(ang) * spread, pad + Math.sin(ang) * spread);
  }
  g.globalCompositeOperation = 'destination-out';
  g.drawImage(white, pad, pad);
  g.globalCompositeOperation = 'source-in';
  const grad = g.createLinearGradient(0, 0, 0, out.height);
  grad.addColorStop(0, AP_STROKE.top);
  grad.addColorStop(0.45, AP_STROKE.mid);
  grad.addColorStop(1, AP_STROKE.bottom);
  g.fillStyle = grad;
  g.fillRect(0, 0, out.width, out.height);
  // 白芯压回中间
  g.globalCompositeOperation = 'source-over';
  g.drawImage(white, pad, pad);
  map.set(key, out);
  return { canvas: out, pad };
}

/**
 * 光晕瓦片：把字形**按边缘糊开**再灌渐变 —— 不是中心一团圆光，
 * 而是从笔画边缘向内外渗透，叠在主体后面就有"呼吸"感（用户 2026-10-27 第 2 轮）。
 */
function glowTile(
  img: CanvasImageSource,
  rect: { sx: number; sy: number; sw: number; sh: number },
  w: number,
  h: number,
  /** 糊开的半径（字高的比例） */
  blurRatio = 0.09,
): { canvas: HTMLCanvasElement; pad: number } | null {
  if (typeof document === 'undefined') return null;
  const tw = Math.max(1, Math.round(w));
  const th = Math.max(1, Math.round(h));
  const key = `${tileKey(rect, tw, th)}|${blurRatio}`;
  let map = glowTileCache.get(img);
  if (!map) {
    map = new Map();
    glowTileCache.set(img, map);
  }
  const pad = Math.max(4, Math.round(th * 0.42));
  const hit = map.get(key);
  if (hit) return { canvas: hit, pad };

  const out = document.createElement('canvas');
  out.width = tw + pad * 2;
  out.height = th + pad * 2;
  const g = out.getContext('2d');
  if (!g) return null;
  // 先按字形铺白，再用画布滤镜糊开 —— 糊的是**字形的轮廓**，不是圆心
  g.filter = `blur(${Math.max(2, th * blurRatio).toFixed(1)}px)`;
  g.drawImage(img, rect.sx, rect.sy, rect.sw, rect.sh, pad, pad, tw, th);
  g.filter = 'none';
  g.globalCompositeOperation = 'source-in';
  const grad = g.createLinearGradient(0, 0, 0, out.height);
  grad.addColorStop(0, AP_STROKE.top);
  grad.addColorStop(0.45, AP_STROKE.mid);
  grad.addColorStop(1, AP_STROKE.bottom);
  g.fillStyle = grad;
  g.fillRect(0, 0, out.width, out.height);
  map.set(key, out);
  return { canvas: out, pad };
}

/**
 * 实时回放接入新素材 / 场地尺寸时准备全部 combo 字形（issue 80）。
 * 不依赖当前秒或 AP 开关：seek 到未见数字、播放中打开 AP 都不能触发墨迹回读 / 瓦片新建。
 * 与出帧共用缓存及尺寸真源；离线导出仍可按需生成，不增加逐帧工作。
 */
export function prepareSimComboSprites(
  m: SimFieldMetrics, sprites: SimSprites | null, density: number,
): SimComboShadows | undefined {
  if (!sprites) return;
  const { digitW, digitH, labelW, labelH } = comboMetrics(m);
  for (let digit = 0; digit < 10; digit++) {
    const rect = digitRect(sprites, digit);
    glyphInk(sprites.digits, rect);
    apTile(sprites.digits, rect, digitW, digitH);
    glowTile(sprites.digits, rect, digitW, digitH);
  }
  const label = { sx: 0, sy: 0, sw: sprites.combo.width, sh: sprites.combo.height };
  const ap = apTile(sprites.combo, label, labelW, labelH, 0.045);
  glowTile(sprites.combo, label, labelW, labelH, 0.08);
  if (typeof document === 'undefined') return;
  const key = `${labelH}|${density}`;
  const cached = comboShadowCache.get(sprites.combo);
  if (cached?.key === key) return cached.shadows;
  const blur = labelH * 0.35;
  const shadows = {
    normal: makeComboShadow(sprites.combo, labelW, labelH, blur, density),
    ap: ap && makeComboShadow(ap.canvas, labelW + ap.pad * 2, labelH + ap.pad * 2, blur, density),
  };
  comboShadowCache.set(sprites.combo, { key, shadows });
  return shadows;
}

/**
 * HUD：combo（chart-preview 21 起）—— 有 Bestdori 精灵走 `digits.png` + `combo.png`，
 * 缺精灵退回自绘文本。
 */
function drawCombo(
  ctx: CanvasRenderingContext2D,
  m: SimFieldMetrics,
  chart: SimChart,
  seconds: number,
  sprites: SimSprites | null,
  alpha = 1,
  style?: Partial<SimComboStyle>,
  shadows?: SimComboShadows,
): void {
  if (alpha <= 0.002) return;
  const combo = simComboAt(chart, seconds);
  if (combo <= 0) return;
  const cs: SimComboStyle = { ...SIM_COMBO_STYLE, ...style };
  const anchor = comboAnchor(m);
  const x = anchor.x + cs.dx;
  const y = anchor.y + cs.dy;
  const since = Math.max(0, seconds - (chart.hitTimes[combo - 1] ?? seconds));
  const popScale = cs.pop > 0 ? comboPopScale(since * (0.2 / cs.pop)) : 1;
  const scale = popScale * cs.scale;
  const text = String(combo);

  if (!sprites) {
    drawComboText(ctx, m, text, alpha, cs, x, y);
    return;
  }

  const { digitW, digitH, labelW, labelH, labelGap } = comboMetrics(m);
  const dw = digitW * scale;
  const dh = digitH * scale;
  const top = y - dh / 2;
  // 居中按**墨迹**：每个字形在切图里的左右留白不一样（"1" 只占 39/72），
  // 按字宽居中在 2 位以上就会偏 —— 先量出整串的墨迹跨度，再把它对到锚点上。
  const cells = [...text].map((ch) => {
    const digit = Math.min(9, Math.max(0, Number(ch) || 0));
    const rect = digitRect(sprites, digit);
    const ink = glyphInk(sprites.digits, rect);
    const k = digitW / Math.max(1, rect.sw);
    return { rect, inkLeft: ink ? ink.left * k : 0, inkRight: ink ? ink.right * k : digitW };
  });
  const first = cells[0];
  const last = cells[cells.length - 1];
  const inkSpanLeft = (-cells.length / 2) * digitW + (first ? first.inkLeft : 0);
  const inkSpanRight =
    ((-cells.length / 2) + (cells.length - 1)) * digitW + (last ? last.inkRight : digitW);
  const inkShift = -(inkSpanLeft + inkSpanRight) / 2;

  const labelLeft = x - (labelW * scale) / 2;
  const labelTop = y + labelGap * scale;
  const labelRect = { sx: 0, sy: 0, sw: sprites.combo.width, sh: sprites.combo.height };

  ctx.save();
  ctx.globalAlpha = alpha;
  const mod = cs.ap ? apGlowModulation(seconds, since, cs) : { alpha: 0, scale: 1 };
  /**
   * 铺光晕。**数字和「COMBO」一起铺** —— 上一版只给了数字，标签只有描边没有呼吸
   * （用户 2026-10-27：下面那行没有光晕）。
   */
  const glowPass = (mode: 'behind' | 'front', repeats: number) => {
    if (mod.alpha <= 0.004) return;
    const k = scale * mod.scale;
    ctx.save();
    // 走加色：光晕是"发光"，不是盖一层半透明色块
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha * mod.alpha * (mode === 'front' ? 0.2 : 0.62);
    for (let i = 0; i < repeats; i++) {
      let gx = (-cells.length / 2) * digitW + inkShift;
      for (const cell of cells) {
        const glow = glowTile(sprites.digits, cell.rect, digitW, digitH);
        if (glow) {
          const padPx = glow.pad * k;
          ctx.drawImage(
            glow.canvas,
            x + gx * scale - padPx, top - padPx,
            dw * mod.scale + padPx * 2, dh * mod.scale + padPx * 2,
          );
        }
        gx += digitW;
      }
      const labelGlow = glowTile(sprites.combo, labelRect, labelW, labelH, 0.08);
      if (labelGlow) {
        const padPx = labelGlow.pad * k;
        ctx.drawImage(
          labelGlow.canvas,
          labelLeft - padPx, labelTop - padPx,
          labelW * scale * mod.scale + padPx * 2, labelH * scale * mod.scale + padPx * 2,
        );
      }
    }
    ctx.restore();
  };
  glowPass('behind', 2);

  let dx = (-cells.length / 2) * digitW + inkShift;
  for (const cell of cells) {
    const left = x + dx * scale;
    const tile = cs.ap ? apTile(sprites.digits, cell.rect, digitW, digitH) : null;
    if (tile) {
      const padPx = tile.pad * scale;
      ctx.drawImage(tile.canvas, left - padPx, top - padPx, dw + padPx * 2, dh + padPx * 2);
    } else {
      ctx.drawImage(
        sprites.digits, cell.rect.sx, cell.rect.sy, cell.rect.sw, cell.rect.sh,
        left, top, dw, dh,
      );
    }
    dx += digitW;
  }
  glowPass('front', 1);

  const labelTile = cs.ap ? apTile(sprites.combo, labelRect, labelW, labelH, 0.045) : null;
  const padPx = (labelTile?.pad ?? 0) * scale;
  const shadow = labelTile ? shadows?.ap : shadows?.normal;
  const left = labelLeft - padPx;
  const topPx = labelTop - padPx;
  if (shadow) {
    const k = scale / shadow.density;
    ctx.drawImage(shadow.canvas, left - shadow.pad * k, topPx - shadow.pad * k,
      shadow.canvas.width * k, shadow.canvas.height * k);
  } else {
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = labelH * 0.35;
  }
  if (labelTile) {
    ctx.drawImage(
      labelTile.canvas,
      left, topPx,
      labelW * scale + padPx * 2, labelH * scale + padPx * 2,
    );
  } else {
    ctx.drawImage(
      sprites.combo, 0, 0, sprites.combo.width, sprites.combo.height,
      labelLeft, labelTop, labelW * scale, labelH * scale,
    );
  }
  ctx.restore();
}

/**
 * AP 态光晕的**呼吸**：形状由 `glowTile` 决定（沿笔画边缘糊开），这里只给强度与尺度。
 *
 * - 相位走**绝对秒**（不是命中后计时）：不然每来一个音就把呼吸打断，看起来是一闪一闪而不是"呼吸"；
 * - 深度调满：谷底几乎熄、峰顶压满，才看得出来（用户 2026-10-27 第 3 轮：太弱、看不出呼吸）；
 * - 命中那一拍再叠一次快速闪，`flash` 0.12 s 衰减。
 */
function apGlowModulation(
  seconds: number,
  since: number,
  cs: SimComboStyle,
): { alpha: number; scale: number } {
  if (cs.glow <= 0.01) return { alpha: 0, scale: 1 };
  const period = cs.glowPeriod > 0 ? cs.glowPeriod : 0;
  const phase = period > 0 ? 0.5 - 0.5 * Math.cos((seconds / period) * Math.PI * 2) : 0.75;
  const flash = Math.exp(-since / 0.12);
  const alpha = clamp01((0.14 + 0.95 * phase) * cs.glow + 0.4 * flash * cs.glow);
  // 峰顶连"光晕范围"一起涨一点，才像在呼吸而不是单纯调亮度
  return { alpha, scale: 1 + 0.06 * phase };
}

/**
 * combo 的自绘文本回落（缺 Bestdori 精灵时）：`ap` = 白字 + 渐变描边 + 柔光；
 * 非 AP = 纯白。位置与精灵版同一锚点。
 */
function drawComboText(
  ctx: CanvasRenderingContext2D,
  m: SimFieldMetrics,
  text: string,
  alpha: number,
  cs: SimComboStyle,
  x: number,
  y: number,
): void {
  const fontSize = comboAnchor(m).fontSize * cs.scale;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.font = `800 ${fontSize.toFixed(1)}px ${SIM_HUD_FONT}`;
  if (cs.ap) {
    const grad = ctx.createLinearGradient(0, y - fontSize * 0.5, 0, y + fontSize * 0.5);
    grad.addColorStop(0, AP_STROKE.top);
    grad.addColorStop(0.45, AP_STROKE.mid);
    grad.addColorStop(1, AP_STROKE.bottom);
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2, fontSize * 0.16);
    ctx.strokeStyle = grad;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, x, y);
  } else {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = fontSize * 0.2;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, x, y);
  }
  ctx.font = `700 ${(fontSize * 0.3).toFixed(1)}px ${SIM_HUD_FONT}`;
  if (cs.ap) {
    const g2 = ctx.createLinearGradient(0, y + fontSize * 0.5, 0, y + fontSize * 0.9);
    g2.addColorStop(0, AP_STROKE.mid);
    g2.addColorStop(1, AP_STROKE.bottom);
    ctx.lineWidth = Math.max(1.5, fontSize * 0.07);
    ctx.strokeStyle = g2;
    ctx.strokeText('COMBO', x, y + fontSize * 0.72);
  }
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = alpha * 0.95;
  ctx.fillText('COMBO', x, y + fontSize * 0.72);
  ctx.restore();
}
