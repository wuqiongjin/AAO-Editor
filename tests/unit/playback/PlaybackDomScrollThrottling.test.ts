// issue 213 锁测：播放态 DOM 滚动降频与解耦
// 1. 播放中 Canvas setScrollY 保持每帧执行（120Hz 虚拟滚动不降级）；
// 2. DOM container.scrollTop 按 ~33ms (约 30fps) 降频同步，消除 120Hz 下高频重排与合成器颠簸；
// 3. 停止播放（stopPlayback）与跳转（seek）时 DOM scrollTop 立即 1:1 吸附同步（保持 issue 75 / 134 不变量）。
import { describe, it, expect } from 'vitest';
import { readStripped } from '@/tests/support/source';
import { DOM_SCROLL_SYNC_PERIOD_MS } from '@/src/playback/usePlaybackCoordinator';

const coordSrc = readStripped('src/playback/usePlaybackCoordinator.ts');

describe('issue 213 · 播放态 DOM 滚动降频与即时吸附', () => {
  it('DOM_SCROLL_SYNC_PERIOD_MS 定义为 33ms (~30fps)', () => {
    expect(DOM_SCROLL_SYNC_PERIOD_MS).toBe(33);
  });

  it('RAF 循环中 setScrollY 保持每帧调用（不被降频截断）', () => {
    const rafBody = coordSrc.slice(
      coordSrc.indexOf('const startPlaybackLoop'),
      coordSrc.indexOf('const togglePlay'),
    );
    expect(rafBody).toMatch(/canvas\.setScrollY\(scrollY\)/);
  });

  it('RAF 循环中 container.scrollTop 同步带有 DOM_SCROLL_SYNC_PERIOD_MS 门控守卫', () => {
    const rafBody = coordSrc.slice(
      coordSrc.indexOf('const startPlaybackLoop'),
      coordSrc.indexOf('const togglePlay'),
    );
    expect(rafBody).toMatch(/DOM_SCROLL_SYNC_PERIOD_MS/);
    expect(rafBody).toMatch(/lastScrollSyncAt/);
  });

  it('stopPlayback 时立即同步吸附 container.scrollTop，杜绝停止时滚动条残留偏差', () => {
    const stopBody = coordSrc.slice(
      coordSrc.indexOf('const stopPlayback = useCallback'),
      coordSrc.indexOf('const startPlaybackLoop'),
    );
    expect(stopBody).toMatch(/scrollTargetForSeconds/);
    expect(stopBody).toMatch(/container\.scrollTop\s*=/);
  });
});
