export const PLAYBACK_MARKER_VIEWBOX_WIDTH = 120;
export const PLAYBACK_MARKER_VIEWBOX_HEIGHT = 130;

/** 画布旗帜相对 SVG 设计稿的固定缩放；卡片图标使用 28×30px。 */
export const PLAYBACK_MARKER_CANVAS_SCALE = 0.33;

export interface PlaybackMarkerLayout {
  scale: number;
  width: number;
  height: number;
  poleLeft: number;
  poleRight: number;
  flagTop: number;
  flagMiddle: number;
  flagBottom: number;
  poleBottom: number;
  flagTip: number;
}

/**
 * 共享 SVG 的画布 DOM 图层几何。
 * `poleBottom` 是横线所在位置，保证旗杆底端与横线相接而不穿线。
 */
export function playbackMarkerLayout(): PlaybackMarkerLayout {
  const scale = PLAYBACK_MARKER_CANVAS_SCALE;
  return {
    scale,
    width: PLAYBACK_MARKER_VIEWBOX_WIDTH * scale,
    height: PLAYBACK_MARKER_VIEWBOX_HEIGHT * scale,
    poleLeft: 29 * scale,
    poleRight: 35 * scale,
    flagTop: 18 * scale,
    flagMiddle: 50 * scale,
    flagBottom: 78 * scale,
    poleBottom: 105 * scale,
    flagTip: 88 * scale,
  };
}
