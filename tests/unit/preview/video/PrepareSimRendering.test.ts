// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { prepareSimRendering } from '@/src/preview/video/sim/prepareSimRendering';
import { drawSimFrameAt, type SimFrameInput } from '@/src/preview/video/sim/simField';
import { scoreAt, scoreForHits } from '@/src/preview/video/sim/simHud';

vi.mock('@/src/preview/video/sim/simField', () => ({
  drawSimFrameAt: vi.fn(), prepareSimComboSprites: vi.fn(),
}));

afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

async function preparedScores(hits: number[]) {
  const drawing = { setTransform: vi.fn(), drawImage: vi.fn(), getImageData: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(drawing as unknown as CanvasRenderingContext2D);
  const frame = {
    metrics: { w: 1920, h: 1080 }, assets: { hud: { scoreFill: {} } },
    scene: {}, chart: { elements: [], bands: [], hitTimes: hits },
  } as unknown as SimFrameInput;
  await prepareSimRendering(frame, 1, { yieldNow: async () => {} });
  return vi.mocked(drawSimFrameAt).mock.calls.map(([, , t]) => scoreAt(frame.chart, t));
}

it('播放前覆盖分数条每档的最短和最长填充，同拍的两次命中一起跨档', async () => {
  const hits = Array.from({ length: 100 }, (_, i) => i + 1);
  hits[48] = 48; // 同拍到第 48、49 次；A-S 档的第一个可见分数是 49 万。
  const scores = await preparedScores(hits);
  expect(scores).toEqual(expect.arrayContaining([
    50_000, 60_000, 260_000, 270_000, 470_000, 490_000, 680_000, 690_000, 890_000, 900_000, 1_000_000,
  ]));
});

it('900 次命中的谱面在第 243 次准确跨档，保留紧邻的前一个不同拍点', async () => {
  const hits = Array.from({ length: 900 }, (_, i) => i + 1);
  hits[241] = 243 - 0.0000005;
  const scores = await preparedScores(hits);
  expect(scores).toEqual(expect.arrayContaining([scoreForHits(242, 900), scoreForHits(243, 900)]));
});
