// 仿真场的几何与接近模型（ADR-0016 §1.2；CONTEXT「仿真场 / 设计面 / 接近模型」）。
//
// **纯函数模块**（node 环境可单测）：一帧绘制（`simField`）与实时回放（`simPlayback`）都只从这里
// 取坐标与参数，不各自再算一遍。口径来源 = Bestdori `MySongSimulator`（research 笔记 §1.2）：
//
//   设计面        1334 × 750（游戏原生比例）
//   laneWidth     154 × W/1334         laneHeight 0.82 × H
//   坐标          原点 (W/2, 0)；y = 1 即场地判定线；元素画在 "A 倍缩放的场地坐标系" 里
//   接近模型      A = 0.05 + 0.95 × 1.1^(50·Δ/T)，T = (12 − noteSpeed)/2 秒
//
// 伪透视的实现 = **同一个 A 同时缩放 x 与 y**：A 越小（越远的将来）元素越靠上、越靠中、越小。
// 轨道本身是竖直平行的，没有任何梯形变换（照参照实现）。
//
// 本模块只依赖零 import 的尺寸叶子模块与设置白名单常量，不碰 DOM / canvas。
import { NOTE_SKIN_GEOMETRY } from '../../../rendering/skin/noteSkin';
import { normalizeNoteSpeed } from '../../../chart/config/AppSettings';
import { TOTAL_LANES, mirrorLane as mirrorLaneOf } from '../../../chart/editing/NoteEditing';
import type { KeySoundKind } from '../../../audio/KeySound';

/** 设计面：仿真场的基准坐标系（CONTEXT「设计面」；游戏原生比例 1334×750） */
export const DESIGN_SURFACE = { w: 1334, h: 750 } as const;
/** 设计面宽 1334 时每 lane 占 154 px：任意宽度下 `laneWidth = 154 × W/1334` */
export const LANE_DESIGN_W = 154;
/** 场地判定线在设计面高上的比例：`laneHeight = 0.82 × H`（CONTEXT「场地判定线」） */
export const LANE_HEIGHT_RATIO = 0.82;
/** 轨道数：与编辑器同一批 `0..6`（lane 越界照实画到轨道外，照 ADR-0014 的投影口径） */
export const SIM_LANES = TOTAL_LANES;
/** 设计坐标原点所在的 lane：x = (lane − 3) 个 lane 宽（lane 3 = 正中） */
export const SIM_CENTER_LANE = 3;

/**
 * 接近模型常量（CONTEXT「接近模型」）：`A = floor + range × base^(exp · Δ/T)`。
 * `A(Δ=0) = 1`（正好在场地判定线上）；`A → 0.05` 是 Δ → −∞ 的渐近值，
 * Δ = −T 时 A ≈ 0.058 —— 故**渲染窗口取 Δ ∈ [−T, 0]**，再远就只剩渐近值、视觉上等于没来。
 */
export const APPROACH = { floor: 0.05, range: 0.95, base: 1.1, exp: 50 } as const;

/**
 * 场地画面的尺寸钳制（窄 / 宽比例下的同一个 contain 公式 + 上下界）：
 * - 舞台很窄时不低于 `min`（否则 7 轨压成一条线，读不出任何东西）；
 * - 舞台很大时不超过 `max`：位图 = 尺寸 × 密度，2560 是"够大"与"位图预算"的折中
 *   （dpr 2 → 5120×2880 ≈ 14.7M px ≈ 59 MB；逐帧直绘的画布，这个量级可接受）。
 *   chart-preview 19 定案（用户 2026-10-07）：保持 contain、接受两侧留白，但把画面做大 ——
 *   原来 1920 的钳制在 2560 / 3440 宽的窗口上会让场地（1920×1079）只有舞台的 78% / 56% 宽。
 */
export const SIM_FIELD_LIMITS = { minW: 320, maxW: 2560 } as const;

