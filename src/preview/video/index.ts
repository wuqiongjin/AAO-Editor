// 动态预览 = 游戏仿真场（ADR-0016 §1.2），视频导出 = 离线逐帧 + 含音频（§5）。
//
// 票 05 起画面与实时回放落 `./sim/`（几何 / 一帧绘制 / 素材 / 回放）；
// 逐帧编码 / 音轨 / 封装进 07 —— 它复用 `sim` 的 `drawSimFrameAt`（同一份任意秒出帧），
// 下面的 `VideoPreviewRequest` 仍是 02 定的**占位契约**（07 落地时按真实需要改）。
// 离线出帧**不依赖窗口尺寸**（§7）：尺寸由调用方显式给，不读窗口、不读 devicePixelRatio。
export * from './sim';

/** 一次仿真场回放 / 导出的落点与出帧尺寸（设计面 1334×750 按此框换算，§5）。 */
export interface VideoPreviewRequest {
  target: import('../types').PreviewTarget;
  /** 输出宽（CSS px）；导出默认 1920 */
  width: number;
  /** 输出高（CSS px）；导出默认 1080 */
  height: number;
  /** 导出帧率；实时回放不看这个值（走播放时钟） */
  fps?: number;
}
