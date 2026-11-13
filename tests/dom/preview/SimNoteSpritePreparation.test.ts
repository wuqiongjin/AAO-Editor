// @vitest-environment jsdom
// 准备到首绘的集成边界；真实 GPU 行为另由全屏产品路径验收。
import { it, expect, vi } from 'vitest';
import CanvasSpriteIcon, { type SpriteIconConfig } from '@/src/ui/CanvasSpriteIcon';
import { buildActiveNoteIcons, DEFAULT_NOTE_SKIN_SELECTION } from '@/src/rendering/skin/noteSkin';
import { prepareSimNoteSprites } from '@/src/preview/video/sim/prepareSimNoteSprites';

it('chart-preview 68: 准备当前皮肤后，逐轨按住端帽、方向键与挂件首次绘制及全部 mip 均复用缓存', async () => {
    const icons = buildActiveNoteIcons(DEFAULT_NOTE_SKIN_SELECTION);
    const loaded: HTMLImageElement[] = [];
    class FakeImage {
        width = 4096; height = 4096;
        onload?: () => void;
        set src(_url: string) { loaded.push(this as unknown as HTMLImageElement); queueMicrotask(() => this.onload?.()); }
    }
    const createCanvas = vi.fn(() => ({ width: 0, height: 0, getContext: () => ({
        drawImage: vi.fn(), getImageData: () => ({ data: new Uint8ClampedArray([76, 105, 113, 0]) }),
        putImageData: vi.fn(),
    }) }));
    vi.stubGlobal('Image', FakeImage);
    vi.stubGlobal('document', { createElement: createCanvas });
    try {
        await prepareSimNoteSprites(icons);
        expect(loaded.length).toBeGreaterThan(0);
        expect(createCanvas.mock.calls.length).toBeGreaterThan(0);
        createCanvas.mockClear();
        await prepareSimNoteSprites(icons);
        const configs: SpriteIconConfig[] = [];
        for (let lane = 0; lane < 7; lane++) {
            configs.push(icons.tapFor(lane), icons.tapVirtualFor(lane), icons.flickFor(lane), icons.skillFor(lane),
                icons.slideAmongFor(lane), icons.slideEndpointFor(lane), icons.slideEndpointLaneFor(lane));
            for (const side of ['L', 'R'] as const) {
                configs.push(icons.dirLaneFor(side, lane));
                const arrow = icons.dirGroup(side, 3).chevron;
                if (arrow) configs.push(arrow.config);
            }
        }
        if (icons.flickTopDecorator) configs.push(icons.flickTopDecorator);
        if (icons.simultaneousLine) configs.push(icons.simultaneousLine);
        const sprite = new CanvasSpriteIcon();
        const drawImage = vi.fn();
        const ctx = { drawImage } as unknown as CanvasRenderingContext2D;
        for (const config of configs) {
            for (const size of [0.01, 0.1, 1, 4, 16, 64, 512]) {
                sprite.render(ctx, { ...config, canvasX: 100, canvasY: 100, canvasSize: size });
            }
        }
        expect(drawImage.mock.calls.length).toBe(configs.length * 7);
        expect(createCanvas).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
});