/** 场地几何（一帧绘制只读它；尺寸变了才重算） */
export interface SimFieldMetrics {
  /** 场地画面宽（CSS px） */
  w: number;
  /** 场地画面高（CSS px） */
  h: number;
  /** 每 lane 宽（CSS px，场地判定线处）= 154 × w/1334 */
  laneWidth: number;
  /** 场地判定线的 y（CSS px）= 0.82 × h */
  laneHeight: number;
  /** 设计坐标 x = 0 的屏幕 x（= w/2） */
  centerX: number;
}

/** 由场地尺寸算出几何（设计面比例只在这里落一次） */
export function fieldMetrics(w: number, h: number): SimFieldMetrics {
  const width = Math.max(1, w);
  const height = Math.max(1, h);
  return {
    w: width,
    h: height,
    laneWidth: LANE_DESIGN_W * (width / DESIGN_SURFACE.w),
    laneHeight: LANE_HEIGHT_RATIO * height,
    centerX: width / 2,
  };
}

/**
 * 把设计面 **contain** 进舞台并钳制宽度：宽 / 窄比例下都保住 1334:750，
 * 不改设计面比例（那是伪透视的基准），剩余空间留给页面底色。
 */
export function fitDesignSurface(containerW: number, containerH: number): SimFieldMetrics {
  const ratio = DESIGN_SURFACE.w / DESIGN_SURFACE.h;
  const cw = Number.isFinite(containerW) ? Math.max(0, containerW) : 0;
  const ch = Number.isFinite(containerH) ? Math.max(0, containerH) : 0;
  // contain：先按宽铺，超出高就改按高铺
  let w = cw;
  let h = cw / ratio;
  if (h > ch) {
    h = ch;
    w = ch * ratio;
  }
  w = Math.min(SIM_FIELD_LIMITS.maxW, Math.max(SIM_FIELD_LIMITS.minW, Math.round(w)));
  return fieldMetrics(w, Math.round(w / ratio));
}

// ---------------------------------------------------------------- 场地三图的绘制矩形

/**
 * 场地三图的绘制矩形（**照 Bestdori 的 DOM `<img>` 尺寸**；chart-preview 18 问题 4）。
 *
 * 两张图都是"**设计 px 1:1**"标尺 —— 素材自带的轨道标记（判定线 7 个）与车道线因此正好
 * 落在音符的 lane 中心（实测误差 < 1%）。**别再拉伸到画布尺寸**（那会让标记 / 车道线
 * 与音符错位：曾把标记间距压成 124.7 CSS px，而 lane 宽是 168.2）：
 *   - 场地图 1160×610：宽 `0.875W`、高 `0.82H × 0.983`，水平居中、**底边贴场地判定线**；
 *   - 判定线 1800×38：宽 `1.35W`（1334 × 1.35 = 1800），高按素材比例 `38/1800`，
 *     上下居中于判定线，左右**故意超出画布**（照素材的自然宽度）。
 */
export const FIELD_IMAGE_RATIO = { w: 0.875, h: 0.82 * 0.983 } as const;
export const PLAY_LINE_RATIO = { w: 1.35 } as const;
export const PLAY_LINE_ASPECT = 38 / 1800;

/** 画布上的一个矩形（CSS px） */
export interface SimRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 场地图的绘制矩形：水平居中、底边贴场地判定线 */
export function fieldImageRect(m: SimFieldMetrics): SimRect {
  const w = FIELD_IMAGE_RATIO.w * m.w;
  const h = FIELD_IMAGE_RATIO.h * m.h;
  return { x: m.centerX - w / 2, y: m.laneHeight - h, w, h };
}

/** 判定线的绘制矩形：上下居中于场地判定线，左右超出画布两侧 */
export function playLineRect(m: SimFieldMetrics): SimRect {
  const w = PLAY_LINE_RATIO.w * m.w;
  const h = Math.max(1, w * PLAY_LINE_ASPECT);
  return { x: m.centerX - w / 2, y: m.laneHeight - h / 2, w, h };
}

// ---------------------------------------------------------------- 接近模型

/**
 * 音符速度档 → 接近时长 T（秒）：`T = (12 − noteSpeed)/2`。
 * 档位 1..11 → 5.5s..0.5s（照票面；12 是模型自己的退化端点，不入白名单）。
 */
export function approachSeconds(noteSpeed: number): number {
  return (12 - normalizeNoteSpeed(noteSpeed)) / 2;
}

