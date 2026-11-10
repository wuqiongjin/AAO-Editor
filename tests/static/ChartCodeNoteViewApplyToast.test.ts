// issue 227 · 音符代码弹窗「对象视图」应用成功必须有 toast 的**静态看守**。
//
// 根因：handleApply 的两条成功出口分叉 —— 完整视图走 commitApply（内带 applyOk success toast），
// 对象视图（target.kind === 'note'）只 handleNotesChange + close，漏了成功反馈。
// toast 是 portal 到 document.body 的全局宿主（ui/Toast.tsx），close() 不会吞掉它 ⇒ 纯粹是漏发，
// 不是「被弹窗关闭顶掉」。DOM 时序（模块级 emit + portal）单测盖不到接线，按本仓惯例用静态源码断言。
import { describe, it, expect } from 'vitest';
import { readStripped, readSource } from '@/tests/support/source';

const MODAL = 'src/chart/components/code-editor/ChartCodeEditorModal.tsx';
const ZH = 'src/i18n/messages/zh-CN.json';

/** 与 commitApply 里既有调用逐字一致 —— 两条成功出口共用同一款反馈 */
const APPLY_OK_TOAST = "showToast(t('chartCode.applyOk'), 'success')";

/** 取 handleApply 里「对象视图 if」到「完整视图 commitApply 调用」之间的片段 */
function noteViewBranch(src: string): string {
  const from = src.indexOf("if (target.kind === 'note')");
  const to = src.indexOf('commitApply(parsedCode, chartCode)', from);
  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);
  return src.slice(from, to);
}

describe('issue 227 · 音符代码弹窗对象视图应用成功 toast', () => {
  const src = readStripped(MODAL);

  it('两条成功出口各弹一次同款 success toast（缺一处即某条出口漏反馈）', () => {
    expect(src.split(APPLY_OK_TOAST)).toHaveLength(3);
  });

  it('对象视图成功分支：回写画布后、关闭弹窗前弹 toast', () => {
    const branch = noteViewBranch(src);
    expect(branch).toContain('handleNotesChange(r.notes)');
    expect(branch).toContain(APPLY_OK_TOAST);
    expect(branch).toContain('close()');
    // 先反馈、再收尾，与完整视图 commitApply 同序
    expect(branch.indexOf(APPLY_OK_TOAST)).toBeLessThan(branch.indexOf('close()'));
  });

  it('对象视图回写被拒仍走 danger 提示，且失败路径不落到 success toast', () => {
    const branch = noteViewBranch(src);
    expect(branch).toContain('rejectNoteApply(');
    // 两处 reject 都在成功 toast 之前（先 return，不落到回写成功）
    expect(branch.indexOf('rejectNoteApply(')).toBeLessThan(branch.indexOf(APPLY_OK_TOAST));
    // 关键：每个 reject 必须紧跟 return —— 否则删掉 return 后失败会穿透到 success toast，
    // 而「第一条 reject 在 toast 之前」这种位置断言仍会假绿。
    expect(branch.match(/rejectNoteApply\([^)]*\);\s*return;/g)).toHaveLength(2);
  });

  it('成功文案键 chartCode.applyOk 存在（两条出口文案同源）', () => {
    expect(readSource(ZH)).toContain('"chartCode.applyOk"');
  });
});
