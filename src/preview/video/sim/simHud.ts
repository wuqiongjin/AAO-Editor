// 仿真场 HUD 的**判定字 + AP combo 态 + 归一分**（chart-preview 51 / 62 / 63）。
//
// 对标实机（ガルパ），不对标 Bestdori / Sonolus。三条口径：
//   - **AUTO 两档**（票 62，2026-11-08 定案）：AUTO 开 = 判定字切 `judge_auto`、combo 保持素白；
//     AUTO 关 = 判定字切 `judge_perfect`、combo 走 AP 变色。只接这两档，预览不做手动打歌。
//   - **判定字位置固定**：场地水平中线 × 判定线上方 0.092H（实机 t012 / t030 复核 —— 字**不跟轨道**
//     左右移动，双轨同时命中也只有一条）。
//   - **归一分**（票 63 Q14）：满分 1,000,000、单音符得分 = 满分 / 可击打物总数、最后一音补齐满分。
//     这是本仓预览的归一上限，不是游戏官方满分（实机分数随总力变化）。
//
// 这里只给"什么时候、什么颜色、多少分"的纯函数；绘制在 `simField`（那一层才有场地度量与画笔）。
import type { SimChart } from './simField';

/**
 * 判定字（实机逐帧量测，2026-10-26 复核）：
 * 字心 `0.497 W`、离判定线 `0.092 H`、高 `0.042 H` ⇒ 宽约 `0.15–0.16 W`（图集本身的 287:79）。
 */
export interface SimJudgeStyle {
  /** 字心 X（场地宽的比例） */
  cx: number;
  /** 字心离判定线的距离（场地高的比例；2026-10-27 原型回填 0.10） */
  dy: number;
  /** 字高（场地高的比例；原型回填 0.08） */
  h: number;
  /** 停留时长（秒） */
  life: number;
  /** 淡入（秒） */
  fadeIn: number;
  /** 淡出（秒） */
  fadeOut: number;
  /** 命中瞬间的弹放时长（秒；0 = 不弹，与 combo 的 `pop` 同一条曲线） */
  pop: number;
}

export const SIM_JUDGE: SimJudgeStyle = {
  /** 字心 X（场地宽的比例） */
  cx: 0.497,
  /** 字心离判定线的距离（场地高的比例；2026-10-27 原型回填 0.10） */
  dy: 0.1,
  /** 字高（场地高的比例；原型回填 0.08） */
  h: 0.08,
  /** 停留时长（秒）：出字即满强度，末段淡出 */
  life: 1,
  /** 淡入（秒）：避免硬切 */
  fadeIn: 0.04,
  /** 淡出（秒） */
  fadeOut: 0.16,
  /** 弹放（秒） */
  pop: 0.2,
};

/**
 * `judgeskin/skin00/judge.png` 的**两档**切图（票 62 定案；坐标见
 * `public/assets/game-ui/README.txt` §六）。图集里其余六格是判定图标，预览不接。
 */
export interface JudgeBox { x: number; y: number; w: number; h: number }
export const JUDGE_BOXES: { perfect: JudgeBox; auto: JudgeBox } = {
  perfect: { x: 0, y: 177, w: 287, h: 79 },
  auto: { x: 289, y: 177, w: 205, h: 79 },
};

/** AUTO 模式（缺省 = 关）只切判定字那一格；两档共用现有的判定字绘制链。 */
export function judgeSprite(auto: boolean = false): JudgeBox {
  return auto ? JUDGE_BOXES.auto : JUDGE_BOXES.perfect;
}

/** AUTO 下不存在「全 PERFECT」⇒ 不叠 AP 辉光；关掉 AUTO 才认 `settings.preview.apCombo`。 */
export function comboApActive(apCombo: boolean, autoMode: boolean): boolean {
  return apCombo && !autoMode;
}

/**
 * 距离**最近一次命中**多少秒（`null` = 这一刻没有判定字可画）。
 *
 * 命中表升序，从尾部回扫：Auto 下每个可击打物都命中，密集谱面里这个窗口几乎一直亮着 ——
 * 与实机一致（判定字跟着音符节奏闪）。超出 `life` 就返回 null，调用方据此不画。
 */
export function judgeAt(
  chart: SimChart,
  seconds: number,
  life: number = SIM_JUDGE.life,
): number | null {
  return judgeStateAt(chart, seconds, life)?.age ?? null;
}

/** 判定字这一刻的状态：`age` = 距最近一次命中的秒数；`stacked` = 上一个字还没消失又打中 */
export interface JudgeState {
  age: number;
  stacked: boolean;
}

