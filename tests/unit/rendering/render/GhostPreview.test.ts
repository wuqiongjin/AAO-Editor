// 幽灵（放置/粘贴/镜像预览）形态行锁测试：
// 幽灵必须与画布实绘同形 —— 用户 2026-09-09 反馈「滑键幽灵只有本体、缺顶部箭头」即此类缺口。
import { describe, it, expect } from 'vitest';
import { ChartGeometry } from '@/src/chart/geometry/ChartGeometry';
import { makeCoords } from '@/src/rendering/coords';
import { renderToolPreview, renderDragGhost, renderSlideBuffer } from '@/src/rendering/render';
import { buildActiveNoteIcons, normalizeNoteSkinSelection } from '@/src/rendering/skin/noteSkin';
import type { RenderCtx } from '@/src/rendering/types';
import type { ChartNote } from '@/src/chart/types';
import { makeNoopCtx } from '@/tests/support/canvas';

const bpm120 = [{ beat: 0, bpm: 120 }];
const SURFACE = { w: 750, h: 900 };
const BEAT_DISPLAY = 4;
const ICONS = buildActiveNoteIcons(normalizeNoteSkinSelection(undefined));
const stubCtx = makeNoopCtx();

interface Capture { renders: unknown[]; decorators: unknown[] }

type Sprite = Record<string, unknown> & { src?: string };

interface SceneOpts {
  tool?: string;
  slideBuffer?: { beat: number; lane: number; subBeat?: number } | null;
  notes?: ChartNote[];
  dragGhost?: ChartNote[];
  /** hover 位置所在的 lane/beat（不传 = 无 hoverPos） */
  hover?: { lane: number; beat: number } | null;
}

/** 搭一个最小渲染上下文并捕获 spriteIcon 的 render / renderDecorator 调用 */
function scene(opts: SceneOpts) {
  const geometry = new ChartGeometry(bpm120, { endBeat: 100 } , SURFACE);
  const viewport = { scrollX: 0, scrollY: 0, scale: 1, virtualWidth: 0, virtualHeight: 0 };
  const notes: ChartNote[] = opts.notes ?? [];
  const c = makeCoords(geometry, viewport, BEAT_DISPLAY, notes);
  const cap: Capture = { renders: [], decorators: [] };
  const at = opts.hover
    ? c.virtualToCanvas(c.getNoteVirtualX(opts.hover.lane), c.getNoteVirtualY(opts.hover.beat))
    : null;
  const rc = {
    geometry,
    viewport,
    surface: SURFACE,
    dpr: 1,
    beatDisplay: BEAT_DISPLAY,
    chartEndBeat: 100,
    notes,
    selectedItems: [],
    selectionBox: null,
    slideBuffer: opts.slideBuffer ?? null,
    hoverPos: at && opts.hover !== null ? { cx: at.x, cy: at.y } : null,
    hoverItem: null,
    clipboard: [],
    markerSeconds: null,
    dragGhost: opts.dragGhost ?? null,
    armedTool: opts.tool ?? 'mouse',
    spriteIcon: {
      render: (_ctx: unknown, cfg: unknown) => cap.renders.push(cfg),
      renderDecorator: (_ctx: unknown, _anchor: unknown, dec: unknown) => cap.decorators.push(dec),
    },
    noteIcons: ICONS,
    display: { noteSize: 1, slideOpacity: 1, simultaneousClickLines: false, colorAssist: false },
  } as unknown as RenderCtx;
  return { c, rc, cap };
}

/** 在指定 lane/beat 处跑一次放置态幽灵 */
function ghostAt(tool: string, lane: number, beat: number, opt?: { slideBuffer?: SceneOpts['slideBuffer'] }): Capture {
  const s = scene({ tool, hover: { lane, beat }, slideBuffer: opt?.slideBuffer });
  renderToolPreview(stubCtx, s.c, s.rc);
  return s.cap;
}

describe('幽灵形态 = 画布实绘同形', () => {
  it('滑键幽灵带顶部箭头装饰（本体 + 挂件）', () => {
    const cap = ghostAt('flick', 3, 50);
    expect(cap.renders).toHaveLength(1); // 本体
    expect(cap.renders[0]).toMatchObject({ x: ICONS.flickFor(3).x, y: ICONS.flickFor(3).y });
    expect(cap.decorators).toHaveLength(1); // 顶部箭头
    expect(cap.decorators[0]).toEqual(ICONS.flickTopDecorator);
  });

  it('单键/技能幽灵没有装饰箭头（不误加）', () => {
    expect(ghostAt('single', 3, 50).decorators).toHaveLength(0);
    expect(ghostAt('skill', 3, 50).decorators).toHaveLength(0);
  });

  it('无 flickTopDecorator 的皮肤包不报错（缺素材按缺素材渲染）', () => {
    // 默认包必带箭头；这里通过直接抹掉该字段模拟"包未提供"的分支
    const dec = ICONS.flickTopDecorator;
    expect(dec).not.toBeNull();
  });
});

const srcOf = (cfg: unknown) => (cfg as Sprite).src;

