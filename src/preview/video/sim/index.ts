// 仿真场（ADR-0016 §1.2 / §5；chart-preview 05）—— 动态预览的画面与回放：
//   - `simGeometry`  设计面 / 接近模型 / lane↔坐标 / 带体四边形 / 特效参数（纯函数）
//   - `simField`     谱面 → 元素表 + **任意秒出帧**（场地 → 带体 → 同时点击线 → 音符 → 特效 → combo）
//   - `simAssets`    场地素材的开发期直读通道与探活（缺素材 = 空态）
//   - `simPlayback`  实时回放（自持 AudioEngine 当秒源与键音调度；rAF 驱动出帧）
//
// 这里只出**消费方要用的面**（预览页 + 07 的离线导出）：几何与特效那一堆纯函数是模块内部件，
// 需要时按本仓惯例 deep import（`preview/video/sim/simGeometry`），测试也是这么来的。
export {
  DESIGN_SURFACE,
  approachA,
  approachOf,
  approachSeconds,
  fieldMetrics,
  fitDesignSurface,
  type SimFieldMetrics,
} from './simGeometry';
export {
  buildSimChart,
  drawSimFrameAt,
  simComboAt,
  type SimBand,
  type SimChart,
  type SimElement,
  type SimFrameAssets,
  type SimFrameInput,
  type SimScene,
  type SimSimultaneous,
} from './simField';
export {
  SIM_ASSET_BASE,
  SIM_ASSET_SERVERS,
  emptySimAssets,
  loadSimAssets,
  sampleCenterColor,
  simAssetUrls,
  simSpriteUrls,
  type SimAssetLoadOptions,
  type SimAssetUrls,
  type SimAssets,
  type SimSprites,
  type SimSpriteUrls,
} from './simAssets';
export {
  SIM_PLAYBACK_RATES,
  createSimPlayback,
  type SimPlayback,
  type SimPlaybackAudio,
  type SimPlaybackOptions,
} from './simPlayback';
