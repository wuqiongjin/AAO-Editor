import type { OpeningItemId } from './openingItems';

// 视频开场的**常量表**（chart-preview 30；ADR-0016 §5.1）：
// 四段时长 + 版式比例。原型 `?prototype=opening-screen` 定档后常量落这里，原型即删。
//
// 两条硬口径：
//   - **一切几何按帧高比例定义**：1080p / 720p 等比一致，观感不随档位变。
//   - **四段时长是用户逐段拍板的，钉死常量**（首期不可调）。

/** ① 开场淡入：第 0 帧纯黑 → 开场画面浮现 */
export const OPENING_FADE_IN_SECONDS = 1.0;
/** ② 停留：整屏静止读信息 */
export const OPENING_HOLD_SECONDS = 1.5;
/** ③ 入场过渡：开场画面淡出到**只有表演背景图**的场地上 */
export const OPENING_FADE_OUT_SECONDS = 1.0;
/** ④ 轨道淡入：整块轨道（场地图的扇形车道 + 判定线）浮现 */
export const OPENING_TRACK_IN_SECONDS = 1.5;
/** 开场段总长（= 四段之和）；视频总长 = 它 + 谱面时长 */
export const OPENING_SECONDS =
  OPENING_FADE_IN_SECONDS + OPENING_HOLD_SECONDS + OPENING_FADE_OUT_SECONDS + OPENING_TRACK_IN_SECONDS;

/** ①②③ 结束的时刻（④ 的起点） */
export const OPENING_TRACK_IN_AT = OPENING_SECONDS - OPENING_TRACK_IN_SECONDS;

// ---------------- 版式比例（照游戏内参考图实测；单位 = 帧高 / 帧宽） ----------------

/** 封面边长 / 帧高（方形，水平居中，不加圆角） */
export const OPENING_COVER_RATIO = 0.48;
/** 堆叠垫层露出厚度 t / 帧高（顶条 + 右条） */
export const OPENING_STACK_T = 0.011;
/** 垫层内缩 i / 帧高：垫层方形边长 = 封面 + t − i */
export const OPENING_STACK_INSET = 0.01;
/** 难度徽章字号 / 帧高（徽章高 = 字号 × 1.85） */
export const OPENING_BADGE_FONT = 0.024;
export const OPENING_BADGE_HEIGHT_FACTOR = 1.85;
/** 标题条高 / 帧高（全宽贴左右缘） */
export const OPENING_BAND_H = 0.11;
/** 标题条底色（用户给定：hsl(300, 7%, 91.6%)） */
export const OPENING_BAND_COLOR = '#ebe8eb';
/** 标题字色（深灰，刻意非纯黑） */
export const OPENING_BAND_TEXT = '#38383c';
/** 标题字号 / 帧高（字重 400，不加粗） */
export const OPENING_TITLE_FONT = 0.05;
/** 艺人行字号 / 帧高（方案 B：0.030 H） */
export const OPENING_ARTIST_FONT = 0.030;
/** 追加子字段（作词/作曲/编曲/谱师）字号 / 帧高（方案 B：0.022 H） */
export const OPENING_CREDIT_FONT = 0.022;
/** 封面四周细白框宽 / 帧高 */
export const OPENING_FRAME_LINE = 0.0035;

/** 封面下缘 → 徽章的间距 / 帧高（票 30 版式规格：≈0.025 H） */
export const OPENING_GAP_COVER_BADGE = 0.025;
/** 徽章 → 标题条的间距 / 帧高 */
export const OPENING_GAP_BADGE_BAND = 0.026;
/** 标题条 → 艺人行的间距 / 帧高（方案 B：0.022 H） */
export const OPENING_GAP_BAND_ARTIST = 0.022;
/** 艺人行 → 追加子字段的间距 / 帧高（方案 B：0.016 H） */
export const OPENING_GAP_ARTIST_CREDIT = 0.016;
/** 艺人行占高 = 字号 × 1.6 */
export const OPENING_ARTIST_LINE_FACTOR = 1.6;
/** 追加子字段行高倍率（方案 B：1.4x 紧凑行距） */
export const OPENING_CREDIT_LINE_FACTOR = 1.4;

