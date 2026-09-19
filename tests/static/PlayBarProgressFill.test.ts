// 进度条蓝线不再用 CSS transition（修 "蓝线滞后圆点"）：
// rAF 60fps 重渲 + 160ms width transition 在某些 GPU 合成路径上
// 会让蓝线卡在旧值几秒,而圆点瞬移,造成位置错位。本测试锁住"蓝线 div
// 不带 transition"这一约束,防止以后回填老逻辑。
import { describe, it, expect } from 'vitest';
import { readSource } from '@/tests/support/source';

describe('PlayBar 进度条蓝线', () => {
  const src = readSource('src/playback/PlayBar.tsx');

  it('已播放填充 div 不应带 width transition（避免 rAF 高频更新下蓝线滞后圆点）', () => {
    // 抽出"已播放填充"注释块对应的 div
    const m = src.match(/\{\/\* 已播放填充[\s\S]*?<\/div>/);
    expect(m, 'PlayBar.tsx 应存在"已播放填充"div 块').toBeTruthy();
    const block = m![0];
    // 只匹配 transition CSS 字符串字面量里的 width 关键字
    // 形式: transition: '...width...'  或  transition: "...width..."
    expect(block).not.toMatch(/transition\s*:\s*['"`][^'"`]*\bwidth\b[^'"`]*['"`]/);
  });

  it('PlayBar.tsx 仍保留 dragging 状态机（拖动判断不受影响）', () => {
    expect(src).toMatch(/const\s+\[dragging\s*,\s*setDragging\]\s*=\s*useState\(false\)/);
  });
});
