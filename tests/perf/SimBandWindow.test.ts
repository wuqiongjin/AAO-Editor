// 出帧沿用票 80 的公开边界；计数输入时间字段读取，不用易受整机负载影响的毫秒阈值。
import { describe, expect, it } from 'vitest';
import type { ChartNote } from '@/src/chart/types';
import { buildActiveNoteIcons, normalizeNoteSkinSelection } from '@/src/rendering/skin/noteSkin';
import { buildSimChart, drawSimFrameAt, type SimScene } from '@/src/preview/video/sim/simField';
import { emptySimAssets, type SimSprites } from '@/src/preview/video/sim/simAssets';
import { fieldMetrics } from '@/src/preview/video/sim/simGeometry';
import type CanvasSpriteIcon from '@/src/ui/CanvasSpriteIcon';
import { makeRecordingCtx } from '@/tests/support/canvas';

const icons = buildActiveNoteIcons(normalizeNoteSkinSelection({}));

describe('仿真场带体 · 播放窗口工作量', () => {
  it('长谱连续出帧和任意 seek 时，带体与按住特效不逐帧读取整张段表', () => {
    const notes: ChartNote[] = Array.from({ length: 16_000 }, (_, i) => ({
      type: 'Slide', connections: [{ beat: i * 4, lane: 3 }, { beat: i * 4 + 2, lane: 3 }],
    }));
    const scene: SimScene = {
      notes, beatDisplay: 4, noteSpeed: 9.5, noteSize: 1, slideOpacity: 0.8,
      simultaneousClickLines: false, colorAssist: false, mirror: false,
    };
    const chart = buildSimChart(scene, icons);
    let reads = 0;
    for (const band of chart.bands) {
      for (const key of ['t0', 't1'] as const) {
        const value = band[key];
        Object.defineProperty(band, key, { get: () => { reads++; return value; } });
      }
    }
    const img = { width: 1024, height: 1024 } as HTMLImageElement;
    const sprites = { particles: img, combo: img, digits: img } as SimSprites;
    const spriteIcon = { render: () => undefined, renderDecorator: () => undefined } as unknown as CanvasSpriteIcon;
    const frame = { chart, scene, metrics: fieldMetrics(1334, 750), assets: { ...emptySimAssets(), sprites }, noteIcons: icons, spriteIcon };
    // 正播、跨到末段、回跳与同一秒重画都走真实出帧，不能依赖只前进的游标。
    for (const seconds of [16000.5, 16000.6, 31000.5, 0.5, 16000.5]) {
      reads = 0;
      const { proxy } = makeRecordingCtx({
        createLinearGradient: () => ({ addColorStop: () => undefined }),
        createRadialGradient: () => ({ addColorStop: () => undefined }),
      });
      drawSimFrameAt(proxy, frame, seconds);
      expect(reads).toBeLessThan(2000);
    }
  });
});