// 档位归一化直接用设置域那一份（白名单与步长只有一个来源，仿真场不另立）

/** 接近值 A（Δ = t_now − t_note，秒；T = approachSeconds(noteSpeed)） */
export function approachA(deltaSeconds: number, approachS: number): number {
  const t = approachS > 0 ? approachS : Number.EPSILON;
  return APPROACH.floor + APPROACH.range * APPROACH.base ** ((APPROACH.exp * deltaSeconds) / t);
}

/** `approachA` 的常用形态：直接给两个时刻 */
export function approachOf(nowSeconds: number, noteSeconds: number, approachS: number): number {
  return approachA(nowSeconds - noteSeconds, approachS);
}

/**
 * 带体端点的 A 钳制：带子可能一端已过线 / 一端还没进场（Δ 落在窗口外），
 * 把它钉在 [floor, 1] 上 —— 过线的一端钉在场地判定线上，没进场的一端钉在渐近位置。
 * （元素本身不钳制：过线的音符直接不画，见 `simField` 的窗口剔除。）
 */
export function clampApproach(a: number): number {
  return Math.min(1, Math.max(APPROACH.floor, a));
}

/** 该元素是否落在渲染窗口内（Δ ∈ [−T, 0]）；返回 A 或 null */
export function visibleApproach(nowSeconds: number, noteSeconds: number, approachS: number): number | null {
  const delta = nowSeconds - noteSeconds;
  if (delta > 0 || delta < -approachS) return null;
  return approachA(delta, approachS);
}

// ---------------------------------------------------------------- 场地坐标

/** 设计坐标 x：`(lane − 3)` 个 lane 宽（原点在正中轨） */
export function laneOffsetDesign(lane: number): number {
  return lane - SIM_CENTER_LANE;
}

/**
 * 镜向：整轨水平镜像（lane 对调，照 Bestdori `styleMirror` / `settings.preview.mirror`）。
 * 车道对调本身**不另立一份** —— 用编辑器那份 `mirrorLane`（`NoteEditing`，那边是三条调用点的唯一实现）；
 * 本函数只是加上"要不要镜像"这个开关。
 */
export function mirrorLane(lane: number, mirror: boolean): number {
  return mirror ? mirrorLaneOf(lane) : lane;
}

/** lane 中心的屏幕 x（该元素的接近值为 A） */
export function laneCenterX(m: SimFieldMetrics, lane: number, a: number): number {
  return m.centerX + laneOffsetDesign(lane) * m.laneWidth * a;
}

/** 接近值 A 对应的屏幕 y（A = 1 即场地判定线） */
export function fieldY(m: SimFieldMetrics, a: number): number {
  return m.laneHeight * a;
}

/** 场地上的一个点（CSS px） */
export interface SimPoint {
  x: number;
  y: number;
}

/** 带体端点（相邻结点的 `(lane, A)` 两点） */
export interface SimBandEnd {
  lane: number;
  a: number;
}

/**
 * 带体四边形：相邻结点两点构成的四边形，顶点顺序 = **a 边左 → a 边右 → b 边右 → b 边左**。
 * 边宽恒 = 1 个 lane（随端点自己的 A 收缩 → 伪透视下越远的带越窄）。
 * 注意倒流区里 `b` 的时间可以**早于** `a`（谱面折返），四边形照样成形（只是上下关系反过来）——
 * 折返带由调用方按 `displayConnections` 的显示序喂进来，本函数不做任何"排序修正"。
 */
export function bandQuad(m: SimFieldMetrics, a: SimBandEnd, b: SimBandEnd): [SimPoint, SimPoint, SimPoint, SimPoint] {
  const ax = laneCenterX(m, a.lane, a.a);
  const bx = laneCenterX(m, b.lane, b.a);
  const ah = (m.laneWidth * a.a) / 2;
  const bh = (m.laneWidth * b.a) / 2;
  return [
    { x: ax - ah, y: fieldY(m, a.a) },
    { x: ax + ah, y: fieldY(m, a.a) },
    { x: bx + bh, y: fieldY(m, b.a) },
    { x: bx - bh, y: fieldY(m, b.a) },
  ];
}

