// issue 75：seek（PlayBar 拖动 / 外部跳转）必须与播放 RAF 循环**同源**写入滚动条 DOM scrollTop。
// 只在模型侧加单测挡不住"组件又只推画布"的回归（组件接线无法脱离 DOM 单测），
// 故按 EditorAudioSessionRefactor 的惯例补一层静态源码断言。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(
  join(__dirname, '../../src/playback/usePlaybackCoordinator.ts'),
  'utf-8',
);
const codeOnly = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

const seekBody = codeOnly.slice(
  codeOnly.indexOf('const seek = useCallback('),
  codeOnly.indexOf('const jumpToMarker'),
);

describe('usePlaybackCoordinator · seek 同步滚动条（issue 75）', () => {
  it('seek 取自 seek 函数体（切片成功，防止后续改名后断言空跑）', () => {
    expect(seekBody).toContain('const seek = useCallback(');
    expect(seekBody).toContain('stopPlayback()');
  });

  it('seek 走 scrollTargetForSeconds（与 RAF 循环同一口径，不再自算 scrollY）', () => {
    expect(seekBody).toContain('scrollTargetForSeconds');
  });

  it('seek 必须写滚动条 container.scrollTop（只推画布 = 两个真相源分裂 → 切页后滚动跳回旧位置）', () => {
    expect(seekBody).toMatch(/container\.scrollTop\s*=/);
  });

  it('seek 带 0.5px 防抖守卫（避免与 scroll 事件自锁）', () => {
    expect(seekBody).toMatch(/Math\.abs\(scrollTop\s*-\s*container\.scrollTop\)\s*>\s*0\.5/);
  });

  it('RAF 循环与 seek 共用同一个 scrollTargetForSeconds（≥2 处调用）', () => {
    expect((codeOnly.match(/scrollTargetForSeconds/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('RAF 循环同样写 container.scrollTop（保持既有行为不被重构吃掉）', () => {
    const rafBody = codeOnly.slice(
      codeOnly.indexOf('const startPlaybackLoop'),
      codeOnly.indexOf('const togglePlay'),
    );
    expect(rafBody).toContain('scrollTargetForSeconds');
    expect(rafBody).toMatch(/container\.scrollTop\s*=/);
  });
});
