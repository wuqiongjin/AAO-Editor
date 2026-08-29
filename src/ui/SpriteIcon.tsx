import React from 'react';

interface SpriteIconProps {
    src: string;
    x: number; // 在sprite图片中的x位置百分比
    y: number; // 在sprite图片中的y位置百分比
    width: number; // 在sprite图片中的宽度百分比
    height: number; // 在sprite图片中的高度百分比
    size?: number; // 显示尺寸（像素）
    className?: string;
    style?: React.CSSProperties;
}

export default function SpriteIcon({
    src,
    x,
    y,
    width,
    height,
    size = 20,
    className = "",
    style = {}
}: SpriteIconProps) {
    return (
        <div
            className={`sprite-icon ${className}`}
            style={{
                width: size,
                height: size,
                position: 'relative',
                overflow: 'hidden',
                ...style
            }}
        >
            <img
                src={src}
                alt="sprite"
                className="sprite-image"
                style={{
                    position: 'absolute',
                    left: `${x}%`,
                    top: `${y}%`,
                    width: `${width}%`,
                    height: `${height}%`,
                    maxWidth: `${width}%`,
                    maxHeight: `${height}%`,
                    imageRendering: 'pixelated'
                }}
            />
        </div>
    );
}

// 预定义的音符图标配置
// 基于Bang Dream! 游戏的sprite布局
// 
// 如何调整sprite位置：
// 1. 打开图片查看器，查看RhythmGameSprites.png和DirectionalFlickSprites.png
// 2. 找到对应的音符图标在图片中的位置
// 3. 计算相对于整个图片的百分比位置
// 4. 调整下面的x, y, width, height值
//
// 例如：如果图标在图片的左上角，占图片的1/4大小，则：
// x: 0, y: 0, width: 25, height: 25
//
export const NoteIcons = {
    // 单键音符 (Tap Note) - 基于你提供的精确坐标
    tap: {
        src: './assets/skins/legacy/RhythmGameSprites.png',
        x: -503.247,
        y: -753.333,
        width: 664.935,
        height: 853.333
    },

    // 滑键音符 (Flick Note) - 基于你提供的精确坐标
    flick: {
        src: './assets/skins/legacy/RhythmGameSprites.png',
        x: 0,
        y: -753.333,
        width: 664.935,
        height: 853.333
    },

    // 技能音符 (Skill Note) - 基于你提供的精确坐标
    skill: {
        src: './assets/skins/legacy/RhythmGameSprites.png',
        x: -301.948,
        y: -651.667,
        width: 664.935,
        height: 853.333
    },

    // 左方向滑键 - 基于你提供的精确坐标
    leftFlick: {
        src: './assets/skins/legacy/DirectionalFlickSprites.png',
        x: 0,
        y: -651.667,
        width: 332.468,
        height: 853.333
    },

    // 右方向滑键 - 基于你提供的精确坐标
    rightFlick: {
        src: './assets/skins/legacy/DirectionalFlickSprites.png',
        x: 0,
        y: -143.333,
        width: 332.468,
        height: 853.333
    },

    // 滑条音符 (Slide Note) - 使用longNoteLine2.png
    slide: {
        src: './assets/skins/legacy/longNoteLine2.png',
        x: 0,
        y: 0,
        width: 100,
        height: 100
    }
};

// 滑条连接线配置
export const SlideLineIcons = {
    // 滑条连接线 - 使用longNoteLine.png
    line: {
        src: './assets/skins/legacy/longNoteLine.png',
        x: 0,
        y: 0,
        width: 100,
        height: 100
    },

    // 长音符连接线 - 使用longNoteLine2.png
    longLine: {
        src: './assets/skins/legacy/longNoteLine2.png',
        x: 0,
        y: 0,
        width: 100,
        height: 100
    }
};
