// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { useCallback } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ConfigProvider, useConfig } from '@/src/app/providers/ConfigProvider';
import { UIProvider, useUI } from '@/src/app/providers/UIProvider';
import type { FunctionId } from '@/src/settings/ShortcutConfig';
import { useShortcutDispatch } from '@/src/settings/useShortcutDispatch';
import { stepBeatSnap, cycleBeatSnap } from '@/src/chart/editing/BeatSnap';
import BeatSnapCapsule from '@/src/pages/workspace/BeatSnapCapsule';
import { seedZhSettings } from '@/tests/support/storage';
import { readStripped } from '@/tests/support/source';

/**
 * 节拍吸附快捷键分发验证台：与 WorkspacePage 内的 runFunction 分发一致
 */
function BeatSnapShortcutHarness() {
  const ui = useUI();
  const config = useConfig();
  const { beatDisplay, setBeatDisplay } = ui;
  const { settings } = config;

  const runFunction = useCallback((fn: FunctionId) => {
    switch (fn) {
      case 'beatSnapNext': setBeatDisplay(stepBeatSnap(beatDisplay, 1)); break;
      case 'beatSnapPrev': setBeatDisplay(stepBeatSnap(beatDisplay, -1)); break;
      case 'beatSnapCycle': setBeatDisplay(cycleBeatSnap(beatDisplay, settings.beatSnapCycleList)); break;
      case 'beatSnapSet1': setBeatDisplay(1); break;
      case 'beatSnapSet2': setBeatDisplay(2); break;
      case 'beatSnapSet3': setBeatDisplay(3); break;
      case 'beatSnapSet4': setBeatDisplay(4); break;
      case 'beatSnapSet6': setBeatDisplay(6); break;
      case 'beatSnapSet8': setBeatDisplay(8); break;
      case 'beatSnapSet12': setBeatDisplay(12); break;
      case 'beatSnapSet16': setBeatDisplay(16); break;
    }
  }, [beatDisplay, setBeatDisplay, settings.beatSnapCycleList]);

  useShortcutDispatch({
    shortcutConfig: settings.shortcuts,
    active: true,
    runFunction,
    onEscape: () => {},
  });

  return (
    <div>
      <span data-testid="beat-display">{beatDisplay}</span>
      <BeatSnapCapsule />
    </div>
  );
}

function setup(opts: {
  shortcuts?: Record<string, string | null>;
  beatSnap?: number;
  beatSnapCycleList?: number[];
} = {}) {
  seedZhSettings({
    beatSnap: opts.beatSnap ?? 4,
    beatSnapCycleList: opts.beatSnapCycleList ?? [4, 8, 12, 16],
    shortcuts: {
      beatSnapNext: ']',
      beatSnapPrev: '[',
      beatSnapCycle: 'c',
      ...(opts.shortcuts ?? {}),
    },
  });

  render(
    <ConfigProvider>
      <UIProvider>
        <BeatSnapShortcutHarness />
      </UIProvider>
    </ConfigProvider>,
  );
}

