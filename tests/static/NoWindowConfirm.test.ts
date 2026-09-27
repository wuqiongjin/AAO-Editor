// issue 13：删除 / 覆盖确认一律走自绘 ConfirmDialog —— 这是防止哪天又偷偷加回
// 原生 window.confirm 的总闸（票里点名要这条）。
// 扫的是**代码**（注释不算）：ConfirmDialog 自己的说明里就有这个词，注释里的示例也不该误伤。
// 确有必要的例外必须写进 13 票的 Comments，不许在这里加白名单糊过去。
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

const offenders = files.filter((rel) => /window\s*\.\s*confirm\s*\(/.test(readStripped(rel)));

/** 四处调用点各自的接线：确认弹窗必须出现在这些文件里 */
const projectsPage = readStripped('src/pages/ProjectsPage.tsx');
const codeModal = readStripped('src/chart/components/code-editor/ChartCodeEditorModal.tsx');

describe('issue 13 · 原生 window.confirm 清零', () => {
  it('src/** 内没有一处代码调用 window.confirm', () => {
    expect(offenders).toEqual([]);
  });

  it('总闸自己没扫空（免得路径一改就静默放行）', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('两处删除（工程 / 单张谱面）都接到 ConfirmDialog', () => {
    expect(projectsPage.match(/<ConfirmDialog/g)).toHaveLength(2);
  });

  it('两处代码编辑器确认（丢弃草稿 / 覆盖应用）都接到 ConfirmDialog', () => {
    expect(codeModal.match(/<ConfirmDialog/g)).toHaveLength(2);
  });
});
