// @vitest-environment jsdom
// issue 230 · 工作台四键分发的 DOM 锁测：接缝 = 键盘事件 → useShortcutDispatch → runFunction。
// 与 WorkspaceBeatSnapShortcut.test.tsx 同范式（分发验证台）；真实页面的 case 接线由 static 锁守。
import '@testing-library/jest-dom/vitest';
import { useCallback, useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  getDefaultConfig,
  setCapturingShortcut,
  type FunctionId,
  type ShortcutConfig,
} from '@/src/settings/ShortcutConfig';
import { useShortcutDispatch } from '@/src/settings/useShortcutDispatch';
import {
  PLAYBACK_SHORTCUT_IDS,
  stepAudioVolume,
  stepPlaybackRatePreset,
} from '@/src/playback/playbackShortcuts';

const CFG: ShortcutConfig = getDefaultConfig();

function DispatchHarness({ onPlay }: { onPlay: () => void }) {
  const [rate, setRate] = useState(1);
  const [volume, setVolume] = useState(0.5);
  const rateRef = useRef(rate);
  rateRef.current = rate;
  const volumeRef = useRef(volume);
  volumeRef.current = volume;

  const runFunction = useCallback((fn: FunctionId) => {
    switch (fn) {
      case 'rateDown': setRate(stepPlaybackRatePreset(rateRef.current, -1)); break;
      case 'rateUp': setRate(stepPlaybackRatePreset(rateRef.current, 1)); break;
      case 'volumeDown': setVolume(stepAudioVolume(volumeRef.current, -1)); break;
      case 'volumeUp': setVolume(stepAudioVolume(volumeRef.current, 1)); break;
      case 'play': onPlay(); break;
    }
  }, [onPlay]);

  useShortcutDispatch({
    shortcutConfig: CFG,
    active: true,
    runFunction,
    noRepeat: PLAYBACK_SHORTCUT_IDS,
  });

  return (
    <div>
      <span role="status" aria-label="倍速">{rate}</span>
      <span role="status" aria-label="音量">{volume}</span>
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
