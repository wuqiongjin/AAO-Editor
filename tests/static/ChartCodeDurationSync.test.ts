// issue 145 #2：无音频导入谱面代码自动延长谱面长度时，必须写 **AudioSession**（单一真相源），
// 不能只写 PlaybackContext —— 后者是 `useAudioBridge` 单向同步的下游，写了会被 session 的
// 下一次 emit 反向覆盖（音频页「谱面时长」数字不跟着变 / 弹回旧值）。
import { describe, it, expect } from 'vitest';
import { readStripped } from '@/tests/support/source';

const MODAL = 'src/chart/components/code-editor/ChartCodeEditorModal.tsx';

describe('issue 162 · 无音频谱面时长只走 session', () => {
  const editor = readStripped('src/chart/Editor.tsx');
  const coordinator = readStripped('src/playback/usePlaybackCoordinator.ts');

  it('恢复工程时无音频灌的是 session.setChartDuration，不是只写 PlaybackContext', () => {
    expect(editor).toMatch(/audioSession\.hydrateFromProject/);
    expect(editor).toMatch(/audioSession\.setChartDuration\s*\(\s*project\.durationSeconds\s*\)/);
  });

  it('changeDuration 调 setChartDuration，不再直接 setCtxDuration', () => {
    const body = coordinator.slice(coordinator.indexOf('const changeDuration'));
    expect(body).toMatch(/setChartDuration\s*\(/);
    expect(body).not.toMatch(/setCtxDuration\s*\(/);
  });
});

describe('谱面代码弹窗 · 谱面时长走 session', () => {
  const src = readStripped(MODAL);

  it('自动延长那段调的是 session.setChartDuration', () => {
    expect(src).toMatch(/session\.setChartDuration\s*\(/);
  });

  it('弹窗不再从 usePlayback 取 setDuration（否则又是一条绕过 session 的通路）', () => {
    const m = src.match(/const\s*\{[^}]*\}\s*=\s*usePlayback\(\)/);
    expect(m, '弹窗应消费 usePlayback').toBeTruthy();
    expect(m![0]).not.toMatch(/\bsetDuration\b/);
  });
});
