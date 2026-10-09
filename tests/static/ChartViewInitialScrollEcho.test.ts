// basic-editor 166：置底写入必须登记回声，且"打开/恢复 → 归零"必须在页面侧有接线。
//
// 组件接线（谁在写 scrollTop、谁在调归零）单测盖不到（jsdom 无布局，且这里是跨组件的调用契约），
// 故按 EditorAudioSessionRefactor / PlaybackSeekScrollSync 的惯例补一层静态源码断言。
import { describe, it, expect } from 'vitest';
import { readStripped } from '@/tests/support/source';

const session = readStripped('src/playback/useChartViewSession.ts');
const model = readStripped('src/playback/useScrollModel.ts');
const page = readStripped('src/pages/workspace/WorkspacePage.tsx');

/** 置底分支的源码段（`if (!initialScrollDone.current) { … } else {`）。 */
const initialScrollBody = (() => {
  const start = session.indexOf('if (!initialScrollDone.current) {');
  const end = session.indexOf('} else {', start);
  return start >= 0 && end > start ? session.slice(start, end) : '';
})();

describe('basic-editor 166 · 首次置底登记回声（RC-2）', () => {
  it('置底分支切片成功（防止后续改结构后断言空跑）', () => {
    expect(initialScrollBody).toContain('initialScrollDone.current');
    expect(initialScrollBody).toContain('markInitialized()');
  });

  it('置底写 scrollTop 后登记回声（否则它自己引发的 scroll 被当手滚 → 反算出非零秒）', () => {
    expect(initialScrollBody).toMatch(/scrollContainer\.scrollTop\s*=/);
    expect(initialScrollBody).toContain('registerScrollEcho');
  });
});

describe('basic-editor 166 RC-1 · 待重锚随几何同帧置位', () => {
  it('useScrollModel 把 chartEndKey 交给 configure（置位不再走 effect）', () => {
    expect(model).toMatch(/scrollModel\.configure\(geometry,\s*scale,\s*chartEndKey\)/);
    // 死通道检查：effect 版置位已删除（留着会被子画布的上报抢先，锚点照样被污染）
    expect(model).not.toMatch(/noteChartEndChange\(/);
  });
});

describe('basic-editor 166 · 打开 / 恢复谱面 → 归零到 beat 0（ADR-0005 §7）', () => {
  it('会话暴露 resetToStart', () => {
    expect(session).toContain('resetToStart: () => void;');
    expect(session).toMatch(/const resetToStart = useCallback\(/);
  });

  it('归零走 scrollTargetForSeconds(0, …) 并清锚点（与 issue 75 的 seek / RAF 同口径）', () => {
    expect(session).toMatch(/scrollTargetForSeconds\(0\s*,/);
    expect(session).toContain('resetAnchorToStart()');
  });

  it('归零在下一次提交落地（effect 不带依赖数组），不写进旧几何', () => {
    // 只锁"不带依赖数组"这个接线事实，不锁内部 ref 名（实现细节，第二步动结构会误报）；
    // "落地时几何已是新值"由 tests/dom/playback/ChartViewSessionStartOnRestore.test.tsx 行为锁守住。
    // （源码已去注释，不能按注释切片，改为直接抓"引用 applyResetToStart 的那条 useEffect"）
    const resetEffect = session.match(
      /useEffect\(\(\) => \{[\s\S]{0,400}?applyResetToStart\(\)[\s\S]{0,160}?\n\s*\}\);/,
    )?.[0] ?? '';
    expect(resetEffect).toMatch(/useEffect\(\(\) => \{\s*if \(!\w+\.current\) return;/);
    // 依赖数组缺席 = 每次提交都检查一次（恢复那次提交未必改变任何既有依赖）
    expect(resetEffect).not.toMatch(/\}, \[/);
  });

  it('工程恢复 / 记录侧音频变更两条恢复路径都调用 resetToStart', () => {
    const restoreBody = page.slice(
      page.indexOf('const handleProjectRestore = useCallback('),
      page.indexOf('const handleRecordAudioChanged = useCallback('),
    );
    const audioBody = page.slice(
      page.indexOf('const handleRecordAudioChanged = useCallback('),
      page.indexOf('const persistence = useChartProjectPersistence('),
    );
    expect(restoreBody).toContain('resetToStart()');
    expect(audioBody).toContain('resetToStart()');
  });
});
