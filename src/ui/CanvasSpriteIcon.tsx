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

/** 锚点（主精灵位置 + 设计尺寸）——供 `renderDecorator` 把挂件贴在主精灵上。 */
export interface SpriteAnchor {
    /** 主精灵中心 canvasX */
    canvasX: number;
    /** 主精灵中心 canvasY */
    canvasY: number;
    /** 主精灵设计宽（drawW） */
    drawW: number;
    /** 主精灵设计高（drawH） */
    drawH: number;
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
            return Promise.resolve(CanvasSpriteIcon.loadingPromises.get(url)!);
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
            CanvasSpriteIcon.loadImage(cfg.src).catch(() => undefined);
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

    /**
     * 渲染一串挂件（设计 px 偏移按 spriteScale 应用）。
     *  提取为静态方法以供 `renderDecorator` 复用。
     */
    private static drawDecorators(
        ctx: CanvasRenderingContext2D,
        anchor: SpriteAnchor,
        list: SpriteIconConfig[],
        spriteScale: number,
    ) {
        for (const dec of list) {
            const sX = dec.scale ?? 1;
            const scaleX = dec.scaleX ?? sX;
            const scaleY = dec.scaleY ?? sX;
            // 装饰器尺寸相对主精灵设计尺寸按 scaleX/Y 缩放
            const dW = anchor.drawW * scaleX * spriteScale;
            const dH = anchor.drawH * scaleY * spriteScale;
            const offsetX = (dec.offsetX ?? 0) * spriteScale;
            const offsetY = (dec.offsetY ?? 0) * spriteScale;
            CanvasSpriteIcon.drawSingle(ctx, {
                src: dec.src, x: dec.x, y: dec.y, w: dec.w, h: dec.h,
                canvasX: anchor.canvasX + offsetX,
                canvasY: anchor.canvasY + offsetY,
                canvasW: dW, canvasH: dH,
                overallScale: 1, scaleX: 1, scaleY: 1,
            });
        }
    }

    public render(ctx: CanvasRenderingContext2D, props: CanvasSpriteIconProps) {
        const { src, x, y, w, h, canvasX, canvasY, canvasSize, canvasWidth, canvasHeight, scale = 1.0, decorators = [], renderLayer = 'all' } = props;

        const displayW = canvasWidth ?? canvasSize;
        const displayH = canvasHeight ?? canvasSize;
        const anchor: SpriteAnchor = { canvasX, canvasY, drawW: displayW, drawH: displayH };

        if (renderLayer === 'main' || renderLayer === 'all') {
            CanvasSpriteIcon.drawSingle(ctx, { src, x, y, w, h, canvasX, canvasY, canvasW: displayW, canvasH: displayH, overallScale: scale });
        }

        const low = decorators.filter(d => (d.zIndex ?? 0) < 10).sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
        const high = decorators.filter(d => (d.zIndex ?? 0) >= 10).sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));

        if (renderLayer === 'main' || renderLayer === 'all') CanvasSpriteIcon.drawDecorators(ctx, anchor, low, scale);
        if (renderLayer === 'decorators' || renderLayer === 'all') CanvasSpriteIcon.drawDecorators(ctx, anchor, high, scale);
    }

    /**
     * 单独绘制一个挂件（不画主精灵）——用于"挂件单独覆盖"渲染路径（如 flick 顶部箭头，
     * 主精灵已在第一层画过，第二层只画挂件；旧实现用 renderLayer:'decorators' 是错的，
     * 因为该分支需要主精灵传 decorators 才会触发渲染，直接传挂件当主精灵又丢失 offset）。
     *  挂件的 offsetX/offsetY 是设计 px，会按 spriteScale 应用。
     */
    public renderDecorator(ctx: CanvasRenderingContext2D, anchor: SpriteAnchor, dec: SpriteIconConfig, spriteScale: number) {
        CanvasSpriteIcon.drawDecorators(ctx, anchor, [dec], spriteScale);
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