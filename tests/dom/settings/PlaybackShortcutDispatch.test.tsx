// @vitest-environment jsdom
// issue 230 · 工作台四键分发的 DOM 锁测：接缝 = 键盘事件 → useShortcutDispatch → runFunction。
// 与 WorkspaceBeatSnapShortcut.test.tsx 同范式（分发验证台）；真实页面的 case 接线由 static 锁守。
import '@testing-library/jest-dom/vitest';
import { useCallback, useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  getDefaultConfig,
  setCapturingShortcut,
  type FunctionId,
  type ShortcutConfig,
} from '@/src/settings/ShortcutConfig';
import { useShortcutDispatch } from '@/src/settings/useShortcutDispatch';
import {
  HOLD_REPEAT_DELAY_MS,
  HOLD_REPEAT_INTERVAL_MS,
} from '@/src/settings/shortcutHoldRepeat';
import {
  PLAYBACK_SHORTCUT_IDS,
  SEEK_SHORTCUT_IDS,
  stepAudioVolume,
  stepPlaybackRatePreset,
  stepSeekSeconds,
} from '@/src/playback/playbackShortcuts';

const CFG: ShortcutConfig = getDefaultConfig();

function DispatchHarness({ onPlay, active = true }: { onPlay: () => void; active?: boolean }) {
  const [rate, setRate] = useState(1);
  const [volume, setVolume] = useState(0.5);
  const [seconds, setSeconds] = useState(5);
  const rateRef = useRef(rate);
  rateRef.current = rate;
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  const secondsRef = useRef(seconds);
  secondsRef.current = seconds;

  const runFunction = useCallback((fn: FunctionId) => {
    switch (fn) {
      case 'rateDown': setRate(stepPlaybackRatePreset(rateRef.current, -1)); break;
      case 'rateUp': setRate(stepPlaybackRatePreset(rateRef.current, 1)); break;
      case 'volumeDown': setVolume(stepAudioVolume(volumeRef.current, -1)); break;
      case 'volumeUp': setVolume(stepAudioVolume(volumeRef.current, 1)); break;
      case 'seekBack': setSeconds(stepSeekSeconds(secondsRef.current, -1, 1, 12)); break;
      case 'seekForward': setSeconds(stepSeekSeconds(secondsRef.current, 1, 1, 12)); break;
      case 'play': onPlay(); break;
    }
  }, [onPlay]);

  useShortcutDispatch({
    shortcutConfig: CFG,
    active,
    runFunction,
    noRepeat: PLAYBACK_SHORTCUT_IDS,
    holdRepeat: SEEK_SHORTCUT_IDS,
  });

  return (
    <div>
      <span role="status" aria-label="倍速">{rate}</span>
      <span role="status" aria-label="音量">{volume}</span>
      <span role="status" aria-label="秒">{seconds}</span>
    </div>
  );
}

const readout = (label: string) => screen.getByRole('status', { name: label }).textContent;
const setup = () => {
  const onPlay = vi.fn();
  render(<DispatchHarness onPlay={onPlay} />);
  return { onPlay };
};

beforeEach(() => {
  window.localStorage.clear();
  setCapturingShortcut(false);
});

afterEach(() => {
  setCapturingShortcut(false);
  cleanup();
});

