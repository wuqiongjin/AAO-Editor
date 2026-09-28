// issue 17：全站的轻提示一律走 ui/Toast（showToast），不许再用原生 window.alert ——
// 与 issue 13 的「原生 window.confirm 清零」是同一把闸，只是换了个键（confirm 也一并守着）。
// 扫的是**代码**（注释不算）：票与组件注释里都会提到这些词，注释里的示例不该误伤。
// 确有必要的例外必须写进 17 票的 Comments，不许在这里加白名单糊过去。
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readStripped, repoRoot } from '@/tests/support/source';

/** src/ 下全部 .ts/.tsx（相对仓库根的路径） */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      out.push(...sourceFiles(abs));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(relative(repoRoot, abs).split('\\').join('/'));
    }
  }
  return out;
}

const files = sourceFiles(join(repoRoot, 'src'));

/**
 * 原生弹窗三兄弟。前面那个排除类把 `foo.confirm(` / `myAlert(` 这类同名方法放过，
 * 但 `window.alert(` 仍由中间的 `window.` 分支命中。
 */
const NATIVE_DIALOG = /(?:^|[^\w.$])(?:window\s*\.\s*)?(alert|confirm|prompt)\s*\(/;

const offenders = files.filter((rel) => NATIVE_DIALOG.test(readStripped(rel)));

const toast = readStripped('src/ui/Toast.tsx');
const uiCss = readStripped('src/ui/ui.css');
const codeModal = readStripped('src/chart/components/code-editor/ChartCodeEditorModal.tsx');
const projectsPage = readStripped('src/pages/ProjectsPage.tsx');
const chartSwitcher = readStripped('src/pages/WorkspacePage/ChartSwitcher.tsx');
const shell = readStripped('src/layouts/AppShell.tsx');

/** 一个文件里 showToast 的接线数量（数出调用点，防止哪天又被换回原生） */
const toastCalls = (src: string) => src.match(/showToast\(/g)?.length ?? 0;

describe('issue 17 · 原生提示弹窗清零', () => {
  it('src/** 内没有一处代码调用 alert / confirm / prompt', () => {
    expect(offenders).toEqual([]);
  });

  it('总闸自己没扫空（免得路径一改就静默放行）', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('谱面代码弹窗的 8 处提示全接了 showToast', () => {
    // 应用成功 / 应用失败 / 校验不过（两条）/ 缺第 0 拍 BPM / 复制成功 / 复制失败 / 另存失败
    expect(toastCalls(codeModal)).toBe(8);
    expect(codeModal).toMatch(/showToast\(t\('chartCode\.applyOk'\), 'success'\)/);
    expect(codeModal).toMatch(/showToast\(t\('chartCode\.needBpm0'\), 'danger'\)/);
  });

  it('工程页两处（删最后一张谱面 / 新增谱面被拒）与工作台切换器一处同样接了 showToast', () => {
    expect(toastCalls(projectsPage)).toBe(2);
    expect(toastCalls(chartSwitcher)).toBe(1);
    // 「不能删最后一张」是拦住动作，不是出错 —— 走 warn 不走 danger
    expect(projectsPage).toMatch(/showToast\(t\('projects\.deleteLastChart'\), 'warn'\)/);
  });

  it('宿主在应用壳里挂了恰好一次（挂零处 = 提示发出去没人接）', () => {
    expect(shell.match(/<ToastHost\s*\/>/g)).toHaveLength(1);
  });

  it('提示条层高在弹窗之上（代码弹窗里的提示要压在它自己头上）', () => {
    expect(uiCss).toMatch(/\.toast\s*\{[^}]*z-index:\s*calc\(var\(--z-modal\)/);
    expect(toast).toMatch(/createPortal\(/);
  });
});
