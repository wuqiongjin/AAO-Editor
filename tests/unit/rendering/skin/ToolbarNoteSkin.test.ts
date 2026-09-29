// issue 86 锁测（两部分）：
// 1) **静态源回归**：工作台工具栏的音符图标必须走「音符皮肤域」，且 legacy 那套
//    （`ui/SpriteIcon.tsx` 的 `NoteIcons` + `public/assets/skins/legacy/*`）必须彻底消失（防无意复活）。
//    图标是 canvas 位图，单测拿不到像素；"是否读皮肤选择 / legacy 是否清干净"是**结构事实**，
//    静态源码断言最稳（照 `EditorAudioSessionRefactor.test.ts` 惯例）。
// 2) **28px 字形构图**（issue 91：18→24→28px）：用假精灵记录绘制盒，锁"不空绘 + 全部落在字形盒内"。
//    真实像素与换肤联动由票内手工验收清单补（本沙箱无 Playwright）。
// issue 91 锁测：滑条构图统一 —— 工具栏滑条字形与素材页滑条预览的 band:结点宽度都锁真实画布口径
// 30:36（共享 `SLIDE_BAND_TO_NODE_RATIO`），修"素材页中间结点超带宽 1.8× / 工具栏 2× / 画布 1.2× 三处失衡"。
// issue 91：方向键按整组墨迹中心居中（与上方单键对称构图对齐）；滑条只画"段"（连接带，不画端点音符）。
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import {
  DIR_BODY_BOOST, drawNoteGlyph, glyphBox, slideGlyphGeometry,
  curveGlyphGeometry, curveGlyphSway, CURVE_BAND_WIDTH_RATIO, type ToolGlyphItem,
} from '@/src/rendering/primitives/noteGlyph';
import { computeSlideColLayout, SLIDE_PREVIEW_NODE_SCALE } from '@/src/rendering/skin/noteSkinPreviewLayout';
import { SLIDE_BAND_TO_NODE_RATIO } from '@/src/rendering/primitives/noteMetrics';
import { buildActiveNoteIcons, normalizeNoteSkinSelection, type NoteSkinItemId } from '@/src/rendering/skin/noteSkin';
import { repoRoot, stripComments, readSource } from '@/tests/support/source';

/** 去注释后再断言：注释里会解释性地提到 legacy / SpriteIcon / 素材路径等旧名 */

const toolbarSrc = stripComments(readSource('src/pages/workspace/Toolbar.tsx'));
const glyphSrc = stripComments(readSource('src/rendering/primitives/NoteIconGlyph.tsx'));

