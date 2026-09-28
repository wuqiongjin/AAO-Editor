// issue 23 #1：改写「当前工程」与「进入工作台」是两件事（ADR-0015 §3 补充）。
//
// 两者若绑在一个函数里，"新建工程"就被迫"打开工作台"——而空白新建的谱面连歌曲、难度、
// 封面都没填，谱师被直接推进空工作台。拆开之后必须防回潮：**跳工作台只允许发生在
// enterWorkspace 一处**。谁要是把 setActivePage('workspace') 又写回创建/复制路径，这条会红。
//
// 照 NoWindowConfirm.test.ts 的惯例：扫代码不扫注释，路径从仓库根算起。
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

/** 全仓 setActivePage('workspace') 的出现处：文件 → 次数 */
const hits = new Map<string, number>();
let total = 0;
for (const rel of files) {
  const matches = readStripped(rel).match(/setActivePage\(\s*['"]workspace['"]/g);
  if (matches) {
    hits.set(rel, matches.length);
    total += matches.length;
  }
}

describe('issue 23 #1 · 进入工作台只有一个入口', () => {
  it("setActivePage('workspace') 全仓只有一处，且在 ProjectsPage", () => {
    // 必须按**次数**断言，不能只按"哪些文件出现过"——同一文件里多写一处正是
    // 本票要防的回潮形态（创建路径被偷偷加回跳页），按文件去重会漏掉它。
    expect(total).toBe(1);
    expect([...hits.keys()]).toEqual(['src/pages/ProjectsPage.tsx']);
  });

  it('那一处是 enterWorkspace，且 setCurrent 不跳页', () => {
    const src = readStripped('src/pages/ProjectsPage.tsx');

    // enterWorkspace = setCurrent + setActivePage（跳页那一个）
    const enter = src.match(/const\s+enterWorkspace\s*=\s*useCallback\(([\s\S]*?)\n\s*\}\s*,\s*\[/);
    expect(enter, 'enterWorkspace 不见了').toBeTruthy();
    expect(enter![1]).toContain('setCurrent(');
    expect(enter![1]).toContain("setActivePage('workspace')");

    // setCurrent 只改当前工程，**不**跳页
    const setCurrent = src.match(/const\s+setCurrent\s*=\s*useCallback\(([\s\S]*?)\n\s*\}\s*,\s*\[/);
    expect(setCurrent, 'setCurrent 不见了').toBeTruthy();
    expect(setCurrent![1]).not.toContain('setActivePage');

    // 创建 / 复制都走 setCurrent + 切视图，不走 enterWorkspace
    for (const fn of ['createBlank', 'copyProject']) {
      const body = src.match(new RegExp(`const\\s+${fn}\\s*=\\s*useCallback\\(([\\s\\S]*?)\\n\\s*\\}\\s*,\\s*\\[`));
      expect(body, `${fn} 不见了`).toBeTruthy();
      expect(body![1], `${fn} 必须调 setCurrent`).toContain('setCurrent(');
      expect(body![1], `${fn} 不得跳工作台`).not.toContain('enterWorkspace(');
    }
  });

  it('总闸自己没扫空（免得路径一改就静默放行）', () => {
    expect(files.length).toBeGreaterThan(100);
  });
});
