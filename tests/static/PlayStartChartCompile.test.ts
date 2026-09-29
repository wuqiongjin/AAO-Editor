// issue 101 锁测：开播帧不做全谱 getBpmEvents + buildKeyEvents。
import { describe, it, expect } from 'vitest';
import { readStripped } from '@/tests/support/source';

const editorSrc = readStripped('src/pages/workspace/WorkspacePage.tsx');

describe('Editor setChart · issue 101 编译移出开播帧', () => {
  it('isPlaying 翻 true 时不在同一 effect 同步 setChart', () => {
    // architecture-refactor/09（候选 4）：播放态由会话的 isPlaying 供给，不再有 playbackCoord
    expect(editorSrc).not.toMatch(
      /if\s*\(\s*(?:playbackCoord\.|viewSession\.)?isPlaying\s*\)\s*\{\s*engine\?\.setChart/,
    );
  });

  it('谱面编译只跟 notes/beatDisplay/engine，不把 isPlaying 当作立即编译开关', () => {
    const effect = editorSrc.match(/const delay = keysPlayingRef\.current[\s\S]{0,280}/);
    expect(effect?.[0]).toBeTruthy();
    expect(effect?.[0]).not.toMatch(/isPlaying/);
    expect(effect?.[0]).toMatch(/\}, \[notes, beatDisplay, engine\]\);/);
  });
});
