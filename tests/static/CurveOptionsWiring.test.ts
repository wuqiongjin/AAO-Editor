// 票 242 · 曲线选项胶囊「常驻展开」与缓动页「图形化选型」的结构锁。
//
// 为什么只能静态断言：jsdom 没有布局引擎，`grid-template-columns: repeat(5, 1fr)` 到底排成
// 5 列 × 2 行、面板会不会因此多出滚动条，都量不出来；「缓动页不再有原生下拉框」倒是源码事实。
// 交互行为（点外部不折叠、Esc 不拦截、分类与上次模板恢复）另有 DOM 锁
// （tests/dom/workspace/CurveOptionsCapsule.test.tsx）；5×2 的实际观感由页面验收把关。
import { describe, expect, it } from 'vitest';
import { cssRuleBodyExact, readSource, readStripped } from '@/tests/support/source';

const PANEL_CSS = 'src/pages/workspace/CurveConfigPanel.css';
const PANEL_TSX = 'src/pages/workspace/CurveConfigPanel.tsx';
const CAPSULE_TSX = 'src/pages/workspace/CurveOptionsCapsule.tsx';

function rule(css: string, selector: string): string {
  const body = cssRuleBodyExact(readStripped(css), selector);
  if (body == null) throw new Error(`${css} 里找不到 ${selector} 规则`);
  return body;
}

describe('basic-editor 242 · 缓动页图形化选型结构', () => {
  it('缓动族网格 5 列 × 2 行、自身不滚（两行铺满即免滚动条）', () => {
    const grid = rule(PANEL_CSS, '.ccp__easing-grid');
    expect(grid).toMatch(/grid-template-columns:\s*repeat\(5,\s*1fr\)/);
    expect(grid).not.toMatch(/overflow/);
    expect(grid).not.toMatch(/max-height/);
  });

  it('原生 <select> 与旧的单图预览框彻底退场', () => {
    const src = readStripped(PANEL_TSX);
    expect(src).not.toMatch(/<select/);
    for (const gone of ['ccp__select', 'ccp__easing-box', 'ccp__easing-preview', 'ccp__easing-form']) {
      expect(src, `${gone} 不该还在面板里`).not.toContain(gone);
      expect(readStripped(PANEL_CSS), `${gone} 的样式该删`).not.toContain(gone);
    }
  });

  it('四个缓动型按钮用英文短名 + 完整双语 title（双语拆分走同一处）', () => {
    const src = readStripped(PANEL_TSX);
    expect(src).toMatch(/EASING_TYPES\.map/);
    expect(src).toMatch(/easingTypeShort/);
    expect(src).toMatch(/splitBilingualLabel/);
  });
});

describe('basic-editor 242 · 曲线胶囊常驻展开接线', () => {
  it('胶囊不再用临时弹层 Hook（点外部 / Esc 收起归片段粘贴胶囊）', () => {
    const src = readStripped(CAPSULE_TSX);
    expect(src).not.toContain('useCanvasCapsule');
  });

  it('展开态读写设置对象，不因切走工具被覆写', () => {
    const src = readStripped(CAPSULE_TSX);
    expect(src).toMatch(/settings\.layout\.curveCapsuleOpen/);
    expect(src).toMatch(/setCurveCapsuleOpen/);
  });

  it('分类筛选与上次模板 ID 读写 settings.curve（面板不再自持局部状态）', () => {
    const src = readStripped(PANEL_TSX);
    expect(src).toMatch(/config\.templateCategory/);
    // 「上次选用的模板」合法性与旧设置迁移收在 CurveTool 一处，面板只消费它
    expect(src).toMatch(/resolveLastTemplateId\(config\)/);
    expect(src).not.toMatch(/lastTemplateIdRef/);
    expect(src).not.toMatch(/useState<'all'/);
    // 选模板时同步记忆「上次选用的模板」
    expect(src).toMatch(/lastTemplateId:\s*tp\.id/);
  });
});
