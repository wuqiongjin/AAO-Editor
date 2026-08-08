export interface SpriteIconConfig {
    src: string;
    x: number;
    y: number;
    width: number;
    height: number;
    offsetX?: number;
    offsetY?: number;
    scale?: number;
    scaleX?: number;
    scaleY?: number;
    zIndex?: number;
}

export interface CanvasSpriteIconProps {
    src: string;
    x: number;
    y: number;
    width: number;
    height: number;
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

    private static computeSrcRect(img: HTMLImageElement, cfg: { x: number; y: number; width: number; height: number; }) {
        const { x, y, width, height } = cfg;
        if (width === 0 || height === 0) return null;

        const srcW = (img.width * 100) / width;
        const srcH = (img.height * 100) / height;
        const srcX = (-x * img.width) / width;
        const srcY = (-y * img.height) / height;

        const clampedSrcX = Math.max(0, Math.min(img.width, srcX));
        const clampedSrcY = Math.max(0, Math.min(img.height, srcY));
        const clampedSrcW = Math.max(0, Math.min(img.width - clampedSrcX, srcW));
        const clampedSrcH = Math.max(0, Math.min(img.height - clampedSrcY, srcH));

        return { sx: clampedSrcX, sy: clampedSrcY, sw: clampedSrcW, sh: clampedSrcH };
    }