/** 递归收集目录下的 .ts / .tsx 文件（跳过 node_modules） */
function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walkTs(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe('issue 86 · 工具栏音符图标接入音符皮肤域', () => {
  it('不再引用 legacy 图标模块与 legacy 图标表', () => {
    // 注意 \b：`buildActiveNoteIcons` 里含 "NoteIcons" 子串，必须按词边界判旧图标表
    expect(toolbarSrc).not.toMatch(/\bNoteIcons\b/);
    expect(toolbarSrc).not.toMatch(/\bSlideLineIcons\b/);
    expect(toolbarSrc).not.toContain('ui/SpriteIcon');
    expect(toolbarSrc).not.toContain('skins/legacy');
  });

  it('读 settings.visual 的皮肤选择并据此构建图标集（换肤联动的前提）', () => {
    expect(toolbarSrc).toContain('buildActiveNoteIcons');
    expect(toolbarSrc).toContain('settings.visual');
    expect(glyphSrc).toContain('CanvasSpriteIcon');
    expect(glyphSrc).toContain('noteSkin');
  });

  it('六个音符工具项都换成皮肤字形画布（不是 lucide 图标）', () => {
    for (const item of ['tap', 'flick', 'skill', 'dirL', 'dirR', 'slide']) {
      expect(toolbarSrc).toContain(`item="${item}"`);
    }
  });

  // issue 114：曲线工具原本是唯一用 lucide `Spline` 的图标（与"画 SP 绿条"的语义也不符）
  it('曲线工具图标改用皮肤字形（lucide Spline 退场）', () => {
    const line = toolbarSrc.split('\n').find((l) => l.includes('item="curve"')) ?? '';
    expect(line, '工具栏 curve 项应走 NoteIconGlyph').toContain('NoteIconGlyph');
    expect(toolbarSrc).not.toMatch(/\bSpline\b/);
  });

  it('镜像工具改用 FlipHorizontal2（原 RotateCcw 语义不符）', () => {
    expect(toolbarSrc).not.toContain('RotateCcw');
    const mirrorLine = toolbarSrc.split('\n').find((l) => l.includes("t('tool.mirror')") && l.includes('armOrRelease')) ?? '';
    expect(mirrorLine).toContain('FlipHorizontal2');
  });
});

describe('issue 86 · legacy 残留清理', () => {
  it('src/ui/SpriteIcon.tsx 已删除', () => {
    expect(existsSync(join(repoRoot, 'src/ui/SpriteIcon.tsx'))).toBe(false);
  });

  it('public/assets/skins/legacy 目录已删除', () => {
    expect(existsSync(join(repoRoot, 'public/assets/skins/legacy'))).toBe(false);
  });

  it('src/ 与 tools/ 内不再引用 assets/skins/legacy', () => {
    const hits = [...walkTs(join(repoRoot, 'src')), ...walkTs(join(repoRoot, 'tools'))]
      .filter((f) => stripComments(readFileSync(f, 'utf-8')).includes('skins/legacy'))
      .map((f) => f.replace(repoRoot + '/', ''));
    expect(hits).toEqual([]);
  });
});

/** 假精灵：只记录绘制盒（设计 px），不碰 canvas —— 这里要锁的是"画在哪、多大" */
interface DrawnBox { cx: number; cy: number; w: number; h: number }
function recordDraws(item: ToolGlyphItem, size: number): DrawnBox[] {
  const drawn: DrawnBox[] = [];
  const sprite = {
    render: (_ctx: unknown, props: { canvasX: number; canvasY: number; canvasSize: number; canvasWidth?: number; canvasHeight?: number; scale?: number }) => {
      const s = props.scale ?? 1;
      drawn.push({
        cx: props.canvasX,
        cy: props.canvasY,
        w: (props.canvasWidth ?? props.canvasSize) * s,
        h: (props.canvasHeight ?? props.canvasSize) * s,
      });
    },
  };
  const box = glyphBox(ICONS, item, size);
  drawNoteGlyph({} as CanvasRenderingContext2D, sprite as never, ICONS, item, box.w, box.h);
  return drawn;
}

const ICONS = buildActiveNoteIcons(normalizeNoteSkinSelection(undefined));

describe('issue 86/91 · 28px 字形构图（不空绘、不越出字形盒）', () => {
  const SIZE = 28;
  const ITEMS: NoteSkinItemId[] = ['tap', 'flick', 'skill', 'dirL', 'dirR', 'slide'];

  for (const item of ITEMS) {
    it(`${item}：至少画一枚精灵，且绘制盒落在字形盒内`, () => {
      const drawn = recordDraws(item, SIZE);
      const box = glyphBox(ICONS, item, SIZE);
      expect(drawn.length).toBeGreaterThan(0);
      for (const d of drawn) {
        expect(d.cx - d.w / 2, `${item} 左越界`).toBeGreaterThanOrEqual(0);
        expect(d.cx + d.w / 2, `${item} 右越界`).toBeLessThanOrEqual(box.w);
        expect(d.cy - d.h / 2, `${item} 上越界`).toBeGreaterThanOrEqual(0);
        expect(d.cy + d.h / 2, `${item} 下越界`).toBeLessThanOrEqual(box.h);
      }
    });
  }

  it('方向键 = 本体 + 最外侧箭头两枚；滑条 = 仅连接带一枚（不画端点音符）', () => {
    expect(recordDraws('dirL', SIZE)).toHaveLength(2);
    expect(recordDraws('dirR', SIZE)).toHaveLength(2);
    expect(recordDraws('slide', SIZE)).toHaveLength(1);
    expect(recordDraws('tap', SIZE)).toHaveLength(1);
  });

  it('换皮肤后尺寸约束仍成立（几何全部来自 ActiveNoteIcons，不写死坐标）', () => {
    for (const item of ITEMS) {
      const drawn = recordDraws(item, 32);
      const box = glyphBox(ICONS, item, 32);
      for (const d of drawn) {
        expect(d.cx + d.w / 2).toBeLessThanOrEqual(box.w);
      }
    }
  });
});

describe('issue 91 · 方向键盒与本体尺寸（28px）', () => {
  const SIZE = 28;

  it('字形盒：非方向键 = size 方框；方向键加宽承担箭头（盒宽 > size、高 = size）', () => {
    expect(glyphBox(ICONS, 'tap', SIZE)).toEqual({ w: SIZE, h: SIZE });
    for (const dir of ['dirL', 'dirR'] as const) {
      const box = glyphBox(ICONS, dir, SIZE);
      expect(box.w, dir).toBeGreaterThan(SIZE);
      expect(box.h, dir).toBe(SIZE);
    }
  });

  it('方向键本体绘制宽 = 单键本体 × DIR_BODY_BOOST（比其它音符显大一点）', () => {
    const tapW = Math.max(...recordDraws('tap', SIZE).map(d => d.w));
    for (const dir of ['dirL', 'dirR'] as const) {
      const bodyW = Math.max(...recordDraws(dir, SIZE).map(d => d.w));
      expect(Math.abs(bodyW - tapW * DIR_BODY_BOOST), dir).toBeLessThan(1);
    }
  });
});

describe('issue 91 · 方向键墨迹居中 + 滑条只画"段"', () => {
  const SIZE = 28;

  it('方向键按整组墨迹中心居中：L 本体右移、R 本体左移（与上方单键的对称构图对齐）', () => {
    for (const [dir, side] of [['dirL', 1], ['dirR', -1]] as const) {
      const box = glyphBox(ICONS, dir, SIZE);
      const body = recordDraws(dir, SIZE).reduce((a, b) => (b.w > a.w ? b : a)); // 本体 = 较宽的一枚
      expect(Math.sign(body.cx - box.w / 2), `${dir} 本体应向${side > 0 ? '右' : '左'}偏`).toBe(side);
    }
  });

  it('滑条只画连接带一枚（不画起止端点音符，仅展示"段"）', () => {
    expect(recordDraws('slide', SIZE)).toHaveLength(1);
  });
});

describe('issue 114 · 曲线工具图标 = 一段弯的 SP 带（无端点）', () => {
  const SIZE = 28;

  it('逐行铺带：画多行而非一枚整块，且行宽恒等于带宽（横截面完整、不拉伸）', () => {
    const rows = recordDraws('curve', SIZE);
    // 一枚整块 = 1 行 —— 那就跟滑条图标没区别了，弯腰看不出来
    expect(rows.length).toBeGreaterThan(8);
    const g = curveGlyphGeometry(SIZE);
    for (const r of rows) expect(r.w, '每行宽度 = 带宽').toBeCloseTo(g.bandW, 6);
  });

  it('只画带、不画端点：没有任何一行的高度接近字形盒（端点音符至少要 1/3 盒高）', () => {
    const rows = recordDraws('curve', SIZE);
    const box = glyphBox(ICONS, 'curve', SIZE);
    expect(box).toEqual({ w: SIZE, h: SIZE });
    for (const r of rows) expect(r.h, '行高远小于端点音符').toBeLessThan(box.h / 3);
  });

  it('确实在弯：行的横向中心随 S 形摆动，摆幅 = 带宽收缩腾出的余量', () => {
    const rows = recordDraws('curve', SIZE);
    const g = curveGlyphGeometry(SIZE);
    const xs = rows.map((r) => r.cx);
    const span = Math.max(...xs) - Math.min(...xs);
    expect(span, '应有可见摆幅').toBeGreaterThan(2);
    expect(span, '摆幅 = 2×amplitude').toBeCloseTo(2 * g.amplitude, 1);
    expect(Math.abs(curveGlyphSway(0))).toBeLessThan(1e-9);
    expect(Math.abs(curveGlyphSway(1))).toBeLessThan(1e-9);
  });

  it('全部落在字形盒内（含摆幅，不越界）', () => {
    for (const size of [18, 28, 32]) {
      const box = glyphBox(ICONS, 'curve', size);
      for (const d of recordDraws('curve', size)) {
        expect(d.cx - d.w / 2, `size=${size} 左越界`).toBeGreaterThanOrEqual(0);
        expect(d.cx + d.w / 2, `size=${size} 右越界`).toBeLessThanOrEqual(box.w);
        expect(d.cy - d.h / 2, `size=${size} 上越界`).toBeGreaterThanOrEqual(0);
        expect(d.cy + d.h / 2, `size=${size} 下越界`).toBeLessThanOrEqual(box.h);
      }
    }
  });

  it('带宽 = 滑条带宽 × 收缩系数，且 带宽 + 2×摆幅 = 横向可用区（摆幅吃满余量）', () => {
    for (const size of [18, 28, 32]) {
      const g = curveGlyphGeometry(size);
      const slide = slideGlyphGeometry(size);
      expect(g.bandW).toBeCloseTo(slide.bandW * CURVE_BAND_WIDTH_RATIO, 6);
      expect(g.bandH).toBe(size - 2);
      expect(g.bandW + 2 * g.amplitude).toBeCloseTo(size - 2, 6);
    }
  });

  it('材质取 SP 带 slideBandSp（与画布 SP 段同源；包缺该素材时 noteSkin 已回退普通带）', () => {
    const glyphGeom = stripComments(readSource('src/rendering/primitives/noteGlyph.ts'));
    expect(glyphGeom).toContain('icons.slideBandSp');
  });
});

describe('issue 91 · 工具栏 28px + 滑条构图统一（band:结点 = 30:36）', () => {
  it('六个音符工具项 + 曲线工具的 NoteIconGlyph 全部 size={28}', () => {
    for (const item of ['tap', 'flick', 'skill', 'dirL', 'dirR', 'slide', 'curve']) {
      const line = toolbarSrc.split('\n').find((l) => l.includes(`item="${item}"`)) ?? '';
      expect(line, item).toContain('size={28}');
    }
  });

  it('工具栏滑条字形（只画"段"）：band 纵向铺满，宽 = 键型本体宽 × 30/36', () => {
    for (const size of [18, 28, 32]) {
      const g = slideGlyphGeometry(size);
      expect(g.bandH, `size=${size}`).toBe(size - 2);
      expect(g.bandW, `size=${size}`).toBeCloseTo((size - 2) * SLIDE_BAND_TO_NODE_RATIO, 6);
    }
  });

  it('素材页滑条预览：band 宽 = 预览结点宽（36×1.1）× 30/36，不再写死 22', () => {
    const layout = computeSlideColLayout(140, 88);
    expect(layout.bandW).toBeCloseTo(36 * SLIDE_PREVIEW_NODE_SCALE * SLIDE_BAND_TO_NODE_RATIO, 6);
    expect(layout.bandW).not.toBe(22);
  });

  it('两处构图引用同一份比例常量（防再次各写一套）', () => {
    expect(stripComments(readSource('src/rendering/primitives/noteGlyph.ts'))).toContain('SLIDE_BAND_TO_NODE_RATIO');
    expect(stripComments(readSource('src/rendering/skin/noteSkinPreviewLayout.ts'))).toContain('SLIDE_BAND_TO_NODE_RATIO');
  });
});

describe('issue 91 · 字形画布固定超采样（防放大发糊）', () => {
  it('backing 分辨率与运行时 dpr 解耦：固定 3× 超采样（浏览器缩放不重绘也不再糊）', () => {
    const src = stripComments(readSource('src/rendering/primitives/NoteIconGlyph.tsx'));
    expect(src).toContain('BACKING_SCALE');
    expect(src).not.toContain('window.devicePixelRatio');
    expect(src).toContain("imageSmoothingQuality = 'high'");
  });
});
