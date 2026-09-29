// issue 16：弹窗（以及整个 src/ui）的样式不许写死色值 ——
// ADR-0003「tokens.css 是全站唯一色值出处」的机器可执行版本。
// 13 票我就在 ConfirmDialog 的遮罩上写死了 rgba(0,0,0,0.45)；这条锁的是"犯过的错不许再犯"，
// 也是将来第二个弹窗壳接进来时的同款护栏。
//
// issue 16 第二步：`.pp-dialog` 三处与谱面代码弹窗（原来整套内联 style、遮罩 rgba(0,0,0,0.4)）
// 都进了 ui/Dialog 这一个壳 —— 于是护栏跟着扩到这批文件，并补上「全站只有一个弹窗壳」的扫描。
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readStripped, repoRoot } from '@/tests/support/source';

const shell = readStripped('src/ui/Dialog.tsx');
const uiCss = readStripped('src/ui/ui.css');
const confirmDialog = readStripped('src/ui/ConfirmDialog.tsx');
const projectsPage = readStripped('src/pages/projects/ProjectsPage.tsx');
const projectDialogs = readStripped('src/pages/projects/components/ProjectDialogs.tsx');
const projectBits = readStripped('src/pages/projects/components/ProjectBits.tsx');
const chartInfoDialog = readStripped('src/project/ui/ChartInfoDialog.tsx');
const codeModal = readStripped('src/chart/components/code-editor/ChartCodeEditorModal.tsx');
const codeModalCss = readStripped('src/chart/components/code-editor/ChartCodeEditorModal.css');
const toast = readStripped('src/ui/Toast.tsx');

/** hex 色值或 rgb/rgba() —— 样式里出现任何一个都说明色值绕过 token 了 */
const HARD_CODED_COLOR = /#[0-9a-fA-F]{3,8}\b|rgba?\(/;

/**
 * 参与「零硬编码色值」的文件：弹窗壳 + 壳的样式 + 五个弹窗的内容 + 轻提示（issue 17，同一族）。
 * 不含 ProjectsPage.css —— 弹窗规则已从它搬进 ui.css，它剩下的硬编码色值
 * （启动台封面角标之类的 #fff）是另一笔历史账，不在本票范围。
 * 弹窗内容随 architecture-refactor 01 拆解分住三处：页面（编排）/ ProjectDialogs（两个表单弹窗）/
 * ProjectBits（卡片菜单与难度徽标浮层 —— 原也在 ProjectsPage 里，一并纳入扫描）。
 */
const DIALOG_SOURCES: [string, string][] = [
  ['ui/Dialog.tsx', shell],
  ['ui/ui.css', uiCss],
  ['ui/ConfirmDialog.tsx', confirmDialog],
  ['ui/Toast.tsx', toast],
  ['pages/projects/ProjectsPage.tsx', projectsPage],
  ['pages/projects/components/ProjectDialogs.tsx', projectDialogs],
  ['pages/projects/components/ProjectBits.tsx', projectBits],
  ['project/ui/ChartInfoDialog.tsx', chartInfoDialog],
  ['chart/.../ChartCodeEditorModal.tsx', codeModal],
  ['chart/.../ChartCodeEditorModal.css', codeModalCss],
];

/** src 下的 .ts/.tsx/.css（原型页除外：那是用完即弃的第三套壳，本来就不该进 main） */
function sourceFiles(dir = 'src'): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(repoRoot, dir))) {
    const rel = `${dir}/${entry}`;
    if (rel.startsWith('src/prototypes')) continue;
    if (statSync(join(repoRoot, rel)).isDirectory()) out.push(...sourceFiles(rel));
    else if (/\.(ts|tsx|css)$/.test(entry)) out.push(rel);
  }
  return out;
}

describe('issue 16 · 弹窗样式一律走 token', () => {
  it.each(DIALOG_SOURCES)('%s 里没有一个硬编码色值', (_name, src) => {
    expect(src).not.toMatch(HARD_CODED_COLOR);
  });

  it('遮罩用 --overlay-bg，不是自己调的半透明黑', () => {
    expect(uiCss).toMatch(/\.dialog__scrim\s*\{[^}]*var\(--overlay-bg\)/);
  });

  it('不可逆确认键走 --danger-btn 一组（--danger 本体白字压不住，不能拿来顶）', () => {
    expect(uiCss).toMatch(/\.action-btn--danger-solid\s*\{[^}]*var\(--danger-btn\)/);
  });

  it('弹窗有入场动效，且给 reduce-motion 留了退路', () => {
    expect(uiCss).toMatch(/animation:\s*dialog-in/);
    expect(uiCss).toMatch(/animation:\s*dialog-scrim-in/);
    expect(uiCss).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });

  it('头尾色带（--bg-inset）被面板圆角裁掉：壳必须 overflow: hidden', () => {
    // 不裁的话头尾的矩形底会盖掉面板圆角 —— 2026-09-28 用户复现的"四个方角"bug
    expect(uiCss).toMatch(/\.dialog\s*\{[^}]*overflow:\s*hidden/);
    expect(uiCss).toMatch(/\.dialog__head\s*\{[^}]*var\(--bg-inset\)/);
    expect(uiCss).toMatch(/\.dialog__foot\s*\{[^}]*var\(--bg-inset\)/);
  });

  it('三档尺寸：确认 440 / 表单 560 / 谱面代码 920×640', () => {
    expect(uiCss).toMatch(/\.dialog--sm\s*\{[^}]*min\(440px/);
    expect(uiCss).toMatch(/\.dialog--md\s*\{[^}]*min\(560px/);
    expect(uiCss).toMatch(/\.dialog--lg\s*\{[^}]*min\(920px[^}]*min\(640px/);
  });

  it('全站只有一个弹窗壳：src 里不再有第二套弹窗前缀', () => {
    // 每个新弹窗都该走 ui/Dialog —— 再长出一个自己的壳就是把本票的因重新犯一遍
    const offenders = sourceFiles().filter((rel) => /pp-dialog|confirm-dialog/.test(readStripped(rel)));
    expect(offenders).toEqual([]);
  });
});
