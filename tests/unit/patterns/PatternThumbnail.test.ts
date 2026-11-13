// issue 185 锁测：缩略图取景（布局轴，含倒流折返）与画法（真实音符皮肤）。
// 取景是纯几何；"画成什么样"这一层用记录型 sprite 替身 + 真实皮肤图标集来锁 ——
// Canvas 像素本身仍由浏览器实测（单测拿不到真实像素）。
import { describe, expect, it } from 'vitest';
import { buildPatternThumbnailScene } from '@/src/patterns/thumbnail';
import { drawPatternThumbnail, THUMBNAIL_COLORS } from '@/src/patterns/thumbnailPaint';
import { buildActiveNoteIcons, DEFAULT_NOTE_SKIN_SELECTION } from '@/src/rendering/skin/noteSkin';
import type { SpriteIconConfig } from '@/src/ui/CanvasSpriteIcon';
import { makeRecordingCtx, propValues } from '@/tests/support/canvas';
import { makePattern } from '@/tests/support/patterns';

const SIZE = { w: 200, h: 100 };
const icons = buildActiveNoteIcons(DEFAULT_NOTE_SKIN_SELECTION);

/** 记录型 sprite：只收 render / renderDecorator 的入参，不画 */
function recordingSprite() {
  const rendered: SpriteIconConfig[] = [];
  const decorated: SpriteIconConfig[] = [];
  return {
    rendered,
    decorated,
    sprite: {
      render: (_ctx: CanvasRenderingContext2D, props: SpriteIconConfig) => { rendered.push(props); },
      renderDecorator: (_ctx: CanvasRenderingContext2D, _anchor: unknown, dec: SpriteIconConfig) => {
        decorated.push(dec);
      },
    },
  };
}

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
    const span = scene.spans[0]!.points;
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
    const ys = scene.spans[0]!.points.map((point) => point.y);
    expect(Math.min(...ys)).toBeCloseTo(5, 6);   // PAD_Y
    expect(Math.max(...ys)).toBeCloseTo(95, 6);  // SIZE.h - PAD_Y
  });

  it('滑条结点与折线同点：端点标 first/last，hidden 不出点', () => {
    const scene = buildPatternThumbnailScene(backflowPattern, SIZE);
    expect(scene.slideMarks).toHaveLength(3);
    expect(scene.slideMarks[0]!.endpoint).toBe('first');
    expect(scene.slideMarks[2]!.endpoint).toBe('last');
    expect(scene.slideMarks[1]!.endpoint).toBeUndefined();

    const withHidden = buildPatternThumbnailScene(makePattern({
      notes: [{ type: 'Slide', connections: [
        { beat: 0, lane: 0 }, { beat: 1, lane: 1, hidden: true }, { beat: 2, lane: 2 },
      ] }],
    }), SIZE);
    expect(withHidden.slideMarks).toHaveLength(2); // hidden 不画图标，带体仍穿过它
    expect(withHidden.spans[0]!.points).toHaveLength(3);
    // SP 材质整条传染（ADR-0009 §5 / issue 157）：有一条 hidden 就整条走 slideBandSp
    expect(withHidden.spans[0]!.sp).toBe(true);
    expect(buildPatternThumbnailScene(backflowPattern, SIZE).spans[0]!.sp).toBe(false);
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
    expect(scene.keyMarks).toHaveLength(2);
    expect(scene.keyMarks[0]!.y).toBeCloseTo(95, 6);
    expect(scene.keyMarks[1]!.y).toBeCloseTo(5, 6);
    expect(scene.keyMarks[1]!.x).toBeGreaterThan(scene.keyMarks[0]!.x);
  });

  it('单个音符落下时居中（不贴边）', () => {
    const scene = buildPatternThumbnailScene(makePattern(), SIZE);
    expect(scene.keyMarks).toHaveLength(1);
    expect(scene.keyMarks[0]!.y).toBeCloseTo(SIZE.h / 2, 6);
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

  it('方向键只出一个组锚点（组合形态交给 renderDirGroup）；BPM 事件给参考线', () => {
    const pattern = makePattern({
      notes: [{ type: 'RDirectional', beat: 0, lane: 1, length: 3 }],
      bpmContext: { startBpm: 120, events: [{ deltaBeat: 1, bpm: 200 }] },
    });
    const scene = buildPatternThumbnailScene(pattern, SIZE);
    expect(scene.keyMarks).toHaveLength(1);
    expect(scene.keyMarks[0]!.dirSide).toBe('R');
    expect(scene.keyMarks[0]!.dirLength).toBe(3);
    expect(scene.keyMarks[0]!.lane).toBe(1);
    expect(scene.bpmLines).toHaveLength(1);
  });

  it('空片段给出空场景（只有车道底），不抛错', () => {
    const scene = buildPatternThumbnailScene(makePattern({ notes: [] }), SIZE);
    expect(scene.lanes).toHaveLength(7);
    expect(scene.keyMarks).toEqual([]);
    expect(scene.slideMarks).toEqual([]);
    expect(scene.spans).toEqual([]);
  });

  it('BPM / System 不进缩略图（片段载荷里本就不该有，防脏数据画出幽灵）', () => {
    const scene = buildPatternThumbnailScene(makePattern({
      notes: [
        { type: 'BPM', beat: 0, bpm: 120 },
        { type: 'System', beat: 1, data: 'x' },
      ],
    }), SIZE);
    expect(scene.keyMarks).toEqual([]);
    expect(scene.spans).toEqual([]);
  });
});

