// 动态预览 = 游戏仿真场（ADR-0016 §1.2），视频导出 = 离线逐帧 + 含音频（§5）。
//
// 票 05 起画面与实时回放落 `./sim/`（几何 / 一帧绘制 / 素材 / 回放）；
// 票 07 起逐帧编码 / 音轨 / 封装落 `./encode/`。
//
// 离线出帧**不依赖窗口尺寸**（§7）：尺寸由调用方显式给（分辨率档），不读窗口、不读 devicePixelRatio。
export * from './sim';
export {
  CONTAINER_FALLBACK_ORDER,
  CONTAINER_SPECS,
  AAC_AUDIO_CODECS,
  DEFAULT_VIDEO_CONTAINER,
  DEFAULT_VIDEO_TIER,
  EXPORT_AUDIO_CHANNELS,
  EXPORT_AUDIO_SAMPLE_RATE,
  EXPORT_FPS,
  OPUS_AUDIO_CODEC,
  VIDEO_EXPORT_TIERS,
  audioFramesFor,
  buildExportTimeline,
  candidateOrder,
  frameSecondsAt,
  frameTimestampUs,
  isAacCodec,
  muxerAudioCodecFor,
  probeVideoExportSupport,
  resolveExportGeometry,
  runVideoExport,
  tierOf,
  videoExportBasename,
  type ContainerSpec,
  type ExportGeometry,
  type ExportTimeline,
  type TargetCandidate,
  type VideoContainer,
  type VideoContainerChoice,
  type VideoExportFailure,
  type VideoExportOutcome,
  type VideoExportPhase,
  type VideoExportProgress,
  type VideoExportRequest,
  type VideoExportSupport,
  type VideoTier,
  type VideoTierId,
} from './encode';
