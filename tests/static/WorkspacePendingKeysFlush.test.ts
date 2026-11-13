import { describe, expect, it } from 'vitest';
import { readStripped } from '@/tests/support/source';

describe('issue 226 · WorkspacePage 开播前强刷在途未决同步（静态源码锁测）', () => {
  const editor = readStripped('src/pages/workspace/WorkspacePage.tsx');

  it('声明了 flushPendingKeysSync 回调以支持即时刷新', () => {
    expect(editor).toContain('flushPendingKeysSync');
  });

  it('handleTogglePlay 开播前必须执行 flushPendingKeysSync', () => {
    const idxToggle = editor.indexOf('const handleTogglePlay = useCallback');
    expect(idxToggle).toBeGreaterThan(0);
    const body = editor.slice(idxToggle, idxToggle + 300);
    expect(body).toMatch(/flushPendingKeysSync\(\);\s*togglePlay\(\);/);
  });

  it('jumpToMarker 开播前必须执行 flushPendingKeysSync', () => {
    const idxJump = editor.indexOf('const jumpToMarker = useCallback');
    expect(idxJump).toBeGreaterThan(0);
    const body = editor.slice(idxJump, idxJump + 300);
    expect(body).toMatch(/flushPendingKeysSync\(\);\s*sessionJumpToMarker\(\);/);
  });
});
