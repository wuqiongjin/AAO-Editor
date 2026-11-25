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

it('票 88 · 窗口小尺寸首进预热时，仍额外覆盖 >=1920 物理像素宽的分数条跨档着色器分支', async () => {
  const calls: { sx: number; score: number }[] = [];
  const origCreate = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    const el = origCreate(tag);
    if (tag === 'canvas') {
      const drawing = {
        _lastSx: 0,
        setTransform: (a: number) => { drawing._lastSx = a; },
        drawImage: () => undefined,
        getImageData: () => ({ data: new Uint8ClampedArray(4) }),
      };
      vi.spyOn(el as HTMLCanvasElement, 'getContext').mockReturnValue(drawing as unknown as CanvasRenderingContext2D);
    }
    return el;
  }) as typeof document.createElement);
  vi.mocked(drawSimFrameAt).mockImplementation((_ctx, f, t) => {
    calls.push({
      sx: (_ctx as unknown as { _lastSx?: number })._lastSx ?? 0,
      score: scoreAt(f.chart, t),
    });
  });

  const hits = Array.from({ length: 100 }, (_, i) => i + 1);
  const frame = {
    metrics: { w: 1128, h: 634 },
    assets: { hud: { scoreFill: {} } },
    scene: {},
    chart: { elements: [], bands: [], hitTimes: hits },
  } as unknown as SimFrameInput;

  await prepareSimRendering({ ...frame, scene: { showGameUi: false } }, 1.25, { yieldNow: async () => {} });
  // 既有窗口尺寸 1410x793 要走完，且即使初始 showGameUi=false 也在物理宽 >= 1920 的缓冲上完成 scoreFill 跨档预热
  expect(calls.some((c) => Math.round(c.sx * frame.metrics.w) >= 1920 && c.score >= 600_000 && c.score < 700_000)).toBe(true);
});
