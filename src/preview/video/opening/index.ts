// 视频开场（chart-preview 30；ADR-0016 §5.1）：导出物最前面那段纯前置开场。
// 页面 / 编排层走本 barrel，不深引内部文件。
export {
  OPENING_ARTIST_FONT,
  OPENING_BADGE_FONT,
  OPENING_BAND_H,
  OPENING_COVER_RATIO,
  OPENING_CREDIT_FONT,
  OPENING_CREDIT_LINE_FACTOR,
  OPENING_FRAME_LINE,
  OPENING_GAP_ARTIST_CREDIT,
  OPENING_GAP_BAND_ARTIST,
  OPENING_STACK,
  OPENING_STACK_DRIFT_AT,
  OPENING_STACK_DRIFT_SECONDS,
  OPENING_STACK_INSET,
  OPENING_STACK_T,
  OPENING_FADE_IN_SECONDS,
  OPENING_FADE_OUT_SECONDS,
  OPENING_HOLD_SECONDS,
  OPENING_SECONDS,
  OPENING_TITLE_FONT,
  OPENING_TIMING,
  OPENING_TRACK_IN_AT,
  OPENING_TRACK_IN_SECONDS,
  openingSecondsOf,
  openingStackMetrics,
  openingTrackInAt,
  type OpeningMetrics,
  type OpeningStack,
  type OpeningTiming,
} from './openingSpec';
export { OPENING_ITEM_IDS, DEFAULT_OPENING_ITEMS, openingItemOrder } from './openingItems';
export type { OpeningItemId } from './openingItems';
export { decorPairAt } from './openingDecor';
export type { DecorNote, DecorSpacing } from './openingDecor';
export {
  drawOpeningFieldBackground,
  drawOpeningFrameAt,
  drawOpeningTrack,
  OPENING_COVER_INTRO_SECONDS,
  extractCreditLines,
  openingAlphaAt,
  openingCoverIntroAt,
  openingSegmentAt,
  openingStackDriftAt,
  openingTrackAlphaAt,
  type OpeningCredits,
  type OpeningFieldImages,
  type OpeningFrameInput,
  type OpeningSegment,
} from './openingFrame';