describe('issue 216 · 工作台节拍吸附快捷键联动锁测', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('静态装配锁：WorkspacePage 正确接入 beatSnapNext / beatSnapPrev / beatSnapCycle', () => {
    const src = readStripped('src/pages/workspace/WorkspacePage.tsx');
    expect(src).toMatch(/case\s+'beatSnapNext':\s*setBeatDisplay\(stepBeatSnap\(beatDisplay,\s*1\)\);/);
    expect(src).toMatch(/case\s+'beatSnapPrev':\s*setBeatDisplay\(stepBeatSnap\(beatDisplay,\s*-1\)\);/);
    expect(src).toMatch(/case\s+'beatSnapCycle':\s*setBeatDisplay\(cycleBeatSnap\(beatDisplay,\s*settings\.beatSnapCycleList\)\);/);
  });

  it('触发 beatSnapNext 升序步进一档，端点 64 停住', () => {
    setup({ beatSnap: 4 });
    const readout = () => screen.getByTestId('beat-display').textContent;
    const pill = () => screen.getByRole('button', { name: '节拍吸附' });

    expect(readout()).toBe('4');
    expect(pill()).toHaveTextContent('1/4');

    // 4 -> 6
    fireEvent.keyDown(window, { key: ']' });
    expect(readout()).toBe('6');
    expect(pill()).toHaveTextContent('1/6');

    // 6 -> 8
    fireEvent.keyDown(window, { key: ']' });
    expect(readout()).toBe('8');
    expect(pill()).toHaveTextContent('1/8');

    // 从 48 -> 64
    cleanup();
    setup({ beatSnap: 48 });
    fireEvent.keyDown(window, { key: ']' });
    expect(readout()).toBe('64');
    expect(pill()).toHaveTextContent('1/64');

    // 64 端点停住
    fireEvent.keyDown(window, { key: ']' });
    expect(readout()).toBe('64');
    expect(pill()).toHaveTextContent('1/64');
  });

  it('触发 beatSnapPrev 降序步退一档，端点 1 停住', () => {
    setup({ beatSnap: 4 });
    const readout = () => screen.getByTestId('beat-display').textContent;

    // 4 -> 3
    fireEvent.keyDown(window, { key: '[' });
    expect(readout()).toBe('3');

    // 3 -> 2
    fireEvent.keyDown(window, { key: '[' });
    expect(readout()).toBe('2');

    // 2 -> 1
    fireEvent.keyDown(window, { key: '[' });
    expect(readout()).toBe('1');

    // 1 端点停住
    fireEvent.keyDown(window, { key: '[' });
    expect(readout()).toBe('1');
  });

  it('触发 beatSnapCycle 在常用循环列表中切换与回卷', () => {
    setup({ beatSnap: 4, beatSnapCycleList: [4, 8, 12, 16] });
    const readout = () => screen.getByTestId('beat-display').textContent;

    // 4 -> 8
    fireEvent.keyDown(window, { key: 'c' });
    expect(readout()).toBe('8');

    // 8 -> 12
    fireEvent.keyDown(window, { key: 'c' });
    expect(readout()).toBe('12');

    // 12 -> 16
    fireEvent.keyDown(window, { key: 'c' });
    expect(readout()).toBe('16');

    // 16 -> 4 (回卷)
    fireEvent.keyDown(window, { key: 'c' });
    expect(readout()).toBe('4');
  });

  it('临时自定义细分（如 1/7）触发 beatSnapCycle 时切入下一个大于它的项（8），单向脱离', () => {
    setup({ beatSnap: 7, beatSnapCycleList: [4, 8, 12, 16] });
    const readout = () => screen.getByTestId('beat-display').textContent;

    expect(readout()).toBe('7');

    // 7 切入 8
    fireEvent.keyDown(window, { key: 'c' });
    expect(readout()).toBe('8');

    // 继续循环
    fireEvent.keyDown(window, { key: 'c' });
    expect(readout()).toBe('12');
  });

  it('焦点在文本输入框时快捷键被拦截放行，不影响节拍吸附', () => {
    setup({ beatSnap: 4 });
    const readout = () => screen.getByTestId('beat-display').textContent;

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    fireEvent.keyDown(input, { key: ']' });
    expect(readout()).toBe('4');

    fireEvent.keyDown(input, { key: '[' });
    expect(readout()).toBe('4');

    fireEvent.keyDown(input, { key: 'c' });
    expect(readout()).toBe('4');

    input.remove();
  });
});

describe('issue 239 · 工作台「设为 1/N」数字键', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('静态装配锁：WorkspacePage 接入八个 beatSnapSet case', () => {
    const src = readStripped('src/pages/workspace/WorkspacePage.tsx');
    for (const [id, n] of [
      ['beatSnapSet1', 1], ['beatSnapSet2', 2], ['beatSnapSet3', 3], ['beatSnapSet4', 4],
      ['beatSnapSet6', 6], ['beatSnapSet8', 8], ['beatSnapSet12', 12], ['beatSnapSet16', 16],
    ] as const) {
      expect(src).toMatch(new RegExp(`case\\s+'${id}':\\s*setBeatDisplay\\(${n}\\);`));
    }
  });

  it('按 4 / 9 / 0 设为 1/4、1/12、1/16；已在该档再按仍停住', () => {
    setup({ beatSnap: 8 });
    const readout = () => screen.getByTestId('beat-display').textContent;
    const pill = () => screen.getByRole('button', { name: '节拍吸附' });

    fireEvent.keyDown(window, { key: '4' });
    expect(readout()).toBe('4');
    expect(pill()).toHaveTextContent('1/4');

    fireEvent.keyDown(window, { key: '4' });
    expect(readout()).toBe('4');

    fireEvent.keyDown(window, { key: '9' });
    expect(readout()).toBe('12');
    expect(pill()).toHaveTextContent('1/12');

    fireEvent.keyDown(window, { key: '0' });
    expect(readout()).toBe('16');
    expect(pill()).toHaveTextContent('1/16');
  });

  it('胶囊源码不标注出厂数字键', () => {
    const src = readStripped('src/pages/workspace/BeatSnapCapsule.tsx');
    expect(src).not.toMatch(/formatKey/);
    expect(src).not.toMatch(/beatSnapSet/);
  });
});
