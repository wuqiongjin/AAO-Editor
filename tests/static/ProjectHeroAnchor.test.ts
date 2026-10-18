// issue 40 静态锁：横幅锚必须活派生、口径与排序键同源（照 ProjectTimeFollowsSort 惯例）。
//
// 回溜形态 = 把默认锚固化成 state（useEffect setSelectedId(default)）——快照不随列表重排走，
// 正是 a)「打开工程后回主页横幅滞留老工程」的根因；或锚写死与 sort 无关（b) 的根因）。
import { describe, expect, it } from 'vitest';
import { readStripped } from '@/tests/support/source';

const HUB = 'src/pages/projects/components/ProjectHub.tsx';
const SORT = 'src/project/projectSort.ts';

describe('issue 40 · 横幅锚活派生且跟随排序键', () => {
  it('锚是 projectSort 的纯函数，口径经 projectTimeAt（与排序键同源的回落规则）', () => {
    const src = readStripped(SORT);
    expect(src).toMatch(/export function sortAnchorId\(/);
    // 撤掉 projectTimeAt 调用（另写一套 lastOpened 口径）→ 本条红
    expect(src).toMatch(/export function sortAnchorId\([\s\S]*?projectTimeAt\(/);
  });

  it('hub 的锚调 sortAnchorId(list, sort)：排序键进锚，不再走 mostRecentlyOpenedId', () => {
    const src = readStripped(HUB);
    expect(src).toMatch(/sortAnchorId\(list, sort\)/);
    expect(src).not.toMatch(/mostRecentlyOpenedId/);
  });

  it('hub 不把锚固化成 state：无 setSelectedId(锚 / 生效选中) 回写', () => {
    const src = readStripped(HUB);
    expect(src).not.toMatch(/setSelectedId\(anchorId\)/);
    expect(src).not.toMatch(/setSelectedId\(effectiveSelectedId\)/);
  });

  it('手动焦点两个让位点在场：排序切换与打开工程都清 selectedId', () => {
    const src = readStripped(HUB);
    expect(src.match(/setSelectedId\(null\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(src).toMatch(/const openProject = useCallback\(/);
    // 打开出口包了一层：按钮不直接调 onOpen（绕过去 = 让位点丢了）
    expect(src).not.toMatch(/onClick=\{\(\) => onOpen\(/);
  });
});
