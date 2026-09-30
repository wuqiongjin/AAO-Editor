// 动态预览 = 游戏仿真场（ADR-0016 §1.2），视频导出 = 离线逐帧 + 含音频（§5）。
//
// 骨架：本票（chart-preview 02）只定接缝——"谁 + 出帧尺寸 / 帧率"，几何与一帧绘制进 05，
// 逐帧编码 / 音轨 / 封装进 07，下面的形状是**占位契约**（落地时按真实需要改）。
// 离线出帧**不依赖窗口尺寸**（§7）：尺寸由调用方显式给，不读窗口、不读 devicePixelRatio。
import type { PreviewTarget } from '../types';

/** 一次仿真场回放 / 导出的落点与出帧尺寸（设计面 1334×750 按此框换算，§5）。 */
export interface VideoPreviewRequest {
  target: PreviewTarget;
  /** 输出宽（CSS px）；导出默认 1920 */
  width: number;
  /** 输出高（CSS px）；导出默认 1080 */
  height: number;
  /** 导出帧率；实时回放不看这个值（走播放时钟） */
  fps?: number;
}