describe('issue 185 · 缩略图画法（真实音符皮肤）', () => {
  it('单键 = 当前皮肤的 tap 精灵；滑键 / 技能键各取自己的精灵（不是自绘方块）', () => {
    const pattern = makePattern({
      notes: [
        { type: 'Single', beat: 0, lane: 3 },
        { type: 'Single', beat: 1, lane: 2, flick: true },
        { type: 'Single', beat: 2, lane: 4, skill: true },
      ],
      bpmContext: { startBpm: 120, events: [] },
    });
    const { proxy } = makeRecordingCtx();
    const { rendered, sprite } = recordingSprite();
    drawPatternThumbnail(proxy, buildPatternThumbnailScene(pattern, SIZE), SIZE, { icons, sprite });

    expect(rendered).toHaveLength(3);
    const tap = icons.tapFor(3);
    const flick = icons.flickFor(2);
    const skill = icons.skillFor(4);
    // 逐项比对源矩形：缩略图贴的就是画布同一张精灵
    for (const [actual, expected] of [[rendered[0], tap], [rendered[1], flick], [rendered[2], skill]] as const) {
      expect(actual!.src).toBe(expected.src);
      expect([actual!.x, actual!.y, actual!.w, actual!.h]).toEqual([expected.x, expected.y, expected.w, expected.h]);
    }
  });

  it('滑条结点走端帽 / 中间结点款；方向键走整组组合（N 条本体 + 外侧箭头）', () => {
    const backflowScene = buildPatternThumbnailScene(backflowPattern, SIZE);
    const { proxy } = makeRecordingCtx();
    const { rendered, sprite } = recordingSprite();
    drawPatternThumbnail(proxy, backflowScene, SIZE, { icons, sprite });

    const first = icons.slideEndpointFor(0);
    const among = icons.slideAmongFor(3);
    expect(rendered[0]!.src).toBe(first.src);
    expect(rendered[1]!.src).toBe(among.src);

    const dirScene = buildPatternThumbnailScene(makePattern({
      notes: [{ type: 'RDirectional', beat: 0, lane: 1, length: 2 }],
    }), SIZE);
    const dir = recordingSprite();
    drawPatternThumbnail(proxy, dirScene, SIZE, { icons, sprite: dir.sprite });
    const group = icons.dirGroup('R', 2);
    // 组内每条覆盖轨一枚本体 + 最外侧箭头（箭头存在时多一次 render）
    expect(dir.rendered).toHaveLength(group.bodies.length + (group.chevron ? 1 : 0));
    expect(dir.rendered[0]!.src).toBe(group.bodies[0]!.config.src);
    // 组内本体**横向铺开**（不是叠在同一个 x 上）
    expect(dir.rendered[1]!.canvasX).toBeGreaterThan(dir.rendered[0]!.canvasX);
  });

  it('精灵按固定小尺寸贴（不随纵向压缩变形）；铺底与车道照画', () => {
    const { proxy, calls } = makeRecordingCtx();
    const { rendered, sprite } = recordingSprite();
    drawPatternThumbnail(proxy, buildPatternThumbnailScene(makePattern(), SIZE), SIZE, { icons, sprite });

    expect(rendered).toHaveLength(1);
    expect(rendered[0]!.canvasWidth).toBe(rendered[0]!.canvasSize);
    expect(rendered[0]!.canvasHeight).toBeCloseTo(rendered[0]!.canvasSize! * 0.6, 6);
    expect(rendered[0]!.canvasSize).toBeGreaterThanOrEqual(9);
    expect(rendered[0]!.canvasSize).toBeLessThanOrEqual(13);

    const fills = calls.filter(([key]) => key === 'fillRect');
    expect(fills).toHaveLength(1 + 7); // 底色 + 7 条车道（音符走精灵，不占 fillRect）
    expect(propValues(calls, 'fillStyle')).toContain(THUMBNAIL_COLORS.background);
  });

  it('滑条段是真带体多边形（不是一根细线）：回折处切成两段各填一次', () => {
    const { proxy, calls } = makeRecordingCtx();
    const { sprite } = recordingSprite();
    const scene = buildPatternThumbnailScene(backflowPattern, SIZE);
    drawPatternThumbnail(proxy, scene, SIZE, { icons, sprite });

    // 两段 → 两次 fill()，每段一个四边形（1 个 moveTo + 3 个 lineTo）
    expect(calls.filter(([key]) => key === 'fill')).toHaveLength(2);
    expect(calls.filter(([key]) => key === 'moveTo')).toHaveLength(2 + scene.bpmLines.length);
    expect(calls.filter(([key]) => key === 'lineTo')).toHaveLength(6 + scene.bpmLines.length);
    expect(propValues(calls, 'fillStyle')).toContain(THUMBNAIL_COLORS.span);

    // 带体半宽 ≈ 车道半宽：两段四边形的 x 明显跨过中心线（不是 2px 细线）
    const xs = calls.filter(([key]) => key === 'lineTo').map(([, args]) => Number(args[0]));
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(SIZE.w * 0.5);
  });

  it('flick 顶部箭头：单键与滑条端点各补一次，方向键不补', () => {
    const pattern = makePattern({
      notes: [
        { type: 'Single', beat: 0, lane: 1, flick: true },
        { type: 'Slide', connections: [{ beat: 1, lane: 2, flick: true }, { beat: 2, lane: 3 }] },
        { type: 'RDirectional', beat: 0, lane: 5, length: 2, flick: true },
      ],
      bpmContext: { startBpm: 120, events: [] },
    });
    const { proxy } = makeRecordingCtx();
    const { decorated, sprite } = recordingSprite();
    drawPatternThumbnail(proxy, buildPatternThumbnailScene(pattern, SIZE), SIZE, { icons, sprite });

    // 单键 1 次 + 滑条端点 1 次；方向键的箭头是组合件，不额外补
    expect(decorated).toHaveLength(2);
    expect(decorated[0]!.src).toBe(icons.flickTopDecorator!.src);
  });
});
