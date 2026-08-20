/**
 * 精灵图配置（issue 40 坐标规范化）：`x/y/w/h` 为**源图内像素矩形**（从源图左上角算起），
 * 直观可读、无需换算；新增音符款式/皮肤只加一条数据，不碰提取逻辑。
 *
 * 旧实现用「负百分比偏移 + 百分比尺寸（含缩放系数）」从 2048×1024/1024×1024 大图反解截取，
 * 抽象难懂（issue 39 grill Q8）。现改回直接像素矩形，`computeSrcRect` 只做边界裁剪。
 *
 * 额外字段：
 * - `inkLeft/inkRight`：方向滑键等精灵框内可见墨迹相对矩形左右边的**源像素缩进**，
 *   供「同时点击连接线」等以墨迹真实边缘定位（消除连接线头与图标间的空隙，issue 40 关联 BUG）。
 */
export interface SpriteIconConfig {
    src: string;
    /** 源图内像素矩形 x（左上角） */
    x: number;
    /** 源图内像素矩形 y（左上角） */
    y: number;
    /** 源图内矩形宽（像素） */
    w: number;
    /** 源图内矩形高（像素） */
    h: number;
    offsetX?: number;
    offsetY?: number;
    scale?: number;
    scaleX?: number;
    scaleY?: number;
    zIndex?: number;
    /** 可见墨迹相对矩形左边缩进（源像素）：连接线等以此贴合真实墨迹边缘 */
    inkLeft?: number;
    /** 可见墨迹相对矩形右边缩进（源像素） */
    inkRight?: number;
    /** 音符墨迹的目标屏幕绘制尺寸（覆盖默认 canvas 尺寸）；issue 40 收紧矩形时等比收窄以保持墨迹尺寸 */
    out?: { w: number; h: number };
}

export interface CanvasSpriteIconProps {
    src: string;
    /** 源图内像素矩形 */
    x: number;
    y: number;
    w: number;
    h: number;
    canvasX: number;
    canvasY: number;
    canvasSize: number;
    canvasWidth?: number;
    canvasHeight?: number;
    scale?: number;
    decorators?: SpriteIconConfig[];
    renderLayer?: 'main' | 'decorators' | 'all';
}

export default class CanvasSpriteIcon {
    private static imageCache: Map<string, HTMLImageElement> = new Map();
    private static loadingPromises: Map<string, Promise<HTMLImageElement>> = new Map();

    public static ensureImagesLoaded(urls: string[]): Promise<void[]> {
        const ps = urls.map(u => CanvasSpriteIcon.loadImage(u).then(() => undefined));
        return Promise.all(ps);
    }

