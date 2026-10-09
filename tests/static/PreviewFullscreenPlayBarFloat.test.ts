// chart-preview 27 的静态锁：**全屏态**播放条浮在画面上（= 不占独立行）。
//
// 现象（用户 2026-10-09 报，本机实测坐实）：全屏播放时左右各一条黑边 —— 16:9 屏上 35px、
// 21:9 屏上 475px（后者另有成因）。根因**只有一条**：播放条 + 舞台 gap 占了一整行 40px
// ⇒ 画面只吃到 `屏高 − 40`，宽按设计面比例缩到 `1040 × 1.7787 = 1850`，每侧正好差 35px。
// 修法 = E「播放条浮在画面上」，**只在全屏态浮**（窗口态留白露的是页面底色、不是黑边，
// 那是票 05 的定案；全屏才是沉浸观看）。实测 1920×1080：场地 1850×1040 → 1920×1079，
// 黑边 0，画面 +7.7%；2560×1440 同理 +5.7%。
//
// **为什么只能静态断言**：jsdom 没有布局引擎（`getBoundingClientRect()` 恒 0），几何结论
// 只能靠真渲染。真机几何（Playwright，真 `requestFullscreen`）的数值记在票 27 的 Answer；
// 本文件锁住"这三条 CSS 事实还在"，防止重构时悄悄改回去。
import { describe, expect, it } from 'vitest';
import { cssRuleBody, readStripped } from '@/tests/support/source';

const CSS = 'src/pages/preview/PreviewPage.css';
const PAGE = 'src/pages/preview/PreviewPage.tsx';
const STAGE = 'src/pages/preview/PreviewVideoStage.tsx';

describe('chart-preview 27 · 全屏播放条浮在画面上（左右黑边 = 播放条那一行）', () => {
  const css = readStripped(CSS);
  const bodyOf = (selector: string) => cssRuleBody(css, selector) ?? '';

  it('全屏态去掉舞台 gap，让画面吃掉整个舞台高度（= 黑边唯一的来源）', () => {
    const body = bodyOf('.preview-stage:fullscreen .pv-stage');
    expect(body, `${CSS} 里应有「全屏态去 gap」规则`).toBeTruthy();
    expect(body).toMatch(/gap:\s*0\s*!important/);
  });

  it('全屏态播放条改绝对定位：贴舞台底缘，不再占独立行', () => {
    const body = bodyOf('.preview-stage:fullscreen .play-bar--preview');
    expect(body, `${CSS} 里应有「全屏态播放条浮起」规则`).toBeTruthy();
    expect(body).toMatch(/position:\s*absolute\s*!important/);
    // 左右下三个偏移都在（贴底 + 不贴边），值走间距 token、不落硬编码
    expect(body).toMatch(/left:\s*var\(--space-3\)\s*!important/);
    expect(body).toMatch(/right:\s*var\(--space-3\)\s*!important/);
    expect(body).toMatch(/bottom:\s*var\(--space-3\)\s*!important/);
  });

  it('浮起后高度交给内容：`min-height: 32px`（占行时的口径）在全屏下让位', () => {
    expect(bodyOf('.preview-stage:fullscreen .play-bar--preview')).toMatch(/min-height:\s*0\s*!important/);
    // 窗口态那一档必须还在（票 05：播放控件 = 舞台底部一排）
    expect(css).toMatch(/\.preview-page\.is-video \.play-bar--preview\s*\{[^}]*min-height:\s*32px/);
  });

  it('只在全屏浮：窗口态那两条 `is-video` 覆盖一字不动', () => {
    // 窗口态 gap 8 / min-height 32 都留着 —— 「窗口态留白不是黑边」是票 27 的三条理由之一
    expect(css).toMatch(/\.preview-page\.is-video \.pv-stage\s*\{[^}]*gap:\s*8px/);
    expect(css).toMatch(/\.preview-page\.is-video \.play-bar--preview\s*\{[^}]*min-height:\s*32px/);
    // 全屏那两条不挂在 `is-video` 上（否则窗口态也会浮）
    expect(css).not.toMatch(/\.is-video[^{]*:fullscreen/);
  });

  it('两条覆盖都带 `!important`：与窗口态那条同为 0-3-0、源序在后', () => {
    // 本机 Chromium 里 `:fullscreen` 计一个类 ⇒ 本文件这两条与 `.preview-page.is-video …`
    // 同权，而后者排在后面 ⇒ 不加 `!important` 就输（实测 gap 仍是 8px）。
    // 故沿用本文件既有手法（`.is-palette-swap` 那条同样 `!important`），作用面仍收在全屏块里。
    for (const sel of ['.preview-stage:fullscreen .pv-stage', '.preview-stage:fullscreen .play-bar--preview']) {
      expect(bodyOf(sel), `${sel} 应带 !important`).toMatch(/!important/);
    }
  });

  it('倍速面板仍往上翻（`.pv-rate__panel` 的锚点没被浮起改坏）', () => {
    // 面板的含块是 `.pv-rate` 自己（下面那条断言），所以播放条改定位不影响它；
    // 真机实测面板底 = 触钮顶 − 8px，记在票 27 的 Answer。
    expect(css).toMatch(/\.pv-rate\s*\{[^}]*position:\s*relative/);
    expect(css).toMatch(/\.pv-rate__panel\s*\{[^}]*bottom:\s*calc\(100% \+ 8px\)/);
    // 播放条自己不许再声明一次 position（`absolute` 与 `relative` 双写在同一个块里是死声明）
    const declarations = bodyOf('.preview-stage:fullscreen .play-bar--preview').match(/position:/g) ?? [];
    expect(declarations).toHaveLength(1);
  });

  it('底衬走 --canvas-bg 的浅渐变（不是不透明胶囊：票 10 已撤过控件外壳）', () => {
    const body = bodyOf('.preview-stage:fullscreen .play-bar--preview');
    expect(body).toMatch(/background:\s*linear-gradient\([^;]*var\(--canvas-bg\)/);
    expect(body).not.toMatch(/background(-color)?:\s*(#|rgb|var\(--stage-surface\)|var\(--bg-elevated\))/);
  });

  it('接线没变：播放条仍是工作台同一件 PlayBar（变体 + 倍速 slot，票 22）', () => {
    expect(readStripped(STAGE)).toMatch(/<PlayBar[\s\S]*?variant="preview"/);
    // 浮层只管舞台这一块：全屏退场的是工具栏那一排，播放条在舞台里面
    const page = readStripped(PAGE);
    expect(page).toMatch(/preview-stage\$\{\(mode === 'static' && scene\)/);
  });
});