/** 元素在场地上的中心点 */
export function elementPoint(m: SimFieldMetrics, lane: number, a: number): SimPoint {
  return { x: laneCenterX(m, lane, a), y: fieldY(m, a) };
}

// ---------------------------------------------------------------- 音符尺寸

/**
 * 音符绘制宽度（CSS px）= `1.35 × noteSize × laneWidth × A`（照 Bestdori `a = 1.35 × styleNoteSize`，
 * 票面「音符」一行）。**一份基准缩放**同时服务三类音符：精灵的设计尺寸按
 * `NOTE_SKIN_GEOMETRY.MAIN_W` 折算，于是方向键（设计宽 45）自然比单键（36）宽 1.25 倍，
 * 与编辑器画布里的相对比例一致（`rendering/primitives/noteMetrics`）。
 */
export const SIM_NOTE_W_RATIO = 1.35;

/** 设计 px → 场地 px 的缩放（noteSize=1、A=1 时：1 设计 px = 1.35 × laneWidth / 36 px） */
export function simSpriteScale(m: SimFieldMetrics, a: number, noteSize: number): number {
  return (SIM_NOTE_W_RATIO * noteSize * m.laneWidth * a) / NOTE_SKIN_GEOMETRY.MAIN_W;
}

// ---------------------------------------------------------------- 打击特效

/**
 * 特效寿命（秒）：命中后这一段里画轨道闪 + 打击特效。
 * 票面「特效」一行：**全程序化自绘**（不引官方素材）——轨道闪 = 线性渐变（白 0.5 → 0），
 * tap 特效 = 圆 / 环 / 光柱 / 槽，按击打样式配色。
 */
export const SIM_EFFECT_DURATION = 0.32;
/** 轨道闪起始不透明度（白 0.5 → 0） */
export const SIM_LANE_FLASH_ALPHA = 0.5;
/** 打击环的最大半径（lane 单位：1 = 一个 lane 宽，随 A 一起缩） */
export const SIM_PING_MAX_RADIUS = 0.62;
export const SIM_PING_MIN_RADIUS = 0.16;
/**
 * 轨道闪的纵向长度（**A 空间**跨度）：从场地判定线（A = 1）往上到 A = 1 − 本值。
 * 它同时是"闪的梯形上边有多窄"——A 空间 0.22 落到画面上约 1/5 个场地高（实机观感校准项）。
 */
export const SIM_LANE_FLASH_SPAN = 0.22;

/**
 * 打击特效配色（票面：tap 青、flick 粉、skill 黄、方向键紫 / 橙）。
 * 滑条结点票面没点名 → 取带体同族的绿（一望即知"这是一条带子的结点"）。
 */
export const SIM_EFFECT_COLORS = {
  tap: '#5ad7ff',
  flick: '#ff6fb5',
  skill: '#ffd457',
  slide: '#7ce7a6',
  directionalL: '#b58bff',
  directionalR: '#ffa552',
} as const;

/**
 * 带体兜底色（皮肤带体图取不到色时）：游戏绿条同族。
 * 正常路径是**取皮肤带体图的中心像素**（票面「带体」一行允许"颜色取皮肤带体图或采样中心色"）——
 * 带体在仿真场里是四边形填充，不做贴图透视变换。
 */
export const SIM_BAND_COLORS = { band: '#5fd68a', sp: '#8fe6c0' } as const;

/** 击打样式 + 方向 → 特效色（方向键按左右分紫 / 橙，其余按 key sound 样式） */
export function simEffectColor(kind: KeySoundKind, dir?: 'L' | 'R'): string {
  if (kind === 'directional') {
    return dir === 'R' ? SIM_EFFECT_COLORS.directionalR : SIM_EFFECT_COLORS.directionalL;
  }
  return SIM_EFFECT_COLORS[kind];
}

// ---------------------------------------------------------------- 命中特效与 HUD（Bestdori 口径，chart-preview 21）

