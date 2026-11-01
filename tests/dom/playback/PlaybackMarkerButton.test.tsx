// @vitest-environment jsdom
// issue 179 锁测：播放条时间码旁的播放起点按钮（177 Q13 / Q25）
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import PlaybackMarkerButton from '@/src/playback/PlaybackMarkerButton';
import { formatTimePrecise } from '@/src/chart/geometry/TimeFormat';
import { t } from '@/src/i18n';

const btn = () => screen.getByRole('button', { name: t('editor.markerJumpAria') });
const queryBtn = () => screen.queryByRole('button', { name: t('editor.markerJumpAria') });
/** jsdom 没有 AnimationEvent → React 退而监听带前缀的 webkitAnimationEnd；两种名字都派发 */
const endAnimation = (el: HTMLElement) => {
  fireEvent(el, new Event('animationend', { bubbles: true }));
  fireEvent(el, new Event('webkitAnimationEnd', { bubbles: true }));
};

describe('issue 179 · 播放起点按钮', () => {
  it('没设起点时不渲染', () => {
    render(<PlaybackMarkerButton seconds={null} shortcut="Shift+Space" onJump={vi.fn()} />);
    expect(queryBtn()).not.toBeInTheDocument();
  });

  it('设了起点：显示起点时间（与播放条同口径），点 = 跳回并播放', () => {
    const onJump = vi.fn();
    render(<PlaybackMarkerButton seconds={12.3} shortcut="Shift+Space" onJump={onJump} />);
    expect(btn()).toHaveTextContent(formatTimePrecise(12.3));
    fireEvent.click(btn());
    expect(onJump).toHaveBeenCalledTimes(1);
  });

  it('跟随 timePrecision 渲染对应精度时间码', () => {
    const { rerender } = render(<PlaybackMarkerButton seconds={12.345} shortcut="Shift+Space" onJump={vi.fn()} />);
    expect(btn()).toHaveTextContent('00:12.3');

    rerender(<PlaybackMarkerButton seconds={12.345} shortcut="Shift+Space" timePrecision="centisecond" onJump={vi.fn()} />);
    expect(btn()).toHaveTextContent('00:12.34');

    rerender(<PlaybackMarkerButton seconds={12.345} shortcut="Shift+Space" timePrecision="millisecond" onJump={vi.fn()} />);
    expect(btn()).toHaveTextContent('00:12.345');
  });

  it('只在「无 → 有」时播出现动效；动效播完即摘；挪动起点不重播', () => {
    const props = { shortcut: 'Shift+Space', onJump: vi.fn() };
    const { rerender } = render(<PlaybackMarkerButton seconds={null} {...props} />);
    rerender(<PlaybackMarkerButton seconds={3} {...props} />);
    expect(btn()).toHaveClass('is-new');

    endAnimation(btn());
    expect(btn()).not.toHaveClass('is-new');

    rerender(<PlaybackMarkerButton seconds={8} {...props} />);
    expect(btn()).not.toHaveClass('is-new');
  });

  it('挂载时已有起点不播动效（例如刚打开显隐开关）', () => {
    render(<PlaybackMarkerButton seconds={3} shortcut={null} onJump={vi.fn()} />);
    expect(btn()).not.toHaveClass('is-new');
  });
});
