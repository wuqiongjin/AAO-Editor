// 谱面结束后的结尾段（chart-preview 52；ADR-0016 §5）：中央章 → 黑幕转场 → 结算。
// 页面 / 编排层走本 barrel，不深引内部文件。
export {
  ENDING_SECONDS,
  ENDING_RESULT_SECONDS,
  ENDING_SPEC,
  ENDING_STAGE_BG_PACK,
  ENDING_STAMPS,
  ENDING_STAMP_SECONDS,
  ENDING_TRANS_SECONDS,
  endingUnits,
  type EndingPalette,
  type EndingSpec,
  type EndingSpecKey,
  type EndingStamp,
  type EndingUnitKey,
  type EndingUnits,
} from './endingSpec';
export {
  EMPTY_ENDING_ASSETS,
  ENDING_ASSET_BASE,
  endingAssetUrls,
  loadEndingAssets,
  type EndingAssetLoadOptions,
  type EndingAssets,
} from './endingAssets';
export {
  drawEndingFrameAt,
  type EndingContentInput,
  type EndingCounts,
  type EndingFrameInput,
  type EndingHudDrawer,
  type EndingStageInput,
} from './endingFrame';