/**
 * 命中特效配色（照 Bestdori 的 tint / 生成圆）：tap 青、flick 粉、skill 黄、方向键紫 / 橙、白。
 * `particles.png` 的图块按它整块染色；圆是程序化径向渐变（内 = 本色，外 = 同色透明）。
 */
export const SIM_EFFECT_TINTS = {
  tap: 'rgba(124, 225, 225, 1)',
  flick: 'rgba(255, 156, 184, 1)',
  skill: 'rgba(255, 255, 64, 1)',
  directionalL: 'rgba(214, 180, 250, 1)',
  directionalR: 'rgba(250, 196, 170, 1)',
  white: 'rgba(255, 255, 255, 1)',
} as const;

/** 命中特效的窗口（秒，照 Bestdori）：轨道闪 0.2s；各笔最长 0.6s（扫描窗口用它） */
export const SIM_LANE_FLASH_DURATION = 0.2;
export const SIM_SPRITE_EFFECT_DURATION = 0.6;

/**
 * 打击特效表（chart-preview 21）：**逐条誊自 Bestdori bundle** 的 `0 === simTapEffect` 段
 * （`CommunityChartsNew.b534f9a9.js`，scope `691780a2`，本地留档 `.cache/bestdori-bundles/`）。
 *
 * 窗口（秒）/ 图块（`particles.png` 4×4 的 `[col, row]`）/ 尺寸（lane 单位，× `noteSize`，
 * 缓动后）× α 峰值 —— 四样都只在这里定义一次，`simField` 只消费不写字面量
 * （chart-preview 18 定的「常量唯一定义处」口径）。
 *
 * 尺寸里带 `e` 的是 × `easeOutCubic(p)`，带 `u` 的是 × `(1 − u)` / `(1 + 4u)`（线性进度）。
 */
export const SIM_SPRITE_EFFECT = {
  /** 各笔的寿命窗口（秒）；`circle` 同时是"整条特效"的窗口（= `SIM_SPRITE_EFFECT_DURATION`） */
  window: {
    /** 光柱 + 槽（tap / flick / skill 通用） */
    beam: 0.4,
    /** 生成圆 / 打击环（最长的一笔） */
    circle: 0.6,
    /** 白圆 */
    white: 0.3,
    /** flick / 方向键的"正位圆"收缩 */
    flickCircle: 0.2,
    /** 方向键斜扫 */
    dirSweep: 0.2,
    /** 方向键箭头 + 环 */
    dirArrow: 0.6,
  },
  /** 图块坐标 `[col, row]`（生成圆不在此列：它是 `createCircleSprite` 画的径向渐变） */
  tile: {
    beam: [0, 0],
    slot: [1, 0],
    ring: [2, 0],
    skillBeam: [3, 0],
    star: [0, 1],
    arrow: [1, 1],
    /** 连按的环（bundle **不染**，照原色） */
    connectionRing: [2, 1],
    /** 连按的旋转环（青） */
    rotatingRing: [3, 1],
  },
  /** 尺寸（lane 单位 × `noteSize`；`[w, h]` 或单一值 = 正方） */
  size: {
    beam: [1.33, 2],
    slot: 1,
    circle: [2.25, 1.5],
    ring: [3, 2],
    /** 打击环的第二枚：`3 × 0.8 × e` × `1.6e` */
    ringInner: [2.4, 1.6],
    skillBeam: [0.6, 1.5],
    star: [2.25, 1.5],
    /** flick / 方向键正位圆的宽：`1.5(1 − u)`；高 = `2(1 + 4u)`（白圆恒 `2`） */
    flickCircleW: 1.5,
    flickCircleH: 2,
    dirSweep: [1.5, 4],
    arrow: 1,
    /** 连按环：`3 × 0.6n` × `1.2n` */
    connectionRing: [1.8, 1.2],
    /** 连按旋转环：`2·laneWidth·n` × `4/3·laneWidth·n` 的 1× 与 0.75× 两枚 */
    rotatingRing: 1,
    rotatingRingInner: 0.75,
  },
  /** 各笔的 α 峰值（再乘 `(1 − easeIn(p))`；（方向键斜扫那笔是 `1 − easeOut`）） */
  alpha: {
    beam: 1,
    circle: 0.5,
    white: 0.5,
    ring: 0.8,
    /** 连按（环与旋转环）：α 恒 1 */
    connection: 1,
  },
} as const;