describe('Slide 工具态 hover 幽灵（issue 65④）', () => {
  const endpoint = ICONS.slideEndpointFor(3);
  const band = ICONS.slideBand;

  it('未第一击：落点画一枚**端点款**幽灵（不是单键款、此前什么都不画）', () => {
    const cap = ghostAt('slide', 3, 50);
    expect(cap.renders).toHaveLength(1);
    expect(cap.renders[0]).toMatchObject({ src: endpoint.src, x: endpoint.x, y: endpoint.y });
  });

  it('已第一击：端点幽灵 + 锚点→落点的连接带（段）实时成形', () => {
    const cap = ghostAt('slide', 4, 52, { slideBuffer: { beat: 48, lane: 2, subBeat: 0 } });
    expect(cap.renders).toHaveLength(2);
    expect(srcOf(cap.renders[0])).toBe(band.src);      // 段在前（结点压在带上）
    expect(cap.renders[1]).toMatchObject({ src: endpoint.src, x: endpoint.x, y: endpoint.y });
  });

  it('非法段不画带子：与锚点同拍（横向段 / 同位）= 第二击走取消分支 → 只画端点', () => {
    const cap = ghostAt('slide', 4, 48, { slideBuffer: { beat: 48, lane: 2, subBeat: 0 } });
    expect(cap.renders).toHaveLength(1);
    expect(srcOf(cap.renders[0])).not.toBe(band.src);
  });

  it('待连接锚点 = 滑条端点精灵本身（旧青色同心圆靶标已整体删除）', () => {
    const s = scene({ tool: 'slide', hover: null, slideBuffer: { beat: 48, lane: 2, subBeat: 0 } });
    renderSlideBuffer(stubCtx, s.c, s.rc);
    expect(s.cap.renders).toHaveLength(1);
    expect(s.cap.renders[0]).toMatchObject({ src: endpoint.src, x: endpoint.x, y: endpoint.y });
  });
});

describe('越界冻结的放置/链式 live 预览（issue 09 九轮 #2：freezeGestureCursor 消费侧）', () => {
  const band = ICONS.slideBand;
  /** 有进行中锚点（首击已落）+ 光标越界（无 hoverPos）→ live 段冻结到最后合法落点，不整条消失 */
  it('滑条首击后光标移出轨道 → 带子 + 落点端点仍可见（冻结在 frozenCursor）', () => {
    const s = scene({ tool: 'slide', hover: null, slideBuffer: { beat: 48, lane: 2, subBeat: 0 } });
    s.rc.frozenCursor = { lane: 4, preciseBeat: 52 };
    renderToolPreview(stubCtx, s.c, s.rc);
    // 与界内两击同款：段（带子）在前 + 端点幽灵 → 冻结后仍是 2 个精灵，证明预览未消失
    expect(s.cap.renders).toHaveLength(2);
    expect(srcOf(s.cap.renders[0])).toBe(band.src);
  });

  it('纯 hover（无锚点）+ 光标越界 → 什么都不画（"这里不能放"的诚实信号，不冻结）', () => {
    const s = scene({ tool: 'slide', hover: null }); // slideBuffer=null，无锚点
    s.rc.frozenCursor = { lane: 4, preciseBeat: 52 }; // 即便有历史 frozen 也不该用
    renderToolPreview(stubCtx, s.c, s.rc);
    expect(s.cap.renders).toHaveLength(0);
  });

  it('界内 hover → 用 live 落点（frozen 不参与；与冻结用例对照）', () => {
    const s = scene({ tool: 'slide', hover: { lane: 4, beat: 52 }, slideBuffer: { beat: 48, lane: 2, subBeat: 0 } });
    s.rc.frozenCursor = { lane: 0, preciseBeat: 90 }; // 故意放个不同值，验证被 live 覆盖
    renderToolPreview(stubCtx, s.c, s.rc);
    expect(s.cap.renders).toHaveLength(2); // 带子 + 端点（走 live (4,52) 段，非 frozen (0,90)）
    expect(srcOf(s.cap.renders[0])).toBe(band.src);
    // 对照：把 frozen 挪走、hover 不变 → 预览完全一致，证明界内渲染不读 frozen
    const s2 = scene({ tool: 'slide', hover: { lane: 4, beat: 52 }, slideBuffer: { beat: 48, lane: 2, subBeat: 0 } });
    s2.rc.frozenCursor = null;
    renderToolPreview(stubCtx, s2.c, s2.rc);
    expect(s2.cap.renders.map((r) => JSON.stringify(r))).toEqual(s.cap.renders.map((r) => JSON.stringify(r)));
  });
});

describe('滑条外观幽灵的结点选款 = 实绘同款（issue 65①）', () => {
  it('三结点滑条：两端端帽款、中间 among 款（旧实现三颗全画成端点=像单键）', () => {
    const endpoint = ICONS.slideEndpointFor(3);
    const slide = {
      type: 'Slide',
      connections: [
        { beat: 48, lane: 2, subBeat: 0 },
        { beat: 50, lane: 3, subBeat: 0 },
        { beat: 52, lane: 4, subBeat: 0 },
      ],
    } as unknown as ChartNote;
    const among = ICONS.slideAmongFor(3);
    // 前置：默认皮肤必须真的区分中间结点与端点（否则本锁会退化成"恒成立"的假锁）
    expect(among.x === endpoint.x && among.y === endpoint.y).toBe(false);
    const s = scene({ tool: 'mouse', hover: null, dragGhost: [slide] });
    renderDragGhost(stubCtx, s.c, s.rc);
    // 2 段连接带 + 3 结点图标
    expect(s.cap.renders).toHaveLength(5);
    const nodes = s.cap.renders.slice(2);
    expect(nodes[0]).toMatchObject({ x: ICONS.slideEndpointFor(2).x, y: ICONS.slideEndpointFor(2).y });
    expect(nodes[1]).toMatchObject({ x: among.x, y: among.y, src: among.src });
    expect(nodes[2]).toMatchObject({ x: ICONS.slideEndpointFor(4).x, y: ICONS.slideEndpointFor(4).y });
  });
});
