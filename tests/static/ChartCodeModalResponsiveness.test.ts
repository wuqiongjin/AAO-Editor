// 谱面代码弹窗的响应性接线（issue 102）。
// 组件没有 DOM 测试基建（tests/README.md「环境」），这三件事又恰恰是**接线事实**
// ——「在哪里做」比「做出什么值」更值得锁，故走静态源码断言。
import { describe, it, expect } from 'vitest';
import { readSource, stripComments } from '@/tests/support/source';

const REL = 'src/chart/components/code-editor/ChartCodeEditorModal.tsx';
const src = readSource(REL);
const code = stripComments(src);

describe('谱面代码弹窗 · 打开两段式（不得同步跑全量序列化）', () => {
  it('不再在挂载 / 换档的同步路径上直接序列化 + stringify', () => {
    // 修复前：`resetDraft(currentViewText())` 就写在 target 的 effect 里，
    // 意味着 O(n) 遍历 + beat 排序 + JSON.stringify 全在弹窗首帧之前跑完。
    expect(code).not.toMatch(/resetDraft\(\s*currentViewText\(\)\s*\)/);
  });

  it('文本填充走空闲调度 + startTransition（先出空壳，再填空）', () => {
    // 空闲调度从 IdleSchedule 模块取（真单测覆盖），组件只负责把任务排进去
    expect(code).toMatch(/import\s*\{\s*scheduleIdle\s*\}\s*from\s*'\.\.\/\.\.\/editing\/IdleSchedule'/);
    expect(code).toMatch(/idleCancelRef\.current\s*=\s*scheduleIdle\(/);
    expect(code).toMatch(/startTransition\(\(\)\s*=>\s*\{\s*\n\s*resetDraft\(/);
    // 空壳状态真正被用在三处：占位符 / 只读 / 禁用应用
    expect(code).toMatch(/setGenerating\(true\)/);
    expect(code).toMatch(/readOnly=\{generating\}/);
    expect(code).toMatch(/placeholder=\{generating \? t\('chartCode\.generating'\)/);
    expect(code).toMatch(/disabled=\{!isValid \|\| generating\}/);
    // 挂了取消：target 变化 / 卸载时不留下"回头覆盖新视图"的任务
    expect(code).toMatch(/idleCancelRef\.current\?\.\(\)/);
  });

  it('完整视图显示走「每条音符一行」的紧凑序列化（行数 = 排版成本的主导项）', () => {
    // 4 空格缩进下 5000 音符 = 49,507 行；每条一行 = 5,003 行（首次布局 289ms → 30ms）
    expect(code).toMatch(/chartCodeToCompactJSON\(/);
    // 弹窗内不许再出现缩进序列化（另存为也已统一成这份紧凑文本，issue 102 覆盖 issue 118 口径）
    expect(code).not.toMatch(/null,\s*4/);
  });

  it('textarea 非受控：不再把整份大文本塞进受控 value（每敲一个字全量重写 DOM 的来源）', () => {
    expect(code).not.toMatch(/value=\{chartCode\}/);
    // 非受控后必须有「React 文本 → DOM」的单向同步出口，否则程序化改动（撤销/重置）会丢
    expect(code).toMatch(/ta\.value\s*=\s*chartCode/);
  });
});

describe('谱面代码弹窗 · 输入校验走防抖（打字停手后）', () => {
  it('handleCodeChange 不再同步调用 validateCode', () => {
    const from = code.indexOf('const handleCodeChange');
    const to = code.indexOf('const rejectNoteApply');
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    const handler = code.slice(from, to);
    // 「同步调 validateCode」在源码上必然表现为独占一行的语句（修复前就是
    // `        validateCode(newCode);`）。现在的写法只出现在防抖回调体里，不是语句的起头。
    expect(handler).not.toMatch(/\n\s*validateCode\(/);
    expect(handler).toMatch(/validationTask\.schedule\(\(\)\s*=>\s*validateCode\(/);
  });

  it('防抖窗口用一个具名常量表达（250ms 量级）', () => {
    expect(code).toMatch(/VALIDATE_DEBOUNCE_MS\s*=\s*\d{3}/);
  });

  it('「应用」即时结算：绕过防抖同步校验', () => {
    const from = code.indexOf('const handleApply');
    const to = code.indexOf('const handleReset');
    expect(to).toBeGreaterThan(from);
    const apply = code.slice(from, to);
    expect(apply).toMatch(/validationTask\.cancel\(\)/);
    expect(apply).toMatch(/validateCode\(chartCode\)/);
  });
});