/**
 * 判定字状态（chart-preview 51）。
 *
 * `stacked` 是给**高密度谱**用的：上一个 PERFECT 还在屏幕上（间隔 < `life`）就打下一下时，
 * 不许再淡入 —— 否则每来一个音就"灭一下再亮"，看起来一闪一闪。
 * 命中密度低于 `life` 时才是正常的一次淡入。
 */
export function judgeStateAt(
  chart: SimChart,
  seconds: number,
  life: number = SIM_JUDGE.life,
): JudgeState | null {
  const hits = chart.hitTimes;
  for (let i = hits.length - 1; i >= 0; i--) {
    const t = hits[i]!;
    if (t > seconds) continue;
    const age = seconds - t;
    if (age > life) return null;
    const prev = i > 0 ? hits[i - 1]! : null;
    return { age, stacked: prev != null && t - prev <= life };
  }
  return null;
}

// ---------------------------------------------------------------- 归一分（票 63 / 64）

/** 本仓预览的**归一上限**（不是游戏官方满分：实机分数随总力 / 卡组 / 技能变化） */
export const SCORE_MAX = 1_000_000;
/** 7 位定宽：`0002571` → `1000000`（票 63 Q10 / Q14） */
export const SCORE_DIGITS = 7;
/** 生命恒满（预览无伤，AUTO 不掉血） */
export const LIFE_MAX = 1000;

/** 6 档分数条 = 官方渐变条 A 上的一段窗口（票 63「定稿」§2，材质 B 已废弃） */
export const SCORE_TIERS = [
  { id: 'C-', from: 0, to: 0.16 },
  { id: 'C-B', from: 0.02, to: 0.3 },
  { id: 'B-A', from: 0.55, to: 1 },
  { id: 'A-S', from: 0.3, to: 0.8 },
  { id: 'S-SS', from: 0.08, to: 0.92 },
  { id: 'SS+', from: 0, to: 1 },
] as const;
/** 跨过每个字母刻度换一条分数条样式；同时是 `C/B/A/S/SS` 在灰带上的位置（相对槽宽） */
export const SCORE_TIER_THRESHOLDS = [0.06, 0.27, 0.48, 0.69, 0.9] as const;
/** 灰带上自绘的 5 个等级字母（`SS+` 是顶端态，不占刻度） */
export const LETTER_TEXTS = ['C', 'B', 'A', 'S', 'SS'] as const;

/**
 * 结算 score-rank 的**官方 11 档**（票 64 Q24），与打歌 6 档不是同一套。
 * 阈值 = `score / SCORE_MAX` 的百分比映射；**本轮实现口径（待验收）**：原型只挂了 SS 一档，
 * 阈值与其余 10 档大号字母切图都还没逐档定位，故这里先取十等分、缺切图的档走纯字降级。
 */
export const SCORE_RANKS = ['D', 'C', 'C+', 'B', 'B+', 'A', 'A+', 'S', 'S+', 'SS', 'SS+'] as const;
export type ScoreRank = (typeof SCORE_RANKS)[number];
export const SCORE_RANK_THRESHOLDS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] as const;

/**
 * 官方切图 / 用户自备件的取景（票 62 / 63 / 64「定稿」，清单见
 * `public/assets/game-ui/README.txt` §六）。`scoreBar` / `lifeBar` 是抠底后的原图尺寸。
 */
export const HUD_SPRITES = {
  scoreBar: [0, 0, 593, 132],
  /** 横向 4 切片：星章 / 右端圆角固定，中间两段分掉剩余宽度 */
  scoreSlices: [
    { sx: 0, sw: 60, flex: false },
    { sx: 60, sw: 190, flex: true },
    { sx: 250, sw: 310, flex: true },
    { sx: 560, sw: 33, flex: false },
  ],
  /** 深色空槽在 scoreBar 里的实测 bbox（填充条必须严丝合缝画在这块里） */
  scoreBand: { x: 64, y: 10, w: 521, h: 41 },
  lifeBar: [0, 0, 540, 115],
  lifeSlices: [
    { sx: 0, sw: 78, flex: false },
    { sx: 78, sw: 180, flex: true },
    { sx: 258, sw: 230, flex: true },
    { sx: 488, sw: 52, flex: false },
  ],
  lifeBand: { x: 78, y: 9, w: 451, h: 50 },
  /** 官方分数条渐变（薄荷→青→蓝→紫→品红→粉→珊瑚→橙）；6 档都从这条取窗口 */
  barA: [1, 393, 661, 22],
  /** 白底 ❚❚ 暂停钮（只作视觉，不接点击） */
  pause: [828, 318, 63, 60],
  /** 四芒星（SS+ 档左→右流动的星点层） */
  star: [0, 266, 110, 100],
  /** 结算 Score 行左侧的圆星章 */
  medal: [7, 421, 29, 30],
  /** 结算 SCORE RANK：放射状圆盘 / 大号 SS 字母 / 缎带（MenuAtlas） */
  rankDisc: [1080, 1286, 140, 132],
  rankLetter: [1303, 969, 86, 82],
  ribbon: [1375, 855, 190, 35],
} as const;

