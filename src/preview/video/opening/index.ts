// 视频开场（chart-preview 30；ADR-0016 §5.1）：导出物最前面那段纯前置开场。
// 页面 / 编排层走本 barrel，不深引内部文件。
export {
  OPENING_ARTIST_FONT,
  OPENING_BADGE_FONT,
  OPENING_BAND_H,
  OPENING_COVER_RATIO,
  OPENING_FRAME_LINE,
  OPENING_STACK_INSET,
  OPENING_STACK_T,
  OPENING_FADE_IN_SECONDS,
  OPENING_FADE_OUT_SECONDS,
  OPENING_HOLD_SECONDS,
  OPENING_SECONDS,
  OPENING_TITLE_FONT,
  OPENING_TRACK_IN_AT,
  OPENING_TRACK_IN_SECONDS,
  openingStackMetrics,
  type OpeningMetrics,
} from './openingSpec';
export { OPENING_ITEM_IDS, DEFAULT_OPENING_ITEMS, openingItemOrder } from './openingItems';
export type { OpeningItemId } from './openingItems';
export {
  drawOpeningFieldBackground,
  drawOpeningFrameAt,
  drawOpeningTrack,
  openingAlphaAt,
  openingSegmentAt,
  openingTrackAlphaAt,
  type OpeningFieldImages,
  type OpeningFrameInput,
  type OpeningSegment,
} from './openingFrame';
