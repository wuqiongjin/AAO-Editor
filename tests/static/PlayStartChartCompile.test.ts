// issue 101 锁测：开播帧不做全谱 getBpmEvents + buildKeyEvents。
import { describe, it, expect } from 'vitest';
import { readStripped } from '@/tests/support/source';

const editorSrc = readStripped('src/pages/workspace/WorkspacePage.tsx');

describe('Editor setChart · issue 101 编译移出开播帧', () => {
  it('isPlaying 翻 true 时不在同一 effect 同步 setChart', () => {
    expect(editorSrc).not.toMatch(
      /if\s*\(\s*playbackCoord\.isPlaying\s*\)\s*\{\s*engine\?\.setChart/,
    );
  });

  it('谱面编译只跟 notes/beatDisplay/engine，不把 isPlaying 当作立即编译开关', () => {
    const effect = editorSrc.match(/engine\?\.setChart\(notes,\s*beatDisplay\)[\s\S]{0,280}/);
    expect(effect?.[0]).toBeTruthy();
    expect(effect?.[0]).not.toMatch(/playbackCoord\.isPlaying/);
  });
});
