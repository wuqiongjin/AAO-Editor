// @vitest-environment jsdom
// 播放条的 DOM 锁测（issue 49 阶段 3 迁出 inline；issue 22 props 化 + 外壳变体）。
//
// 为什么要这一组：props 化把数据入口从 context 挪到 props —— 行为等价性得有一条可执行断言。
// 票 22「锁测」的 A 案额外项（工作台既有口径：播放状态 / 时间码 / 拖拽 seek / 音量）逐条落在这里，
// 外加复用侧的两个开关（`canEditTime` / `rateSlot`）；外壳变体是 CSS 契约，由静态锁与真机截图守。
//
// 按 `tests/README.md` 的 dom 约定：role / text 查询、断言行为。图标是"播放中 / 暂停中"唯一的
// DOM 表达（无 role 可查），这里只断言"随状态切换"（两态 innerHTML 不同），不绑具体图形。
//
// 拖拽 seek 在 jsdom 里没有布局：`getBoundingClientRect` 按用例手工钉住，
// 验证的是「指针位置 → 目标秒」的换算与"抬手后不再跟随"的状态机。
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import PlayBar, { type PlayBarProps } from '@/src/playback/PlayBar';
import { t } from '@/src/i18n';

function renderBar(overrides: Partial<PlayBarProps> = {}) {
  const props: PlayBarProps = {
    isPlaying: false,
    currentSeconds: 5,
    duration: 60,
    volume: 0.8,
    shortcutKey: 'Space',
    onTogglePlay: vi.fn(),
    onVolumeChange: vi.fn(),
    onSeek: vi.fn(),
    ...overrides,
  };
  const view = render(<PlayBar {...props} />);
  return { ...view, props };
}

const playBtn = () => screen.getByRole('button', { name: t('play.toggle', { key: 'Space' }) });
const seekSlider = () => screen.getByRole('slider', { name: t('play.progress') });
const volumeSlider = () => screen.getByRole('slider', { name: t('play.volume') });

/** 钉住进度条盒（jsdom 没有布局）：left 100 / 宽 200 ⇒ clientX 100 = 0 秒、300 = 全长 */
const pinTrackBox = (track: HTMLElement) => {
  track.getBoundingClientRect = () => ({
    left: 100, width: 200, top: 0, height: 18, right: 300, bottom: 18, x: 100, y: 0,
    toJSON: () => ({}),
  }) as DOMRect;
};

describe('播放条（PlayBar）· 工作台口径', () => {
  it('播放状态：图标随状态切换；点击走 onTogglePlay；title 带快捷键提示', () => {
    const { props, rerender } = renderBar();
    expect(playBtn().title).toBe(t('play.toggle', { key: 'Space' })); // 快捷键提示来自 shortcutKey
    fireEvent.click(playBtn());
    expect(props.onTogglePlay).toHaveBeenCalledTimes(1);

    const pausedIcon = playBtn().innerHTML;
    rerender(<PlayBar {...props} isPlaying />);
    expect(playBtn().innerHTML).not.toBe(pausedIcon);
  });

  it('时间码：当前时间精确到 0.1 秒、总时长整秒；audioLocked 时出锁图标与提示', () => {
    const { props, rerender } = renderBar({ currentSeconds: 5.4, duration: 65 });
    expect(screen.getByText('00:05.4')).toBeTruthy();
    expect(screen.getByText(/01:05/)).toBeTruthy();
    expect(screen.queryByLabelText(t('audio.lockedPrompt'))).toBeNull();

    rerender(<PlayBar {...props} audioLocked />);
    expect(screen.getByLabelText(t('audio.lockedPrompt'))).toBeTruthy();
  });

  it('拖拽 seek：按下即定位、拖动跟手、抬手后不再跟随', () => {
    const { props } = renderBar({ duration: 60 });
    const track = seekSlider();
    pinTrackBox(track);

    fireEvent.pointerDown(track, { clientX: 200 });
    expect(props.onSeek).toHaveBeenLastCalledWith(30); // 正中 = 一半

    fireEvent.pointerMove(track, { clientX: 300 });
    expect(props.onSeek).toHaveBeenLastCalledWith(60); // 拖到右缘

    fireEvent.pointerUp(track, { clientX: 300 });
    fireEvent.pointerMove(track, { clientX: 100 });
    expect(props.onSeek).toHaveBeenCalledTimes(2); // 抬手后不再跟随
  });

  it('拖拽 seek：越出左右缘就地钳到 [0, duration]', () => {
    const { props } = renderBar({ duration: 60 });
    const track = seekSlider();
    pinTrackBox(track);

    fireEvent.pointerDown(track, { clientX: -9999 });
    expect(props.onSeek).toHaveBeenLastCalledWith(0);
    fireEvent.pointerMove(track, { clientX: 9999 });
    expect(props.onSeek).toHaveBeenLastCalledWith(60);
  });

  it('进度条是 role=slider：aria 量程按谱面长度、当前值按播放头', () => {
    renderBar({ currentSeconds: 12.4, duration: 60 });
    const track = seekSlider();
    expect(track.getAttribute('aria-valuemax')).toBe('60');
    expect(track.getAttribute('aria-valuenow')).toBe('12');
  });

  it('音量：滑杆改值走 onVolumeChange；0 时仍可调（图标换静音）', () => {
    const { props, rerender } = renderBar({ volume: 0.8 });
    const input = volumeSlider() as HTMLInputElement;
    expect(Number(input.value)).toBe(0.8);
    expect(input.getAttribute('min')).toBe('0');
    expect(input.getAttribute('max')).toBe('1');
    fireEvent.change(input, { target: { value: '0.35' } });
    expect(props.onVolumeChange).toHaveBeenCalledWith(0.35);

    const loudIcon = volumeSlider().parentElement!.innerHTML;
    rerender(<PlayBar {...props} volume={0} />);
    expect(volumeSlider().parentElement!.innerHTML).not.toBe(loudIcon); // 静音图标换上了
  });

  it('时间码双击：canEditTime=false 不出输入框（工作台"有音频禁止编辑定位"口径）', () => {
    const { props } = renderBar({ currentSeconds: 5 });
    fireEvent.doubleClick(screen.getByText('00:05.0'));
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(props.onSeek).not.toHaveBeenCalled();
  });

  it('时间码双击：canEditTime=true 时回车提交（mm:ss 口径 / 越界钳制 / Esc 放弃）', () => {
    const { props } = renderBar({ currentSeconds: 5, duration: 60, canEditTime: true });

    fireEvent.doubleClick(screen.getByText('00:05.0'));
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('00:05.0'); // 草稿 = 当前时间码

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '0:12.5' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(props.onSeek).toHaveBeenLastCalledWith(12.5);
    expect(screen.queryByRole('textbox')).toBeNull(); // 提交后收起

    fireEvent.doubleClick(screen.getByText('00:05.0'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '9:00' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(props.onSeek).toHaveBeenLastCalledWith(60); // 上钳到 duration

    fireEvent.doubleClick(screen.getByText('00:05.0'));
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(screen.queryByRole('textbox')).toBeNull(); // Esc 放弃
    expect(props.onSeek).toHaveBeenCalledTimes(2);
  });

  it('倍速是可选 slot：不传就不渲染（工作台）；传了才出现（预览）', () => {
    const { props, rerender } = renderBar();
    expect(screen.queryByText('fake-rate')).toBeNull();

    rerender(<PlayBar {...props} rateSlot={<span>fake-rate</span>} />);
    expect(screen.getByText('fake-rate')).toBeTruthy();
  });
});
