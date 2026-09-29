// issue 135：Esc 五档链政策只走 resolveEscapeTarget；Editor 消费表，cancel 不伪造后三档。
import { describe, it, expect } from 'vitest';
import { readStripped } from '@/tests/support/source';

const editor = readStripped('src/pages/workspace/WorkspacePage.tsx');
const session = readStripped('src/chart/editing/GestureSession.ts');
const canvas = readStripped('src/chart/components/canvas/FinalVirtualCanvas.tsx');

describe('issue 135 · Esc 五档链唯一裁决', () => {
  it('Editor.onEscape 问 resolveEscapeTarget，不靠 cancelActiveGesture 抢先落档', () => {
    expect(editor).toMatch(/resolveEscapeTarget\s*\(/);
    expect(editor).toMatch(/onEscape:\s*useCallback\(\s*\(\)\s*=>\s*\{/);
    const onEscape = editor.match(/onEscape:\s*useCallback\(\s*\(\)\s*=>\s*\{[\s\S]*?\},\s*\[[^\]]*\]\)/)?.[0] ?? '';
    expect(onEscape).toContain('resolveEscapeTarget');
    const askAt = onEscape.indexOf('resolveEscapeTarget');
    const gestureAt = onEscape.indexOf('cancelActiveGesture');
    const anchorAt = onEscape.indexOf('cancelPendingSlide');
    expect(askAt).toBeGreaterThanOrEqual(0);
    expect(gestureAt).toBeGreaterThan(askAt);
    expect(anchorAt).toBeGreaterThan(askAt);
  });

  it('画布提供完整快照入口（手势四旗 + 锚点），选区/工具态由 Editor 填', () => {
    expect(canvas).toMatch(/getEscapeFlags\s*:/);
    const flagsFn = canvas.match(/getEscapeFlags\s*:\s*\(\)\s*=>\s*\(\{[\s\S]*?\}\)/)?.[0] ?? '';
    expect(flagsFn).toContain('escapeGestureFlags()');
    expect(flagsFn).toMatch(/slideBuffer\s*!==\s*null/);
    expect(flagsFn).toMatch(/curveDraft\s*!==\s*null/);
  });

  it('GestureSession.cancel 不伪造后三档、不问五档表', () => {
    expect(session).not.toMatch(/resolveEscapeTarget/);
    expect(session).not.toMatch(/anchor\s*:\s*false/);
    expect(session).not.toMatch(/selection\s*:\s*false/);
    expect(session).not.toMatch(/tool\s*:\s*false/);
  });
});
