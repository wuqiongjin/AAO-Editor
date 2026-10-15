// issue 38 锁测 2（照 35/36 惯例）：激活 effect 内**先 flushPersist 再 reload** —— 次序锁死。
//
// 防的是"只重读不 flush"：工作台的音符编辑走 800ms 防抖落盘，防抖那笔落地不通知目录；
// 激活时若不先 flush，reload 读到的是防抖窗口前的旧记录（用户看到的就是"晚一次导航"的旧音符数）。
// 行为侧由 tests/dom/pages/ProjectsActiveReload.test.tsx 锁（flush 回调只在 flush 时落盘）；
// 本锁守源码次序，撤掉 flush 或把两步换序即红。
import { describe, expect, it } from 'vitest';
import { readStripped } from '@/tests/support/source';

const src = readStripped('src/pages/projects/ProjectsPage.tsx');

/** 激活 effect 整段：从 wasActiveRef 守卫到依赖数组收尾 */
function activationEffect(): string {
  const start = src.indexOf('const wasActiveRef = useRef(active)');
  if (start < 0) return '';
  const end = src.indexOf('}, [active, flushPersist, reload])', start);
  if (end < 0) return '';
  return src.slice(start, end);
}

describe('issue 38 · 工程页激活重读的次序锁', () => {
  it('ProjectsPage 收壳层的 active prop（保活页只切可见性，页面自己看得见激活）', () => {
    expect(src).toMatch(/export default function ProjectsPage\(\{ active = true \}: \{ active\?: boolean \}\)/);
  });

  it('激活 effect 的形状：false→true 边沿守卫 → flushPersist → reload（一段正则整体锁）', () => {
    expect(src).toMatch(
      /const wasActiveRef = useRef\(active\);[\s\S]*?useEffect\(\(\) => \{[\s\S]*?if \(!\(active && !wasActiveRef\.current\)\) \{[\s\S]*?await flushPersist\(\);\s*await reload\(\);/,
    );
  });

  it('flushPersist 严格先于 reload（换序即红：先读后写 = 读到防抖窗口前的旧记录）', () => {
    const block = activationEffect();
    const flushAt = block.indexOf('await flushPersist()');
    const reloadAt = block.indexOf('await reload()');
    expect(flushAt).toBeGreaterThan(-1);
    expect(reloadAt).toBeGreaterThan(-1);
    expect(flushAt).toBeLessThan(reloadAt);
  });

  it('激活 effect 的依赖就是 [active, flushPersist, reload]（激活边沿触发，不挂在 catalogEpoch 上）', () => {
    expect(src).toMatch(/\}, \[active, flushPersist, reload\]\)/);
  });

  it('目录变化那条 reload 不受影响（catalogEpoch 仍在依赖里：写路径的通知照旧生效）', () => {
    expect(src).toMatch(/useEffect\(\(\) => \{ void reload\(\); \}, \[reload, catalogEpoch\]\)/);
  });
});

// issue 38 复验（2026-10-15）：激活 effect 的 flushPersist() 曾打到**空注册柄**上——
// React 一个 commit 内先跑完 cleanup 阶段再跑 setup，setup 按树序（工程页在工作台之前），
// 而工作台每次渲染都换新 persistNow 闭包，导航提交里注册 effect 先被 cleanup 清空、
// 激活 effect 后跑、重新注册又晚于它。两处形状锁死：注册挂载一次（ref 包装），
// 钩子返回稳定句柄（churn 的根因）。
describe('issue 38 复验 · persist flush 注册不得被导航提交清空', () => {
  const wsSrc = readStripped('src/pages/workspace/WorkspacePage.tsx');
  const hookSrc = readStripped('src/project/useChartProjectPersistence.ts');

  it('WorkspacePage 的 flush 注册挂载一次：ref 包最新句柄，依赖只剩 registerPersistFlush', () => {
    expect(wsSrc).toMatch(
      /const persistNowRef = useRef\(persistNow\);\s*persistNowRef\.current = persistNow;\s*useEffect\(\(\) => \{\s*registerPersistFlush\(\(\) => persistNowRef\.current\(\)\);\s*return \(\) => registerPersistFlush\(null\);\s*\}, \[registerPersistFlush\]\)/,
    );
  });

  it('注册依赖里不得再出现 persistNow（出现即恢复 churn：cleanup 会在导航提交里清空注册柄）', () => {
    expect(wsSrc).not.toMatch(/\}, \[persistNow, registerPersistFlush\]\)/);
  });

  it('hook 的 saveNow 是稳定 useCallback（句柄 churn 是注册竞态的根因）', () => {
    expect(hookSrc).toMatch(/const saveNow = useCallback\(\(\): Promise<void> => \{[\s\S]*?\}, \[buildProject, ensureMerger\]\)/);
  });

  it('hook 返回值经 useMemo 求稳（调用方以它为 useCallback 依赖，新对象会传导 churn）', () => {
    expect(hookSrc).toMatch(/return useMemo\(/);
    expect(hookSrc).toMatch(/\(\) => \(\{\s*saveNow,/);
    expect(hookSrc).toMatch(/\[saveNow, waitUntilSettled\],/);
  });
});