// 文字字体：与长图头带同一条 `HEADER_SANS`（ADR-0016 §5.1），不打包字体 —— 见 `src/preview/fontStack.ts`

/** 开场画面的底色（首帧纯黑） */
export const OPENING_BG = '#000000';

// ---------------- 整块的栈几何 ----------------

export interface OpeningMetrics {
  /** 封面顶（帧 px） */
  top: number;
  /** 封面边长 */
  cover: number;
  coverX: number;
  /** 垫层露出厚度 t */
  stackD: number;
  /** 垫层内缩 i */
  stackInset: number;
  /** 徽章顶（无该项 = 与封面下缘同，不画） */
  badgeTop: number;
  badgeH: number;
  badgeFont: number;
  /** 标题条上缘（无该项 = NaN，不画） */
  bandY: number;
  bandH: number;
  /** 艺人行墨迹中心（无该项 = NaN，不画） */
  artistCy: number;
  artistFont: number;
  /** 追加字段块上缘（无该项 = NaN，不画） */
  creditsTop: number;
  creditFont: number;
  creditLineH: number;
  /** 整块底（含所有画出的项） */
  bottom: number;
}

/**
 * 按**实际画出的项**组成的栈算垂直居中（上 / 下留白相等；关掉某项不留空位）。
 * `items` 为空时只剩封面；`creditLinesCount` 为 0 时不计入附加字段。
 */
export function openingStackMetrics(
  w: number,
  h: number,
  items: readonly OpeningItemId[],
  creditLinesCount: number = 0,
): OpeningMetrics {
  const cover = Math.round(OPENING_COVER_RATIO * h);
  const badgeFont = Math.round(OPENING_BADGE_FONT * h);
  const badgeH = Math.round(badgeFont * OPENING_BADGE_HEIGHT_FACTOR);
  const bandH = Math.round(OPENING_BAND_H * h);
  const artistFont = Math.round(OPENING_ARTIST_FONT * h);
  const artistLine = Math.round(artistFont * OPENING_ARTIST_LINE_FACTOR);
  const creditFont = Math.round(OPENING_CREDIT_FONT * h);
  const creditLineH = Math.round(creditFont * OPENING_CREDIT_LINE_FACTOR);

  const gap1 = Math.round(OPENING_GAP_COVER_BADGE * h);
  const gap2 = Math.round(OPENING_GAP_BADGE_BAND * h);
  const gap3 = Math.round(OPENING_GAP_BAND_ARTIST * h);
  const gap4 = Math.round(OPENING_GAP_ARTIST_CREDIT * h);

  let y = cover;
  let badgeTop = y + gap1;
  if (!items.includes('difficulty')) badgeTop = NaN;
  else {
    y += gap1 + badgeH;
  }
  let bandY = NaN;
  if (items.includes('title')) {
    y += gap2;
    bandY = y;
    y += bandH;
  }
  let artistCy = NaN;
  const hasArtist = items.includes('artist');
  if (hasArtist) {
    y += gap3;
    artistCy = y + artistLine / 2;
    y += artistLine;
  }

  let creditsTop = NaN;
  if (creditLinesCount > 0) {
    y += hasArtist ? gap4 : gap3;
    creditsTop = y;
    y += creditLinesCount * creditLineH;
  }

  const top = Math.round((h - y) / 2);
  return {
    top,
    cover,
    coverX: Math.round((w - cover) / 2),
    stackD: Math.round(OPENING_STACK_T * h),
    stackInset: Math.round(OPENING_STACK_INSET * h),
    badgeTop: Number.isNaN(badgeTop) ? NaN : top + badgeTop,
    badgeH,
    badgeFont,
    bandY: Number.isNaN(bandY) ? NaN : top + bandY,
    bandH,
    artistCy: Number.isNaN(artistCy) ? NaN : top + artistCy,
    artistFont,
    creditsTop: Number.isNaN(creditsTop) ? NaN : top + creditsTop,
    creditFont,
    creditLineH,
    bottom: top + y,
  };
}
