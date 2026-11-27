// @vitest-environment jsdom
// issue 257 · 接缝锁测：键盘事件 → useShortcutDispatch → runFunction。
// ⌘Q 不进产品分发（不派发、不 preventDefault）才能让 macOS 系统菜单退出；Control+Q 仍镜像。
import '@testing-library/jest-dom/vitest';
import { useCallback } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import {
  getDefaultConfig, setCapturingShortcut, type FunctionId,
} from '@/src/settings/ShortcutConfig';
import { useShortcutDispatch } from '@/src/settings/useShortcutDispatch';

const CFG = getDefaultConfig();

function Harness({ onRun }: { onRun: (fn: FunctionId) => void }) {
  const runFunction = useCallback((fn: FunctionId) => onRun(fn), [onRun]);
  useShortcutDispatch({ shortcutConfig: CFG, active: true, runFunction });
  return null;
}

const press = (init: KeyboardEventInit): KeyboardEvent => {
  const e = new KeyboardEvent('keydown', { key: 'q', bubbles: true, cancelable: true, ...init });
  window.dispatchEvent(e);
  return e;
};

beforeEach(() => {
  Object.defineProperty(window.navigator, 'platform', { configurable: true, value: 'MacIntel' });
  setCapturingShortcut(false);
});

afterEach(() => {
  setCapturingShortcut(false);
  cleanup();
  // platform 原始值在 Navigator.prototype 上；删掉实例上的自建属性即可还原
  delete (window.navigator as unknown as { platform?: string }).platform;
});

describe('issue 257 · darwin ⌘Q 不进产品分发', () => {
  it('⌘Q 既不派发 execMirror，也不 preventDefault（交给系统退出）', () => {
    const onRun = vi.fn();
    render(<Harness onRun={onRun} />);

    const e = press({ metaKey: true, ctrlKey: false });
    expect(e.defaultPrevented).toBe(false);
    expect(onRun).not.toHaveBeenCalled();
  });

  it('物理 Control+Q 仍派发 execMirror 并 preventDefault', () => {
    const onRun = vi.fn();
    render(<Harness onRun={onRun} />);

    const e = press({ metaKey: false, ctrlKey: true });
    expect(e.defaultPrevented).toBe(true);
    expect(onRun).toHaveBeenCalledWith('execMirror');
  });
});
