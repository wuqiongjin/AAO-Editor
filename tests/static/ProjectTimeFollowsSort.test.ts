// issue 37 锁测 3：两视图的工程时间显示必经 projectTimeAt（照 35 的静态断言惯例）。
//
// 定案（用户 2026-10-14）：列表时间戳跟随排序键 —— lastModified 键显示派生修改时间，
// 其余键显示 lastOpened，且贴短标签。回溜形态 = 视图里写死 `p.lastOpened` /
// `selected.lastOpened`：排序切到「最近修改」后，顺序按 max(charts.lastModified) 排、
// 眼睛看到的还是「上次打开」——本票的症状原样复发。DOM 锁测只覆盖 hub（详情页要先进
// 详情视图才看得到左栏），这里的静态断言把两视图一起钉死。
//
// 钉法：
//   1. projectTimeAt 是 projectSort.ts 的导出函数，且 lastModified 走派生口径；
//   2. hub（hero + 卡片副行）与详情（左栏 doneRatio 行）都调它，且两视图剥掉字符串
//      字面量后不出现 `.lastOpened` 字段直读（i18n 键名 'projects.lastOpened' 不算）；
//   3. 详情页的 sort prop 由 ProjectsPage 传入，且与 hub 同源（settings.projects.sort）。
import { describe, expect, it } from 'vitest';
import { readStripped } from '@/tests/support/source';

const HUB = 'src/pages/projects/components/ProjectHub.tsx';
const DETAIL = 'src/pages/projects/components/ProjectDetail.tsx';
const PAGE = 'src/pages/projects/ProjectsPage.tsx';

/**
 * 剥掉字符串字面量（模板串 / 单引号 / 双引号）：断言字段访问时，先把 i18n 键名
 * （如 'projects.lastOpened'）与文案请出去，只留代码结构。先剥模板串——
 * 它内部可含引号，留到后面会被引号规则切碎。
 */
function withoutStringLiterals(src: string): string {
  return src.replace(/`[^`]*`/g, '``').replace(/'[^'\n]*'/g, "''").replace(/"[^"\n]*"/g, '""');
}

describe('issue 37 · 工程时间显示必经 projectTimeAt', () => {
  it('projectTimeAt 是 projectSort.ts 的纯函数，lastModified 走派生口径', () => {
    const src = readStripped('src/project/projectSort.ts');
    expect(src).toMatch(/export function projectTimeAt\(/);
    // 撤掉 case 'lastModified' 分支（一律回落 lastOpened）→ 本条红
    expect(src).toMatch(/case 'lastModified':\s*return projectLastModified\(project\)/);
  });

  it('hub：hero 与卡片副行都经 projectTimeAt，两处以上', () => {
    const src = readStripped(HUB);
    const calls = src.match(/projectTimeAt\(/g) ?? [];
    expect(calls.length, 'hero + 卡片副行各一处，少一处就是有显示口径绕开了它').toBeGreaterThanOrEqual(2);
  });

  it('详情：左栏 doneRatio 行经 projectTimeAt', () => {
    expect(readStripped(DETAIL)).toMatch(/projectTimeAt\(/);
  });

  it('两视图不写死工程 lastOpened 字段（防回溜；i18n 键名不算）', () => {
    for (const file of [HUB, DETAIL]) {
      expect(withoutStringLiterals(readStripped(file)), file).not.toMatch(/\.lastOpened\b/);
    }
  });

  it('详情页 sort 由 ProjectsPage 传入，与 hub 同源 settings.projects.sort', () => {
    const page = readStripped(PAGE);
    expect(page).toMatch(/settings\.projects\.sort/);
    expect(page).toMatch(/sort=\{sortKey\}/);
    // 详情侧签名收 ProjectSortKey（与 hub 的 sort prop 同型同源）
    expect(readStripped(DETAIL)).toMatch(/sort: ProjectSortKey/);
  });
});