    private static loadImage(url: string): Promise<HTMLImageElement> {
        if (CanvasSpriteIcon.imageCache.has(url)) {
            return Promise.resolve(CanvasSpriteIcon.imageCache.get(url)!);
        }
        if (CanvasSpriteIcon.loadingPromises.has(url)) {
            return CanvasSpriteIcon.loadingPromises.get(url)!;
        }

        const p = new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                CanvasSpriteIcon.imageCache.set(url, img);
                CanvasSpriteIcon.loadingPromises.delete(url);
                resolve(img);
            };
            img.onerror = (e) => {
                CanvasSpriteIcon.loadingPromises.delete(url);
                console.warn('[CanvasSpriteIcon] image load error:', url, e);
                reject(new Error('Image load failed: ' + url));
            };
            img.src = url;
        });

        CanvasSpriteIcon.loadingPromises.set(url, p);
        return p;
    }

    private static getImageSync(url: string): HTMLImageElement | null {
        return CanvasSpriteIcon.imageCache.get(url) ?? null;
    }

    private static computeSrcRect(img: HTMLImageElement, cfg: { x: number; y: number; w: number; h: number; }) {
        const { x, y, w, h } = cfg;
        if (w === 0 || h === 0) return null;

        // x/y/w/h 已是源图内像素矩形：只需按图片边界裁剪（防源图坐标越界/历史遗留越界值）
        const srcX = Math.max(0, Math.min(img.width, x));
        const srcY = Math.max(0, Math.min(img.height, y));
        const srcW = Math.max(0, Math.min(img.width - srcX, w));
        const srcH = Math.max(0, Math.min(img.height - srcY, h));

        return { sx: srcX, sy: srcY, sw: srcW, sh: srcH };
    }

    private static drawSingle(
        ctx: CanvasRenderingContext2D,
        cfg: { src: string; x: number; y: number; w: number; h: number; canvasX: number; canvasY: number; canvasW: number; canvasH: number; overallScale?: number; scaleX?: number; scaleY?: number; }
    ) {
        const img = CanvasSpriteIcon.getImageSync(cfg.src);
        if (!img) {
            CanvasSpriteIcon.loadImage(cfg.src).catch(() => {});
            return false;
        }
        const rect = CanvasSpriteIcon.computeSrcRect(img, cfg);
        if (!rect || rect.sw <= 0 || rect.sh <= 0) return false;

        const sX = cfg.overallScale ?? 1;
        const dW = (cfg.canvasW) * (cfg.scaleX ?? 1) * sX;
        const dH = (cfg.canvasH) * (cfg.scaleY ?? 1) * sX;
        const dx = Math.round(cfg.canvasX - dW / 2);
        const dy = Math.round(cfg.canvasY - dH / 2);

        try {
            ctx.drawImage(img, rect.sx, rect.sy, rect.sw, rect.sh, dx, dy, dW, dH);
        } catch (e) {
            console.warn('[CanvasSpriteIcon] drawImage failed', e);
        }
        return true;
    }

    public render(ctx: CanvasRenderingContext2D, props: CanvasSpriteIconProps) {
        const { src, x, y, w, h, canvasX, canvasY, canvasSize, canvasWidth, canvasHeight, scale = 1.0, decorators = [], renderLayer = 'all' } = props;

        const displayW = canvasWidth ?? canvasSize;
        const displayH = canvasHeight ?? canvasSize;

        if (renderLayer === 'main' || renderLayer === 'all') {
            CanvasSpriteIcon.drawSingle(ctx, { src, x, y, w, h, canvasX, canvasY, canvasW: displayW, canvasH: displayH, overallScale: scale });
        }

        const low = decorators.filter(d => (d.zIndex ?? 0) < 10).sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
        const high = decorators.filter(d => (d.zIndex ?? 0) >= 10).sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));

        const renderDecoratorList = (list: SpriteIconConfig[]) => {
            for (const dec of list) {
                const sX = dec.scale ?? 1;
                const scaleX = dec.scaleX ?? sX;
                const scaleY = dec.scaleY ?? sX;
                // 装饰器尺寸同样乘以 viewport.scale，与主图标/轨道保持一致的缩放比例
                const dW = displayW * scaleX * scale;
                const dH = displayH * scaleY * scale;
                const offsetX = (dec.offsetX ?? 0) * scale;
                const offsetY = (dec.offsetY ?? 0) * scale;

                CanvasSpriteIcon.drawSingle(ctx, {
                    src: dec.src, x: dec.x, y: dec.y, w: dec.w, h: dec.h,
                    canvasX: canvasX + offsetX, canvasY: canvasY + offsetY,
                    canvasW: dW, canvasH: dH, overallScale: 1, scaleX: 1, scaleY: 1
                });
            }
        };

        if (renderLayer === 'main' || renderLayer === 'all') renderDecoratorList(low);
        if (renderLayer === 'decorators' || renderLayer === 'all') renderDecoratorList(high);
    }

    public isPointInIcon(px: number, py: number, props: CanvasSpriteIconProps) {
        const displayW = props.canvasWidth ?? props.canvasSize;
        const displayH = props.canvasHeight ?? props.canvasSize;
        const left = props.canvasX - displayW / 2;
        const right = props.canvasX + displayW / 2;
        const top = props.canvasY - displayH / 2;
        const bottom = props.canvasY + displayH / 2;
        return px >= left && px <= right && py >= top && py <= bottom;
    }
}

