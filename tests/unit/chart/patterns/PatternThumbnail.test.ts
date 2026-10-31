// issue 185 锁测：缩略图取景（布局轴，含倒流折返）与画法。
// 取景是纯函数（无 DOM）；Canvas 像素本身由浏览器实测（单测拿不到真实像素），
// 这里锁"倒流片段的两条臂在 y 上真的折返"——正是 ADR-0023 Consequences 点名的那条。
import { describe, expect, it } from 'vitest';
import { buildPatternThumbnailScene, drawPatternThumbnail, THUMBNAIL_COLORS } from '@/src/chart/patterns/thumbnail';
import { makeRecordingCtx, propValues } from '@/tests/support/canvas';
import { makePattern } from '@/tests/support/patterns';

const SIZE = { w: 200, h: 100 };

/** 倒流片段：0→2 拍正着走、2 拍处 BPM 翻成 -120，后两拍折回来，终点与起点同高 */
const backflowPattern = makePattern({
  notes: [{
    type: 'Slide',
    connections: [
      { beat: 0, lane: 0 },
      { beat: 2, lane: 3 },
      { beat: 4, lane: 6 },
    ],
  }],
  bpmContext: { startBpm: 120, events: [{ deltaBeat: 2, bpm: -120 }] },
});

describe('issue 185 · 缩略图取景（布局轴）', () => {
  it('倒流片段折返：首尾结点同高，中间结点在更上方（beat 归一化会把这条压平）', () => {
    const scene = buildPatternThumbnailScene(backflowPattern, SIZE);
    const span = scene.spans[0]!;
    expect(span).toHaveLength(3);

    const [start, peak, end] = span as [typeof span[0], typeof span[0], typeof span[0]];
    // 折返：第 4 拍折回第 0 拍同一条布局线
    expect(end.y).toBeCloseTo(start.y, 6);
    // 折返不是"压平"：中段仍爬到高处
    expect(peak.y).toBeLessThan(start.y);
    // 横向照常前进（起 0 轨 → 中 3 轨 → 终 6 轨）
    expect(peak.x).toBeGreaterThan(start.x);
    expect(end.x).toBeGreaterThan(peak.x);
  });

  it('倒流片段仍按整段高度取景：顶点贴内边距，折回处贴另一侧', () => {
    const scene = buildPatternThumbnailScene(backflowPattern, SIZE);
    const span = scene.spans[0]!;
    const ys = span.map((point) => point.y);
    expect(Math.min(...ys)).toBeCloseTo(5, 6);   // PAD_Y
    expect(Math.max(...ys)).toBeCloseTo(95, 6);  // SIZE.h - PAD_Y
  });

  it('单调片段：早的在下、晚的在上（画布同一方向）', () => {
    const pattern = makePattern({
      notes: [
        { type: 'Single', beat: 0, lane: 0 },
        { type: 'Single', beat: 2, lane: 6 },
      ],
      bpmContext: { startBpm: 120, events: [] },
    });
    const scene = buildPatternThumbnailScene(pattern, SIZE);
    expect(scene.taps).toHaveLength(2);
    expect(scene.taps[0]!.y).toBeCloseTo(95, 6);
    expect(scene.taps[1]!.y).toBeCloseTo(5, 6);
    expect(scene.taps[1]!.x).toBeGreaterThan(scene.taps[0]!.x);
  });

  it('单个音符落下时居中（不贴边）', () => {
    const scene = buildPatternThumbnailScene(makePattern(), SIZE);
    expect(scene.taps).toHaveLength(1);
    expect(scene.taps[0]!.y).toBeCloseTo(SIZE.h / 2, 6);
  });

  it('车道铺满内容宽、7 条有序不重叠', () => {
    const scene = buildPatternThumbnailScene(makePattern(), SIZE);
    expect(scene.lanes).toHaveLength(7);
    for (let i = 1; i < scene.lanes.length; i++) {
      expect(scene.lanes[i]!.x).toBeGreaterThan(scene.lanes[i - 1]!.x);
    }
    expect(scene.lanes[0]!.x).toBeGreaterThanOrEqual(0);
    expect(scene.lanes[6]!.x + scene.lanes[6]!.w).toBeLessThanOrEqual(SIZE.w);
  });

  it('方向键画成整组横线；BPM 事件给参考线', () => {
    const pattern = makePattern({
      notes: [{ type: 'RDirectional', beat: 0, lane: 1, length: 3 }],
      bpmContext: { startBpm: 120, events: [{ deltaBeat: 1, bpm: 200 }] },
    });
    const scene = buildPatternThumbnailScene(pattern, SIZE);
    expect(scene.bars).toHaveLength(1);
    expect(scene.bars[0]!.x2).toBeGreaterThan(scene.bars[0]!.x1);
    expect(scene.bpmLines).toHaveLength(1);
  });

  it('空片段给出空场景（只有车道底），不抛错', () => {
    const scene = buildPatternThumbnailScene(makePattern({ notes: [] }), SIZE);
    expect(scene.lanes).toHaveLength(7);
    expect(scene.taps).toEqual([]);
    expect(scene.spans).toEqual([]);
    expect(scene.bars).toEqual([]);
  });

  it('BPM / System 不进缩略图（片段载荷里本就不该有，防脏数据画出幽灵）', () => {
    const pattern = makePattern({
      notes: [
        { type: 'BPM', beat: 0, bpm: 120 },
        { type: 'System', beat: 1, data: 'x' },
      ],
    });
    const scene = buildPatternThumbnailScene(pattern, SIZE);
    expect(scene.taps).toEqual([]);
    expect(scene.spans).toEqual([]);
  });
});

describe('issue 185 · 缩略图画法', () => {
  it('铺底 + 车道 + 音符都落到上下文里', () => {
    const { proxy, calls } = makeRecordingCtx();
    const scene = buildPatternThumbnailScene(makePattern(), SIZE);
    drawPatternThumbnail(proxy, scene, SIZE);

    // 1 次底色 + 7 条车道 + 1 个音符
    const fills = calls.filter(([key]) => key === 'fillRect');
    expect(fills).toHaveLength(1 + 7 + 1);
    expect(propValues(calls, 'fillStyle')).toContain(THUMBNAIL_COLORS.background);
    expect(propValues(calls, 'fillStyle')).toContain(THUMBNAIL_COLORS.note);
  });

  it('滑条走折线（moveTo + lineTo），不是一个个孤立方块', () => {
    const { proxy, calls } = makeRecordingCtx();
    const scene = buildPatternThumbnailScene(backflowPattern, SIZE);
    drawPatternThumbnail(proxy, scene, SIZE);
    // 折线 = 首点 moveTo + 2 个 lineTo；BPM 参考线各占一次 moveTo + lineTo
    const bpmLines = scene.bpmLines.length;
    expect(bpmLines).toBe(1);
    expect(calls.filter(([key]) => key === 'moveTo')).toHaveLength(1 + bpmLines);
    expect(calls.filter(([key]) => key === 'lineTo')).toHaveLength(2 + bpmLines);
    expect(calls.some(([key]) => key === 'stroke')).toBe(true);
    expect(propValues(calls, 'strokeStyle')).toContain(THUMBNAIL_COLORS.span);
  });
});