    private static drawSingle(
        ctx: CanvasRenderingContext2D,
        cfg: { src: string; x: number; y: number; width: number; height: number; canvasX: number; canvasY: number; canvasW: number; canvasH: number; overallScale?: number; scaleX?: number; scaleY?: number; }
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
        const { src, x, y, width, height, canvasX, canvasY, canvasSize, canvasWidth, canvasHeight, scale = 1.0, decorators = [], renderLayer = 'all' } = props;

        const displayW = canvasWidth ?? canvasSize;
        const displayH = canvasHeight ?? canvasSize;

        if (renderLayer === 'main' || renderLayer === 'all') {
            CanvasSpriteIcon.drawSingle(ctx, { src, x, y, width, height, canvasX, canvasY, canvasW: displayW, canvasH: displayH, overallScale: scale });
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
                    src: dec.src, x: dec.x, y: dec.y, width: dec.width, height: dec.height,
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
export const BaseSpriteIcons = {
    // 单键音符 (Tap Note) - 使用竞品的确切坐标
    tap: {
        src: './assets/skins/RhythmGameSprites.png',
        x: -503.247,
        y: -753.333,
        width: 664.935,
        height: 853.333
    },

    // 滑键音符 (Flick Note) - 使用竞品的确切坐标
    flick: {
        src: './assets/skins/RhythmGameSprites.png',
        x: 0,
        y: -753.333,
        width: 664.935,
        height: 853.333
    },

    // 技能音符 (Skill Note) - 使用竞品的确切坐标
    skill: {
        src: './assets/skins/RhythmGameSprites.png',
        x: -301.948,
        y: -651.667,
        width: 664.935,
        height: 853.333
    },

    // 左方向滑键 - 使用竞品的确切坐标
    leftFlick: {
        src: './assets/skins/DirectionalFlickSprites.png',
        x: 2,
        y: -651.667,
        width: 320.468,
        height: 853.333
    },

    // 右方向滑键 - 使用竞品的确切坐标
    rightFlick: {
        src: './assets/skins/DirectionalFlickSprites.png',
        x: 2,
        y: -143.333,
        width: 320.468,
        height: 853.333
    }
};

// 装饰器图标配置
export const DecoratorIcons = {
    // 滑键装饰器，用于组合到滑键上方
    flickDecorator: {
        src: './assets/skins/RhythmGameSprites.png',
        x: -400.123,
        y: -53.333,
        width: 664.935,
        height: 995.333,
        offsetX: 7,  // 相对于主图标的X偏移 (向右偏移9px)
        offsetY: -12, // 相对于主图标的Y偏移（向上偏移12px）
        scale: 1.0, // 装饰器整体缩放比例
        scaleX: 1.0, // X轴缩放比例（宽度保持不变）
        scaleY: 0.6  // Y轴缩放比例（高度压缩到60%，变窄）
    },

    // 左方向滑键装饰器，用于组合到滑键上方
    LDirectionalFlickDecorator: {
        src: './assets/skins/DirectionalFlickSprites.png',
        x: -199.247,
        y: -429.333,
        width: 664.935,
        height: 853.333,
        offsetX: -28,  // 相对于主图标的X偏移 (向左偏移28px)
        offsetY: 0, // 相对于主图标的Y偏移
        scale: 1.0, // 装饰器整体缩放比例
        scaleX: 0.5, // X轴缩放比例（宽度压缩到50%）
        scaleY: 0.8  // Y轴缩放比例（高度压缩到80%，变窄）
    },

    // 右方向滑键装饰器，用于组合到滑键上方
    RDirectionalFlickDecorator: {
        src: './assets/skins/DirectionalFlickSprites.png',
        x: -190.247,
        y: -283.333,
        width: 664.935,
        height: 853.333,
        offsetX: 28,  // 相对于主图标的X偏移 (向右偏移8px)
        offsetY: 0, // 相对于主图标的Y偏移
        scale: 1.0, // 装饰器整体缩放比例
        scaleX: 0.5, // X轴缩放比例（宽度压缩到50%）
        scaleY: 0.8  // Y轴缩放比例（高度压缩到80%，变窄）
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
                zIndex: 10 // 设置与方向键装饰器相同的高优先级
            }
        ]
    },
    // 左方向滑键组合 - 根据length属性选择不同的组合
    // L1: 1个LDirectionalFlickDecorator + 1个leftFlick
    leftFlickL1: {
        ...BaseSpriteIcons.leftFlick,
        decorators: [
            {
                ...DecoratorIcons.LDirectionalFlickDecorator,
                offsetX: -18,
                zIndex: 10 // 设置更高的图层优先级
            }
        ]
    },
    // L2: 1个LDirectionalFlickDecorator + 2个leftFlick
    leftFlickL2: {
        ...BaseSpriteIcons.leftFlick,
        decorators: [
            {
                ...BaseSpriteIcons.leftFlick,
                offsetX: -30, // 第二个leftFlick向左偏移 (偏移数值 = 轨道宽度)
                offsetY: 0,
                scale: 0.9
            },
            {
                ...DecoratorIcons.LDirectionalFlickDecorator,
                offsetX: -48,
                offsetY: 0,
                scale: 1.0,
                zIndex: 10 // 设置更高的图层优先级
            }
        ]
    },
    // L3: 1个LDirectionalFlickDecorator + 3个leftFlick
    leftFlickL3: {
        ...BaseSpriteIcons.leftFlick,
        decorators: [
            {
                ...BaseSpriteIcons.leftFlick,
                offsetX: -30, // 第二个leftFlick向左偏移 (偏移数值 = 轨道宽度)
                offsetY: 0,
                scale: 0.9
            },
            {
                ...BaseSpriteIcons.leftFlick,
                offsetX: -60, // 第三个leftFlick更向左偏移
                offsetY: 0,
                scale: 0.9
            },
            {
                ...DecoratorIcons.LDirectionalFlickDecorator,
                offsetX: -78,
                offsetY: 0,
                scale: 1.0,
                zIndex: 10 // 设置更高的图层优先级
            }
        ]
    },

    // 右方向滑键组合 - 根据length属性选择不同的组合
    // R1: 1个RDirectionalFlickDecorator + 1个rightFlick
    rightFlickR1: {
        ...BaseSpriteIcons.rightFlick,
        decorators: [
            {
                ...DecoratorIcons.RDirectionalFlickDecorator,
                offsetX: 18,
                zIndex: 10 // 设置更高的图层优先级
            }
        ]
    },
    // R2: 1个RDirectionalFlickDecorator + 2个rightFlick
    rightFlickR2: {
        ...BaseSpriteIcons.rightFlick,
        decorators: [
            {
                ...BaseSpriteIcons.rightFlick,
                offsetX: 30, // 第二个rightFlick向右偏移 (偏移数值 = 轨道宽度)
                offsetY: 0,
                scale: 0.9
            },
            {
                ...DecoratorIcons.RDirectionalFlickDecorator,
                offsetX: 48,
                offsetY: 0,
                scale: 1.0,
                zIndex: 10 // 设置更高的图层优先级
            }
        ]
    },
    // R3: 1个RDirectionalFlickDecorator + 3个rightFlick
    rightFlickR3: {
        ...BaseSpriteIcons.rightFlick,
        decorators: [
            {
                ...BaseSpriteIcons.rightFlick,
                offsetX: 30, // 第二个rightFlick向右偏移 (偏移数值 = 轨道宽度)
                offsetY: 0,
                scale: 0.9
            },
            {
                ...BaseSpriteIcons.rightFlick,
                offsetX: 60, // 第三个rightFlick更向右偏移
                offsetY: 0,
                scale: 0.9
            },
            {
                ...DecoratorIcons.RDirectionalFlickDecorator,
                offsetX: 78,
                offsetY: 0,
                scale: 1.0,
                zIndex: 10 // 设置更高的图层优先级
            }
        ]
    },

    // 保留旧的配置用于向后兼容
    leftFlick: {
        ...BaseSpriteIcons.leftFlick,
        decorators: [
            {
                ...DecoratorIcons.LDirectionalFlickDecorator,
                zIndex: 10 // 设置更高的图层优先级
            }
        ]
    },
    rightFlick: {
        ...BaseSpriteIcons.rightFlick,
        decorators: [
            {
                ...DecoratorIcons.RDirectionalFlickDecorator,
                zIndex: 10 // 设置更高的图层优先级
            }
        ]
    },

    // 其他音符直接使用基础配置
    tap: BaseSpriteIcons.tap,
    skill: BaseSpriteIcons.skill,
};

// 为了向后兼容，保留原来的SVGNoteIcons名称
export const CanvasNoteIcons = CompositeNoteConfigs;

// 滑条连接线配置
export const CanvasSlideLineIcons = {
    // 普通连接线
    slideLine: {
        src: './assets/skins/longNoteLine.png',
        x: 0,
        y: 0,
        width: 100,
        height: 100
    },

    // SP滑条连接线 (Special滑条连接线)
    SPSlideLine: {
        src: './assets/skins/longNoteLine2.png',
        x: 0,
        y: 0,
        width: 100,
        height: 100
    },

    // pathway音符 (滑条途径结点音符样式)
    pathway: {
        src: './assets/skins/RhythmGameSprites.png',
        x: -100.247,
        y: -242.333,
        width: 664.935,
        height: 853.333
    },

    // endpoint音符 (滑条起始点音符样式)
    endpoint: {
        src: './assets/skins/RhythmGameSprites.png',
        x: -402.247,
        y: -652.333,
        width: 664.935,
        height: 853.333
    }
};