// 导出配置常量（与SVGSpriteIcon保持一致）
//
// issue 40 坐标规范化：以下 `x/y/w/h` 均为**源图内像素矩形**（从源图左上角算起）。
// 源图尺寸：RhythmGameSprites.png = 2048×1024；DirectionalFlickSprites.png = 1024×1024。
// 新增音符款式/皮肤：只需在下面追加一条数据（含 inkLeft/inkRight 墨迹缩进），不碰提取逻辑。
// `out`：可选，音符**墨迹**在屏幕上的目标绘制尺寸（覆盖默认 canvas 尺寸）。
//   —— issue 40（渲染质量）：主音符源矩形已收紧到可见墨迹（四周近透明过渡带 + 相邻深青图元
//   会在双线性缩小时混出「黑黑白白」杂边）。收紧矩形后须把绘制尺寸按同比例缩小，墨迹屏幕
//   尺寸保持不变、观感仅更「贴合墨迹」，不留瑕疵边。
export const BaseSpriteIcons = {
    // 单键音符 (Tap Note)
    tap: {
        src: './assets/skins/RhythmGameSprites.png',
        x: 1553, y: 912, w: 302, h: 103,
        // 原 308×120 → 收紧 302×103：绘制尺寸等比收窄以保持墨迹屏幕尺寸
        out: { w: 36 * (302 / 308), h: 21.6 * (103 / 120) },
    },

    // 滑键音符 (Flick Note)
    flick: {
        src: './assets/skins/RhythmGameSprites.png',
        x: 3, y: 912, w: 302, h: 104,
        out: { w: 36 * (302 / 308), h: 21.6 * (104 / 120) },
    },

    // 技能音符 (Skill Note)
    skill: {
        src: './assets/skins/RhythmGameSprites.png',
        x: 933, y: 787, w: 302, h: 107,
        out: { w: 36 * (302 / 308), h: 21.6 * (107 / 120) },
    },

    // 左方向滑键（含墨迹缩进：可见墨迹相对精灵框左右边的源像素距离）
    leftFlick: {
        src: './assets/skins/DirectionalFlickSprites.png',
        x: 0, y: 782, w: 319.532, h: 120,
        inkLeft: 42, inkRight: 67
    },

    // 右方向滑键（含墨迹缩进）
    rightFlick: {
        src: './assets/skins/DirectionalFlickSprites.png',
        x: 0, y: 172, w: 319.532, h: 120,
        inkLeft: 55, inkRight: 53
    },

    // 虚拍（tap 的虚拍款式）接入点（issue 40 / issue 39 #4 色觉辅助）：
    // !!! 具体源图矩形坐标待 Issue-41 可视化定位工具从图上取后填写；当前 w/h=0 使其 inert 不绘制。
    // !!! 接入时只需照抄上面的 { src, x, y, w, h } 形态（可含 inkLeft/inkRight），无需改提取逻辑。
    tapVirtual: {
        src: './assets/skins/RhythmGameSprites.png',
        x: 0, y: 0, w: 0, h: 0
    },
};

// 装饰器图标配置（x/y/w/h 均为源图内像素矩形）
export const DecoratorIcons = {
    // 滑键装饰器，用于组合到滑键上方
    flickDecorator: {
        src: './assets/skins/RhythmGameSprites.png',
        x: 1232.379, y: 54.869, w: 308, h: 102.88,
        offsetX: 7,  // 相对于主图标的X偏移
        offsetY: -12, // 相对于主图标的Y偏移（向上）
        scale: 1.0,
        scaleX: 1.0,
        scaleY: 0.6
    },

    // 左方向滑键装饰器，用于组合到滑键上方
    LDirectionalFlickDecorator: {
        src: './assets/skins/DirectionalFlickSprites.png',
        x: 306.84, y: 515.2, w: 154, h: 120,
        offsetX: -28,
        offsetY: 0,
        scale: 1.0,
        scaleX: 0.5,
        scaleY: 0.8
    },

    // 右方向滑键装饰器，用于组合到滑键上方
    RDirectionalFlickDecorator: {
        src: './assets/skins/DirectionalFlickSprites.png',
        x: 292.98, y: 340, w: 154, h: 120,
        offsetX: 28,
        offsetY: 0,
        scale: 1.0,
        scaleX: 0.5,
        scaleY: 0.8
    }
};

