/**
 * 播放起点旗帜的**尺寸真源**（issue 152）。
 *
 * 真源分层：`src/assets/playback-marker/flag.svg` 是设计稿（只定义 viewBox 内的构图比例），
 * 本文件把设计稿坐标折算成屏幕像素，画布旗帜、右侧卡片图标、命中 clip-path、单测断言
 * 一律引用这里的常数——不再各自抄一份数字。
 *
 * 画布旗帜尺寸对 `PLAYBACK_MARKER_CANVAS_SCALE` 是常量倍率，因此**恒定屏幕像素**：
 * 只随拍位/滚动移动，不随画布缩放（三轮定案）。
 */

/** SVG 设计稿 viewBox（与 flag.svg 的 viewBox 一致，改稿时两处同步）。 */
export const PLAYBACK_MARKER_VIEWBOX_WIDTH = 120;
export const PLAYBACK_MARKER_VIEWBOX_HEIGHT = 130;

/** 画布旗帜相对 SVG 设计稿的固定缩放 → 约 40×43px（三轮定案）。 */
export const PLAYBACK_MARKER_CANVAS_SCALE = 0.33;

/** 右侧状态卡片上的缩小旗帜（比画布旗帜小一档）。 */
export const PLAYBACK_MARKER_CARD_WIDTH = 28;
export const PLAYBACK_MARKER_CARD_HEIGHT = 30;

/** 标记线的命中容差（屏幕像素，固定值，不随缩放）。 */
export const PLAYBACK_MARKER_HIT_TOLERANCE_PX = 10;

export interface PlaybackMarkerLayout {
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
export const PLAYBACK_MARKER_LAYOUT: Readonly<PlaybackMarkerLayout> = Object.freeze(
    ((): PlaybackMarkerLayout => {
        const scale = PLAYBACK_MARKER_CANVAS_SCALE;
        return {
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
    })(),
);

/**
 * 旗帜命中层的 clip-path（只让旗面+旗杆可点，透明区不吞事件）。
 * 尺寸恒定 → 模块级常量，渲染循环里不再逐帧拼字符串。
 */
export const PLAYBACK_MARKER_CLIP_PATH =
    `polygon(` +
    `${PLAYBACK_MARKER_LAYOUT.poleLeft}px ${PLAYBACK_MARKER_LAYOUT.flagTop}px,` +
    `${PLAYBACK_MARKER_LAYOUT.poleRight}px ${PLAYBACK_MARKER_LAYOUT.flagTop}px,` +
    `${PLAYBACK_MARKER_LAYOUT.flagTip}px ${PLAYBACK_MARKER_LAYOUT.flagMiddle}px,` +
    `${PLAYBACK_MARKER_LAYOUT.poleRight}px ${PLAYBACK_MARKER_LAYOUT.flagBottom}px,` +
    `${PLAYBACK_MARKER_LAYOUT.poleRight}px ${PLAYBACK_MARKER_LAYOUT.poleBottom}px,` +
    `${PLAYBACK_MARKER_LAYOUT.poleLeft}px ${PLAYBACK_MARKER_LAYOUT.poleBottom}px,` +
    `${PLAYBACK_MARKER_LAYOUT.poleLeft}px ${PLAYBACK_MARKER_LAYOUT.flagBottom}px` +
    `)`;