describe('issue 230 · 四键分发（工作台 useShortcutDispatch）', () => {
  it('` , ` / ` . ` 按预设档升降倍速，` ; ` / 单引号每次 0.05 升降音量', () => {
    setup();
    fireEvent.keyDown(window, { key: ',' });
    expect(readout('倍速')).toBe('0.75');
    fireEvent.keyDown(window, { key: '.' });
    expect(readout('倍速')).toBe('1');
    fireEvent.keyDown(window, { key: ';' });
    expect(readout('音量')).toBe('0.45');
    fireEvent.keyDown(window, { key: "'" });
    expect(readout('音量')).toBe('0.5');
  });

  it('端点停住：2× 继续升档、0 音量继续降都不越界', () => {
    setup();
    for (let i = 0; i < 6; i++) fireEvent.keyDown(window, { key: '.' });
    expect(readout('倍速')).toBe('2');
    for (let i = 0; i < 12; i++) fireEvent.keyDown(window, { key: ';' });
    expect(readout('音量')).toBe('0');
    fireEvent.keyDown(window, { key: ';' });
    expect(readout('音量')).toBe('0');
  });

  it('e.repeat: true 按住不连发（一次按下只调一次）', () => {
    setup();
    for (const key of [',', '.', ';', "'"]) {
      fireEvent.keyDown(window, { key, repeat: true });
    }
    expect(readout('倍速')).toBe('1');
    expect(readout('音量')).toBe('0.5');

    // 松手后正常按一次仍然生效，说明过滤的是连发而不是这两个功能本身
    fireEvent.keyDown(window, { key: '.' });
    expect(readout('倍速')).toBe('1.25');
  });

  it('noRepeat 只列这 4 个：空格播放的连发行为保持原样', () => {
    const { onPlay } = setup();
    fireEvent.keyDown(window, { key: ' ', repeat: true });
    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  it('焦点在输入控件时放行原生输入', () => {
    setup();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    for (const key of [',', '.', ';', "'"]) fireEvent.keyDown(input, { key });
    expect(readout('倍速')).toBe('1');
    expect(readout('音量')).toBe('0.5');
    input.remove();
  });

  it('录制快捷键期间放行（不误触发倍速 / 音量）', () => {
    setup();
    setCapturingShortcut(true);
    for (const key of [',', '.', ';', "'"]) fireEvent.keyDown(window, { key });
    expect(readout('倍速')).toBe('1');
    expect(readout('音量')).toBe('0.5');
  });
});

describe('issue 251 · 工作台键盘 seek 分发', () => {
  it('← / → 按 1 秒步进，端点停在 0 / duration', () => {
    setup();
    const tap = (key: string) => {
      fireEvent.keyDown(window, { key });
      fireEvent.keyUp(window, { key });
    };
    tap('ArrowLeft');
    expect(readout('秒')).toBe('4');
    tap('ArrowRight');
    expect(readout('秒')).toBe('5');
    for (let i = 0; i < 20; i++) tap('ArrowLeft');
    expect(readout('秒')).toBe('0');
    for (let i = 0; i < 20; i++) tap('ArrowRight');
    expect(readout('秒')).toBe('12');
  });

  it('焦点在输入控件时方向键不 seek', () => {
    setup();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: 'ArrowLeft' });
    fireEvent.keyDown(input, { key: 'ArrowRight' });
    expect(readout('秒')).toBe('5');
    input.remove();
  });

  it('页面失活不接管', () => {
    const onPlay = vi.fn();
    render(<DispatchHarness onPlay={onPlay} active={false} />);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(readout('秒')).toBe('5');
  });

  it('e.repeat 不叠加派发', () => {
    setup();
    fireEvent.keyDown(window, { key: 'ArrowRight', repeat: true });
    expect(readout('秒')).toBe('5');
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(readout('秒')).toBe('6');
  });

  it('按住 400ms 后再跳，keyup 立刻停', () => {
    vi.useFakeTimers();
    try {
      setup();
      fireEvent.keyDown(window, { key: 'ArrowRight' });
      expect(readout('秒')).toBe('6');
      act(() => { vi.advanceTimersByTime(HOLD_REPEAT_DELAY_MS - 1); });
      expect(readout('秒')).toBe('6');
      act(() => { vi.advanceTimersByTime(1); });
      expect(readout('秒')).toBe('7');
      act(() => { vi.advanceTimersByTime(HOLD_REPEAT_INTERVAL_MS); });
      expect(readout('秒')).toBe('8');
      fireEvent.keyUp(window, { key: 'ArrowRight' });
      act(() => { vi.advanceTimersByTime(HOLD_REPEAT_DELAY_MS + HOLD_REPEAT_INTERVAL_MS * 4); });
      expect(readout('秒')).toBe('8');
    } finally {
      vi.useRealTimers();
    }
  });

  it('按住后窗口失焦立刻停', () => {
    vi.useFakeTimers();
    try {
      setup();
      fireEvent.keyDown(window, { key: 'ArrowRight' });
      expect(readout('秒')).toBe('6');
      act(() => { window.dispatchEvent(new Event('blur')); });
      act(() => { vi.advanceTimersByTime(HOLD_REPEAT_DELAY_MS + HOLD_REPEAT_INTERVAL_MS * 4); });
      expect(readout('秒')).toBe('6');
    } finally {
      vi.useRealTimers();
    }
  });

  it('按住后焦点进输入框立刻停', () => {
    vi.useFakeTimers();
    const input = document.createElement('input');
    document.body.appendChild(input);
    try {
      setup();
      fireEvent.keyDown(window, { key: 'ArrowRight' });
      expect(readout('秒')).toBe('6');
      fireEvent.focusIn(input);
      act(() => { vi.advanceTimersByTime(HOLD_REPEAT_DELAY_MS + HOLD_REPEAT_INTERVAL_MS * 4); });
      expect(readout('秒')).toBe('6');
    } finally {
      input.remove();
      vi.useRealTimers();
    }
  });

  it('按住后切页（active:false）立刻停', () => {
    vi.useFakeTimers();
    try {
      const onPlay = vi.fn();
      const { rerender } = render(<DispatchHarness onPlay={onPlay} active />);
      fireEvent.keyDown(window, { key: 'ArrowRight' });
      expect(readout('秒')).toBe('6');
      rerender(<DispatchHarness onPlay={onPlay} active={false} />);
      act(() => { vi.advanceTimersByTime(HOLD_REPEAT_DELAY_MS + HOLD_REPEAT_INTERVAL_MS * 4); });
      expect(readout('秒')).toBe('6');
    } finally {
      vi.useRealTimers();
    }
  });
});
