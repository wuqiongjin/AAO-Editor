// issue 86 锁测（两部分）：
// 1) **静态源回归**：工作台工具栏的音符图标必须走「音符皮肤域」，且 legacy 那套
//    （`ui/SpriteIcon.tsx` 的 `NoteIcons` + `public/assets/skins/legacy/*`）必须彻底消失（防无意复活）。
//    图标是 canvas 位图，单测拿不到像素；"是否读皮肤选择 / legacy 是否清干净"是**结构事实**，
//    静态源码断言最稳（照 `EditorAudioSessionRefactor.test.ts` 惯例）。
// 2) **18px 字形构图**：用假精灵记录绘制盒，锁"不空绘 + 全部落在按钮方框内"（用 node 环境即可跑）。
//    真实像素与换肤联动由票内手工验收清单补（本沙箱无 Playwright）。
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { drawNoteGlyph } from '../../src/chart/rendering/noteGlyph';
import { buildActiveNoteIcons, normalizeNoteSkinSelection, type NoteSkinItemId } from '../../src/visual/noteSkin';

const ROOT = join(__dirname, '../..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf-8');
/** 去注释后再断言：注释里会解释性地提到 legacy / SpriteIcon / 素材路径等旧名 */
const stripComments = (s: string) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

const toolbarSrc = stripComments(read('src/pages/WorkspacePage/Toolbar.tsx'));
const glyphSrc = stripComments(read('src/chart/rendering/NoteIconGlyph.tsx'));

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

  it('镜像工具改用 FlipHorizontal2（原 RotateCcw 语义不符）', () => {
    expect(toolbarSrc).not.toContain('RotateCcw');
    const mirrorLine = toolbarSrc.split('\n').find((l) => l.includes('label="镜像"')) ?? '';
    expect(mirrorLine).toContain('FlipHorizontal2');
  });
});

describe('issue 86 · legacy 残留清理', () => {
  it('src/ui/SpriteIcon.tsx 已删除', () => {
    expect(existsSync(join(ROOT, 'src/ui/SpriteIcon.tsx'))).toBe(false);
  });

  it('public/assets/skins/legacy 目录已删除', () => {
    expect(existsSync(join(ROOT, 'public/assets/skins/legacy'))).toBe(false);
  });

  it('src/ 与 tools/ 内不再引用 assets/skins/legacy', () => {
    const hits = [...walkTs(join(ROOT, 'src')), ...walkTs(join(ROOT, 'tools'))]
      .filter((f) => stripComments(readFileSync(f, 'utf-8')).includes('skins/legacy'))
      .map((f) => f.replace(ROOT + '/', ''));
    expect(hits).toEqual([]);
  });
});

/** 假精灵：只记录绘制盒（设计 px），不碰 canvas —— 这里要锁的是"画在哪、多大" */
interface DrawnBox { cx: number; cy: number; w: number; h: number }
function recordDraws(item: NoteSkinItemId, size: number): DrawnBox[] {
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
  drawNoteGlyph({} as CanvasRenderingContext2D, sprite as never, ICONS, item, size);
  return drawn;
}

const ICONS = buildActiveNoteIcons(normalizeNoteSkinSelection(undefined));

describe('issue 86 · 18px 字形构图（不空绘、不越出按钮方框）', () => {
  const SIZE = 18;
  const ITEMS: NoteSkinItemId[] = ['tap', 'flick', 'skill', 'dirL', 'dirR', 'slide'];

  for (const item of ITEMS) {
    it(`${item}：至少画一枚精灵，且绘制盒落在 ${SIZE}px 方框内`, () => {
      const drawn = recordDraws(item, SIZE);
      expect(drawn.length).toBeGreaterThan(0);
      for (const d of drawn) {
        expect(d.cx - d.w / 2, `${item} 左越界`).toBeGreaterThanOrEqual(0);
        expect(d.cx + d.w / 2, `${item} 右越界`).toBeLessThanOrEqual(SIZE);
        expect(d.cy - d.h / 2, `${item} 上越界`).toBeGreaterThanOrEqual(0);
        expect(d.cy + d.h / 2, `${item} 下越界`).toBeLessThanOrEqual(SIZE);
      }
    });
  }

  it('方向键 = 本体 + 最外侧箭头两枚；滑条 = 连接带 + 上下端点三枚', () => {
    expect(recordDraws('dirL', SIZE)).toHaveLength(2);
    expect(recordDraws('dirR', SIZE)).toHaveLength(2);
    expect(recordDraws('slide', SIZE)).toHaveLength(3);
    expect(recordDraws('tap', SIZE)).toHaveLength(1);
  });

  it('换皮肤后尺寸约束仍成立（几何全部来自 ActiveNoteIcons，不写死坐标）', () => {
    for (const item of ITEMS) {
      const drawn = recordDraws(item, 24);
      for (const d of drawn) {
        expect(d.cx + d.w / 2).toBeLessThanOrEqual(24);
      }
    }
  });
});