/** 顶栏绘制参数（1920×1080 设计坐标；绘制时按帧宽等比缩） */
export const SIM_HUD = {
  boxX: 36, boxY: 38, boxW: 652, boxH: 105,
  /** 槽是小圆角矩形（0.5 = 胶囊，会留暗角） */
  bandRadius: 0.15,
  fillScale: 1,
  digitFont: 35, digitDX: 0.115, digitDY: 0.725, digitTrack: 0,
  zeroColor: '#c9c9c9', liveColor: '#e8417f',
  letterH: 13, letterAlpha: 0.75, letterColor: '#ffffff', letterEdge: 'rgba(40,46,58,.55)',
  letterDY: 7, tickGap: 0,
  lifeX: 1458, lifeY: 38, lifeW: 350, lifeH: 82, lifeFont: 22,
  pauseX: 1822, pauseY: 38, pauseW: 82, pauseH: 82,
  autoX: 36, autoY: 150, autoW: 278,
  plusDur: 0.85, plusFadeFrac: 0.35, plusX: 0.42, plusY: 112, plusDX: 0.42,
  plusRise: 0, plusFont: 35, plusColor: '#eef4f8',
  starCount: 12, starSpeed: 1, starSize: 17, starAlpha: 0.9,
  thresholds: SCORE_TIER_THRESHOLDS,
} as const;

/** 升序表里 `<= value` 的个数（二分；与 `simField.simComboAt` 同一口径） */
function countHitsUpTo(sorted: readonly number[], value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid]! <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** 归一分：线性累计、最后一音补齐到满分（票 63 Q14） */
export function scoreForHits(hits: number, total: number): number {
  if (total <= 0 || hits <= 0) return 0;
  if (hits >= total) return SCORE_MAX;
  return Math.floor((SCORE_MAX * hits) / total);
}

/** 这一秒该显示的分数（只按**已命中数**，不按时间线性） */
export function scoreAt(chart: SimChart, seconds: number): number {
  const total = chart.hitTimes.length;
  return scoreForHits(countHitsUpTo(chart.hitTimes, seconds), total);
}

/** 每命中一次的增量 = `floor(满分 / 可击打物总数)`（票 63 Q22） */
export function scoreIncrement(total: number): number {
  return total > 0 ? Math.floor(SCORE_MAX / total) : 0;
}

/** 7 位定宽，前导零由绘制层染灰 */
export function formatScore(score: number): string {
  const v = Math.max(0, Math.min(SCORE_MAX, Math.round(score)));
  return String(v).padStart(SCORE_DIGITS, '0');
}

/** 打歌分数条的 6 档（0..5） */
export function scoreTierAt(score: number): number {
  const f = score / SCORE_MAX;
  let i = 0;
  for (let k = 0; k < SCORE_TIER_THRESHOLDS.length; k++) {
    if (f >= SCORE_TIER_THRESHOLDS[k]!) i = k + 1;
  }
  return Math.min(SCORE_TIERS.length - 1, i);
}

/** 结算 SCORE RANK 的 11 档（与打歌 6 档独立） */
export function scoreRankAt(score: number): ScoreRank {
  const f = Math.max(0, Math.min(1, score / SCORE_MAX));
  let i = 0;
  for (let k = 0; k < SCORE_RANK_THRESHOLDS.length; k++) {
    if (f >= SCORE_RANK_THRESHOLDS[k]!) i = k;
  }
  return SCORE_RANKS[i]!;
}

/** 还在屏幕上的 `+增量`：各条自己的年龄（秒，升序） */
export function plusAgesAt(chart: SimChart, seconds: number, duration: number): number[] {
  if (duration <= 0) return [];
  const hits = chart.hitTimes;
  const out: number[] = [];
  for (let i = countHitsUpTo(hits, seconds) - 1; i >= 0; i--) {
    const age = seconds - hits[i]!;
    if (age >= duration) break;
    out.push(age);
  }
  return out.reverse();
}