// 组合图标配置 - 定义哪些音符需要组合显示
export const CompositeNoteConfigs = {
    // 滑键音符 = 基础flick + flickDecorator
    flick: {
        ...BaseSpriteIcons.flick,
        decorators: [
            {
                ...DecoratorIcons.flickDecorator,
                zIndex: 10
            }
        ]
    },
    // 左方向滑键组合 - 根据length属性选择不同的组合
    leftFlickL1: {
        ...BaseSpriteIcons.leftFlick,
        decorators: [
            {
                ...DecoratorIcons.LDirectionalFlickDecorator,
                offsetX: -18,
                zIndex: 10
            }
        ]
    },
    leftFlickL2: {
        ...BaseSpriteIcons.leftFlick,
        decorators: [
            {
                ...BaseSpriteIcons.leftFlick,
                offsetX: -30,
                offsetY: 0,
                scale: 0.9
            },
            {
                ...DecoratorIcons.LDirectionalFlickDecorator,
                offsetX: -48,
                offsetY: 0,
                scale: 1.0,
                zIndex: 10
            }
        ]
    },
    leftFlickL3: {
        ...BaseSpriteIcons.leftFlick,
        decorators: [
            {
                ...BaseSpriteIcons.leftFlick,
                offsetX: -30,
                offsetY: 0,
                scale: 0.9
            },
            {
                ...BaseSpriteIcons.leftFlick,
                offsetX: -60,
                offsetY: 0,
                scale: 0.9
            },
            {
                ...DecoratorIcons.LDirectionalFlickDecorator,
                offsetX: -78,
                offsetY: 0,
                scale: 1.0,
                zIndex: 10
            }
        ]
    },

    // 右方向滑键组合 - 根据length属性选择不同的组合
    rightFlickR1: {
        ...BaseSpriteIcons.rightFlick,
        decorators: [
            {
                ...DecoratorIcons.RDirectionalFlickDecorator,
                offsetX: 18,
                zIndex: 10
            }
        ]
    },
    rightFlickR2: {
        ...BaseSpriteIcons.rightFlick,
        decorators: [
            {
                ...BaseSpriteIcons.rightFlick,
                offsetX: 30,
                offsetY: 0,
                scale: 0.9
            },
            {
                ...DecoratorIcons.RDirectionalFlickDecorator,
                offsetX: 48,
                offsetY: 0,
                scale: 1.0,
                zIndex: 10
            }
        ]
    },
    rightFlickR3: {
        ...BaseSpriteIcons.rightFlick,
        decorators: [
            {
                ...BaseSpriteIcons.rightFlick,
                offsetX: 30,
                offsetY: 0,
                scale: 0.9
            },
            {
                ...BaseSpriteIcons.rightFlick,
                offsetX: 60,
                offsetY: 0,
                scale: 0.9
            },
            {
                ...DecoratorIcons.RDirectionalFlickDecorator,
                offsetX: 78,
                offsetY: 0,
                scale: 1.0,
                zIndex: 10
            }
        ]
    },

    // 保留旧的配置用于向后兼容
    leftFlick: {
        ...BaseSpriteIcons.leftFlick,
        decorators: [
            {
                ...DecoratorIcons.LDirectionalFlickDecorator,
                zIndex: 10
            }
        ]
    },
    rightFlick: {
        ...BaseSpriteIcons.rightFlick,
        decorators: [
            {
                ...DecoratorIcons.RDirectionalFlickDecorator,
                zIndex: 10
            }
        ]
    },

    // 其他音符直接使用基础配置
    tap: BaseSpriteIcons.tap,
    skill: BaseSpriteIcons.skill,
};

// 为了向后兼容，保留原来的SVGNoteIcons名称
export const CanvasNoteIcons = CompositeNoteConfigs;

// 滑条连接线配置（x/y/w/h = 源图内像素矩形）
export const CanvasSlideLineIcons = {
    // 普通连接线（longNoteLine.png 整图 146×205）
    slideLine: {
        src: './assets/skins/longNoteLine.png',
        x: 0, y: 0, w: 146, h: 205
    },

    // SP滑条连接线（longNoteLine2.png 整图 146×205）
    SPSlideLine: {
        src: './assets/skins/longNoteLine2.png',
        x: 0, y: 0, w: 146, h: 205
    },

    // pathway音符 (滑条途径结点音符样式)
    pathway: {
        src: './assets/skins/RhythmGameSprites.png',
        x: 308.76, y: 290.8, w: 308, h: 120
    },

    // endpoint音符 (滑条起始点音符样式)
    endpoint: {
        src: './assets/skins/RhythmGameSprites.png',
        x: 1238.92, y: 782.8, w: 308, h: 120
    }
};
