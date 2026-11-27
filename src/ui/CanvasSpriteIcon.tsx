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
import {
    getDecoupledSprite,
    getDecoupledSpriteByRect,
    getDecoupledDrawSource,
    getDecoupledMipLevel,
    decoupledMipLevelFor,
    packDecoupledSprites,
    type DecoupledSprite,
} from './spriteDecoupling';
import { MIP_MIN_DIM, mipLevelFor, mipDims } from './canvasSpriteMips';

/** 预热 mip 链的默认最大级数（覆盖 2048×1024 图集在动态预览远处 depth≈0.1 与工作台最小缩放下的全部采样级 1..5） */
export const PREWARM_MIP_LEVEL = 5;

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
    /** 票 88：同帧多音符由调用方缓存并传入 CTM 缩放因子，免去每音符调 ctx.getTransform() 分配 DOMMatrix */
    ctxScale?: number;
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
    /** issue 96：源图逐级减半位图链（[原图, 1/2, 1/4, …]，按需增量构建）。弱键随源图释放，防大图集常驻 */
    private static mipChains: WeakMap<HTMLImageElement, CanvasImageSource[]> = new WeakMap();

    /**
     * 取第 L 级减半位图（增量构建：级 i 由级 i−1 再减半得到）。
     * 任何失败（无 DOM / canvas 不可用 / 绘制异常）→ null，调用方原图直绘兜底（vitest node 环境即走此路）。
     */
    private static getMipLevelSource(
        img: HTMLImageElement,
        level: number,
        createCanvas?: () => HTMLCanvasElement | null,
    ): CanvasImageSource | null {
        if (level <= 0) return null;
        try {
            let chain = CanvasSpriteIcon.mipChains.get(img);
            if (chain && chain[level]) return chain[level]!;
            if (!createCanvas && typeof document === 'undefined') return null;
            if (!chain) { chain = [img]; CanvasSpriteIcon.mipChains.set(img, chain); }
            for (let i = chain.length; i <= level; i++) {
                const prev = chain[i - 1];
                const pw = (prev as { width: number }).width;
                const ph = (prev as { height: number }).height;
                const { w, h } = mipDims(pw, ph, 1);
                const cv = createCanvas ? createCanvas() : document.createElement('canvas');
                if (!cv) return null;
                cv.width = w; cv.height = h;
                const cctx = cv.getContext('2d');
                if (!cctx) return null;
                cctx.imageSmoothingEnabled = true;
                cctx.imageSmoothingQuality = 'high';
                cctx.drawImage(prev, 0, 0, pw, ph, 0, 0, w, h);
                chain.push(cv);
            }
            return chain[level] ?? null;
        } catch {
            return null;
        }
    }

    /**
     * 预热源图的 mip 位图链（issue 179 / chart-preview 57）：
     * 在图片加载完成时一次性把 1..maxLevel 级减半位图构建完毕（顺带触发源图首次 drawImage GPU 上传），
     * 消除动态预览首音符在远处入场（depth≈0.1→1.0 连续跨越 level 4→3→2→1）或工作台音符瓦片首次构建时
     * 在播放 rAF 帧内同步 allocate + high-quality 降采样大图集的突发卡顿。
     */
    public static warmupImageMips(
        img: HTMLImageElement,
        maxLevel = PREWARM_MIP_LEVEL,
        createCanvas?: () => HTMLCanvasElement | null,
    ): void {
        const w = img.width || img.naturalWidth;
        const h = img.height || img.naturalHeight;
        if (!(w > 0) || !(h > 0) || maxLevel <= 0) return;
        const cap = Math.floor(Math.log2(Math.min(w, h) / MIP_MIN_DIM));
        const target = Math.max(0, Math.min(maxLevel, cap));
        if (target > 0) {
            CanvasSpriteIcon.getMipLevelSource(img, target, createCanvas);
        }
    }

    public static ensureImagesLoaded(urls: string[]): Promise<void[]> {
        const ps = urls.map(u => CanvasSpriteIcon.loadImage(u).then(() => undefined));
        return Promise.all(ps);
    }

    /** 检查这批皮肤图片是否全部已解码就绪，避免重复挂载静态预览时白刷一次 skinVersion 重绘面板 */
    public static areImagesReady(urls: readonly string[]): boolean {
        return urls.every(
            (u) => CanvasSpriteIcon.imageCache.has(u) && !CanvasSpriteIcon.loadingPromises.has(u),
        );
    }

    /** 准备实际绘制使用的独立切片，共用 drawSingle 的裁剪、清洗、padding 与缓存。 */
    public static async ensureSpritesLoaded(configs: readonly SpriteIconConfig[]): Promise<void> {
        const bySource = new Map<string, SpriteIconConfig[]>();
        for (const cfg of configs) {
            const list = bySource.get(cfg.src) ?? [];
            list.push(cfg);
            bySource.set(cfg.src, list);
        }
        const prepared: DecoupledSprite[] = [];
        const results = await Promise.allSettled([...bySource].map(async ([src, list]) => {
            const img = await CanvasSpriteIcon.loadImage(src);
            for (const cfg of list) {
                const rect = CanvasSpriteIcon.computeSrcRect(img, cfg);
                if (!rect || rect.sw <= 0 || rect.sh <= 0) continue;
                const sprite = getDecoupledSprite(img, { x: rect.sx, y: rect.sy, w: rect.sw, h: rect.sh });
                if (sprite) {
                    // 与 decoupledMipLevelFor 的尺寸上限一致，覆盖任意透视深度/画布密度。
                    getDecoupledMipLevel(sprite, Math.floor(Math.log2(Math.min(rect.sw, rect.sh))));
                    prepared.push(sprite);
                }
            }
        }));
        packDecoupledSprites(prepared);
        // 缺图时仍等待其他源的准备结束，调用方才可安全进入降级播放。
        const failed = results.find(result => result.status === 'rejected');
        if (failed?.status === 'rejected') throw failed.reason;
    }

    private static loadImage(url: string): Promise<HTMLImageElement> {
        if (CanvasSpriteIcon.loadingPromises.has(url)) {
            return Promise.resolve(CanvasSpriteIcon.loadingPromises.get(url)!);
        }
        if (CanvasSpriteIcon.imageCache.has(url)) {
            return Promise.resolve(CanvasSpriteIcon.imageCache.get(url)!);
        }

        const p = new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                CanvasSpriteIcon.imageCache.set(url, img);
                const finish = () => {
                    CanvasSpriteIcon.loadingPromises.delete(url);
                    resolve(img);
                };
                if (typeof img.decode === 'function') {
                    img.decode().catch(() => undefined).then(finish);
                } else {
                    finish();
                }
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

    public static getCachedImage(url: string): HTMLImageElement | null {
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

    private static drawSinglePos(
        ctx: CanvasRenderingContext2D,
        src: string,
        x: number,
        y: number,
        w: number,
        h: number,
        canvasX: number,
        canvasY: number,
        canvasW: number,
        canvasH: number,
        overallScale: number,
        scaleX: number,
        scaleY: number,
        ctxScaleArg: number | undefined,
        skipSmoothingRestore: boolean,
    ): boolean {
        if (w === 0 || h === 0) return false;
        const img = CanvasSpriteIcon.getCachedImage(src);
        if (!img) {
            CanvasSpriteIcon.loadImage(src).catch(() => undefined);
            return false;
        }
        const srcX = Math.max(0, Math.min(img.width, x));
        const srcY = Math.max(0, Math.min(img.height, y));
        const srcW = Math.max(0, Math.min(img.width - srcX, w));
        const srcH = Math.max(0, Math.min(img.height - srcY, h));
        if (srcW <= 0 || srcH <= 0) return false;

        const dW = canvasW * scaleX * overallScale;
        const dH = canvasH * scaleY * overallScale;
        // issue 98：绘制位置不做整像素对齐——音符锚点为浮点且随缩放连续变化，
        // 取整会使缩放/滚动时图标位置逐帧重掷 ±0.5px（相对网格跳动）。
        const dx = canvasX - dW / 2;
        const dy = canvasY - dH / 2;

        let ctxScale = ctxScaleArg ?? 1;
        if (ctxScaleArg == null) {
            try {
                const t = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null;
                ctxScale = t ? (Math.hypot(t.a, t.b) || 1) : 1;
            } catch { /* getTransform 不可用等 */ }
        }

        let prevEnabled: boolean | undefined;
        let prevQuality: ImageSmoothingQuality | undefined;
        if (!skipSmoothingRestore) {
            prevEnabled = ctx.imageSmoothingEnabled;
            prevQuality = ctx.imageSmoothingQuality;
            if (!prevEnabled) ctx.imageSmoothingEnabled = true;
            if (prevQuality !== 'high') ctx.imageSmoothingQuality = 'high';
        }

        try {
            // issue 222（抗畸变根治）：尝试使用带 4px 纯净 Padding 的独立解耦图元位图及专属 Mip 链
            // 彻底消除整张大图集全局降采样导致的邻近精灵渗色与背景深青色杂色污染（Atlas Bleeding）
            const decoupled = getDecoupledSpriteByRect(img, srcX, srcY, srcW, srcH);
            if (decoupled) {
                const decoupledLevel = decoupledMipLevelFor(srcW, srcH, dW * ctxScale, dH * ctxScale);
                const drawSrc = getDecoupledDrawSource(decoupled, decoupledLevel);
                try {
                    ctx.drawImage(drawSrc.source, drawSrc.sx, drawSrc.sy, drawSrc.sw, drawSrc.sh, dx, dy, dW, dH);
                } catch (e) {
                    console.warn('[CanvasSpriteIcon] drawImage decoupled failed', e);
                }
                return true;
            }

            // 无 DOM 或解耦不可用时（node 单元测试环境等）原图直绘兜底
            let level = 0;
            try {
                level = mipLevelFor(srcW, srcH, dW * ctxScale, dH * ctxScale);
            } catch { /* 保持 0 */ }
            let source: CanvasImageSource = img;
            try {
                if (level > 0) {
                    const mip = CanvasSpriteIcon.getMipLevelSource(img, level);
                    if (mip) source = mip;
                }
            } catch { /* 原图直绘 */ }
            const mipW = (source as { width: number }).width;
            const mipH = (source as { height: number }).height;
            const kx = mipW / img.width;
            const ky = mipH / img.height;
            const sxL = Math.max(0, Math.min(mipW, srcX * kx));
            const syL = Math.max(0, Math.min(mipH, srcY * ky));
            const swL = Math.max(1, Math.min(mipW - sxL, srcW * kx));
            const shL = Math.max(1, Math.min(mipH - syL, srcH * ky));

            try {
                ctx.drawImage(source, sxL, syL, swL, shL, dx, dy, dW, dH);
            } catch (e) {
                console.warn('[CanvasSpriteIcon] drawImage failed', e);
            }
            return true;
        } finally {
            if (!skipSmoothingRestore) {
                if (prevQuality !== undefined && ctx.imageSmoothingQuality !== prevQuality) {
                    ctx.imageSmoothingQuality = prevQuality;
                }
                if (prevEnabled !== undefined && ctx.imageSmoothingEnabled !== prevEnabled) {
                    ctx.imageSmoothingEnabled = prevEnabled;
                }
            }
        }
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
        ctxScale?: number,
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
            CanvasSpriteIcon.drawSinglePos(
                ctx, dec.src, dec.x, dec.y, dec.w, dec.h,
                anchor.canvasX + offsetX, anchor.canvasY + offsetY,
                dW, dH, 1, 1, 1, ctxScale, false,
            );
        }
    }

    public render(ctx: CanvasRenderingContext2D, props: CanvasSpriteIconProps) {
        const { src, x, y, w, h, canvasX, canvasY, canvasSize, canvasWidth, canvasHeight, scale = 1.0, ctxScale, decorators, renderLayer = 'all' } = props;

        const displayW = canvasWidth ?? canvasSize;
        const displayH = canvasHeight ?? canvasSize;

        if (renderLayer === 'main' || renderLayer === 'all') {
            CanvasSpriteIcon.drawSinglePos(ctx, src, x, y, w, h, canvasX, canvasY, displayW, displayH, scale, 1, 1, ctxScale, false);
        }

        if (!decorators || decorators.length === 0) return;
        const anchor: SpriteAnchor = { canvasX, canvasY, drawW: displayW, drawH: displayH };
        const low = decorators.filter(d => (d.zIndex ?? 0) < 10).sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
        const high = decorators.filter(d => (d.zIndex ?? 0) >= 10).sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));

        if (renderLayer === 'main' || renderLayer === 'all') CanvasSpriteIcon.drawDecorators(ctx, anchor, low, scale, ctxScale);
        if (renderLayer === 'decorators' || renderLayer === 'all') CanvasSpriteIcon.drawDecorators(ctx, anchor, high, scale, ctxScale);
    }

    /**
     * 票 89：仿真场热循环专用的零分配快速绘制入口（调用方已统一守护 `imageSmoothingQuality='high'` 时可跳过逐音符 DOM 属性读写）。
     */
    public renderSim(
        ctx: CanvasRenderingContext2D,
        cfg: SpriteIconConfig,
        canvasX: number,
        canvasY: number,
        canvasW: number,
        canvasH: number,
        scale: number,
        ctxScale: number,
        skipSmoothingRestore = true,
    ): void {
        CanvasSpriteIcon.drawSinglePos(
            ctx, cfg.src, cfg.x, cfg.y, cfg.w, cfg.h,
            canvasX, canvasY, canvasW, canvasH,
            scale, cfg.scaleX ?? 1, cfg.scaleY ?? 1, ctxScale, skipSmoothingRestore,
        );
    }

    /** 票 89：仿真场挂件零分配快速绘制入口。 */
    public renderSimDecorator(
        ctx: CanvasRenderingContext2D,
        anchorX: number,
        anchorY: number,
        drawW: number,
        drawH: number,
        dec: SpriteIconConfig,
        spriteScale: number,
        ctxScale: number,
        skipSmoothingRestore = true,
    ): void {
        const sX = dec.scale ?? 1;
        const scaleX = dec.scaleX ?? sX;
        const scaleY = dec.scaleY ?? sX;
        const dW = drawW * scaleX * spriteScale;
        const dH = drawH * scaleY * spriteScale;
        const offsetX = (dec.offsetX ?? 0) * spriteScale;
        const offsetY = (dec.offsetY ?? 0) * spriteScale;
        CanvasSpriteIcon.drawSinglePos(
            ctx, dec.src, dec.x, dec.y, dec.w, dec.h,
            anchorX + offsetX, anchorY + offsetY,
            dW, dH, 1, 1, 1, ctxScale, skipSmoothingRestore,
        );
    }

    /**
     * 单独绘制一个挂件（不画主精灵）——用于"挂件单独覆盖"渲染路径（如 flick 顶部箭头，
     * 主精灵已在第一层画过，第二层只画挂件；旧实现用 renderLayer:'decorators' 是错的，
     * 因为该分支需要主精灵传 decorators 才会触发渲染，直接传挂件当主精灵又丢失 offset）。
     *  挂件的 offsetX/offsetY 是设计 px，会按 spriteScale 应用。
     */
    public renderDecorator(ctx: CanvasRenderingContext2D, anchor: SpriteAnchor, dec: SpriteIconConfig, spriteScale: number, ctxScale?: number) {
        CanvasSpriteIcon.drawSinglePos(
            ctx, dec.src, dec.x, dec.y, dec.w, dec.h,
            anchor.canvasX + (dec.offsetX ?? 0) * spriteScale,
            anchor.canvasY + (dec.offsetY ?? 0) * spriteScale,
            anchor.drawW * (dec.scaleX ?? dec.scale ?? 1) * spriteScale,
            anchor.drawH * (dec.scaleY ?? dec.scale ?? 1) * spriteScale,
            1, 1, 1, ctxScale, false,
        );
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