/** Bestdori 的缓动（`easeInCubic` / `easeOutCubic`）：特效各笔的尺寸 / 透明度都按它插值 */
export function easeInCubic(t: number): number {
  return t * t * t;
}

export function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

/**
 * combo 的尺寸（照 Bestdori：整体按 `canvasHeight` 缩放）：
 * 数字 0.09375H 宽 × 0.125H 高（整串水平居中于锚点）、"COMBO" 标签 0.1829H × 0.05H，
 * 画在数字**下缘**（从 +0.0625H = 数字半高起）。
 */
export function comboMetrics(m: SimFieldMetrics): {
  digitW: number;
  digitH: number;
  labelW: number;
  labelH: number;
  labelGap: number;
} {
  const h = m.h;
  return {
    digitW: h * 0.09375,
    digitH: h * 0.125,
    labelW: h * (150 / 41) * 0.05, // combo.png 的 150:41 比例
    labelH: h * 0.05,
    labelGap: h * 0.0625, // = 数字半高（Bestdori 的 `Le/2`）
  };
}

/**
 * combo 的弹跳系数（照 Bestdori 的 `Oe`）：命中瞬间 0.8 → 0.1s 时 1.1 → 0.2s 落回 1。
 * 参数 = 距最近一次命中的秒数（≥0）。
 */
export function comboPopScale(secondsSinceHit: number): number {
  const we = -secondsSinceHit; // Bestdori 的 `we = lastComboTime − e`
  if (we < -0.2) return 1;
  if (we < -0.1) return we + 1.2;
  return 1.1 - 3 * (we + 0.1);
}

/**
 * 轨道闪的剪切系数（照 Bestdori 的 `setTransform(1, 0, (lane−0.5)·laneWidth/laneHeight, 1, W/2, 0)`）：
 * 局部原点在画布顶中心、y 向下到判定线；`x' = x + shear · y` 让满高的三角楔随轨道斜向消失点。
 */
export function laneFlashShear(m: SimFieldMetrics, lane: number): number {
  return (laneOffsetDesign(lane) - 0.5) * (m.laneWidth / m.laneHeight);
}

/** 进度钳到 0..1（特效四个量共用同一条夹取；非有限值按 0） */
function clamp01(p: number): number {
  if (!Number.isFinite(p)) return 0;
  return Math.min(1, Math.max(0, p));
}

/** 特效进度 0..1（< 0 未命中；> 1 已结束） */
export function effectProgress(nowSeconds: number, hitSeconds: number): number {
  return (nowSeconds - hitSeconds) / SIM_EFFECT_DURATION;
}

/** 特效不透明度（命中瞬间最亮，二次衰减到 0） */
export function effectAlpha(progress: number): number {
  const p = clamp01(progress);
  return (1 - p) * (1 - p);
}

/** 轨道闪不透明度（白 0.5 → 0，线性） */
export function laneFlashAlpha(progress: number): number {
  return SIM_LANE_FLASH_ALPHA * (1 - clamp01(progress));
}

/** 打击环半径（CSS px）：从 `SIM_PING_MIN_RADIUS` 涨到 `SIM_PING_MAX_RADIUS` 个 lane 宽 */
export function pingRadius(m: SimFieldMetrics, a: number, progress: number): number {
  const p = clamp01(progress);
  return (SIM_PING_MIN_RADIUS + (SIM_PING_MAX_RADIUS - SIM_PING_MIN_RADIUS) * p) * m.laneWidth * a;
}

// ---------------------------------------------------------------- HUD

/**
 * combo 的落点（照 Bestdori：`0.85W × 0.4375H` 一带，场地右侧中部）。
 * HUD 只画 combo —— 判定文字 / 分数 / 技能 / fever 都不在首期（ADR-0016 §1.2）。
 */
export function comboAnchor(m: SimFieldMetrics): { x: number; y: number; fontSize: number } {
  return { x: m.w * 0.85, y: m.h * 0.4375, fontSize: m.h * 0.075 };
}
