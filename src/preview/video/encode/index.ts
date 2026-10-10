// 视频导出的编码侧（chart-preview 07）：规格 / 逐帧出帧 / 离线音轨 / 编码封装 / 编排。
// 落盘走 03 建的 `saveBinaryAs`（`src/preview/static/saveBinary`），本目录不另开通道。
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
  resolveExportGeometry,
  tierOf,
  videoExportBasename,
  type ContainerSpec,
  type ExportGeometry,
  type ExportTimeline,
  type TargetCandidate,
  type VideoContainer,
  type VideoContainerChoice,
  type VideoTier,
  type VideoTierId,
} from './exportSpec';
export {
  driveExportFrames,
  type FrameDriverRequest,
  type FrameDriverResult,
} from './frameDriver';
export {
  audioChunkFrames,
  decodeBgmBytes,
  renderAudioTrack,
  type AudioTrack,
  type AudioTrackRequest,
} from './renderAudioTrack';
export {
  DEFAULT_AUDIO_TRACK,
  createVideoSink,
  probeContainer,
  type ContainerSupport,
  type ProbeInput,
  type UnsupportedReason,
  type VideoSink,
  type VideoSinkOptions,
} from './muxer';
export {
  probeVideoExportSupport,
  runVideoExport,
  type VideoExportFailure,
  type VideoExportOutcome,
  type VideoExportPhase,
  type VideoExportProgress,
  type VideoExportRequest,
  type VideoExportSupport,
} from './exportVideo';
