// useShortcutDispatch（候选 2 / 架构深化评审候选 2 / ADR-0002）：
// 键盘快捷键分发 = FunctionId → 调用方提供的 dispatcher 的桥接。
// 拆出 Editor.tsx 内 ~50 行的 onKeyDown + runFunction switch。
//
// 设计点：
//   - 调用方提供一个 `runFunction(fn: FunctionId) => void`（Editor 内 switch），hook 不感知业务
//   - active=false 时抑制（issue 28 Q16 工作台失活）
//   - INPUT/TEXTAREA/SELECT/contentEditable 焦点放行原生行为
//   - isCapturingShortcut 放行（设置面板改键时不触发）
//   - Esc 关闭左右面板（与原实现一致：两个都未折叠时各自折叠一次）
//   - only 未列出的绑定放行原生行为（预览页只认 play + 倍速/音量四键 + seek 两键，issue 22 Q2 / 230 / 251；工作台不传 = 全接管）
//   - holdRepeat（issue 251）：keydown 立刻第一下 + 自管 300ms / 50ms；`e.repeat` 丢掉、不重开计时器
import { useEffect } from 'react';
import { resolveAction, isCapturingShortcut, isEditableTarget, type FunctionId, type ShortcutConfig } from './ShortcutConfig';
import { createHoldRepeatSession } from './shortcutHoldRepeat';

export interface UseShortcutDispatchOptions {
  /** 当前快捷键配置（来自 ConfigContext.settings.shortcuts） */
  shortcutConfig: ShortcutConfig;
  /** 页面激活态（issue 28 Q16）：false 时抑制 */
  active: boolean;
  /** FunctionId 派发器（Editor 内的 switch 拆为纯函数或保留在调用方） */
  runFunction: (fn: FunctionId) => void;
  /** Esc 折叠左右面板（仅未折叠时） */
  onEscape?: () => void;
  /**
   * 只接管这些功能：表里其余绑定**不 preventDefault、不派发**，放行原生行为。
   * 预览页只认 play + 倍速/音量四键 + seek 两键（issue 22 Q2 / 230 / 251）——否则 Ctrl+T / Ctrl+D 这类浏览器键会被顺带吞掉。
   * 不传 = 全部接管（工作台现状）。请传引用稳定的常量数组。
   */
  only?: readonly FunctionId[];
  /**
   * 按住不连发（issue 230）：这些功能忽略 `e.repeat` 的键盘自动连发，一次按下只调一次。
   * 只给「预设档 / 定步进」这类连续触发会瞬冲到底的功能用；其它快捷键（含空格播放）保持原样。
   * 请传引用稳定的常量数组。
   */
  noRepeat?: readonly FunctionId[];
  /**
   * 自管按住连发（issue 251）：keydown 立刻派发第一下，约 300ms 后再每 50ms 派发。
   * `e.repeat` 的 keydown **不派发、不重开计时器**。keyup / 窗口失焦 / 焦点进可编辑控件 / 本 effect 卸掉（切页 `active` 变 false）立刻停。
   * 两键同时按住：后按下的方向覆盖前一个。不要与 `noRepeat` 重叠（那是「按住完全不连发」）。
   * 请传引用稳定的常量数组。
   */
  holdRepeat?: readonly FunctionId[];
}

export function useShortcutDispatch(opts: UseShortcutDispatchOptions): void {
  const { shortcutConfig, active, runFunction, onEscape, only, noRepeat, holdRepeat } = opts;
  useEffect(() => {
    const session = holdRepeat && holdRepeat.length > 0
      ? createHoldRepeatSession({ dispatch: runFunction })
      : null;

    const onKeyDown = (e: KeyboardEvent) => {
      if (!active) return;
      if (isEditableTarget(e.target)) {
        session?.stop();
        return;
      }
      if (isCapturingShortcut()) return;
      if (e.key === 'Escape') {
        onEscape?.();
        return;
      }
      // 只认画布功能：切页（app 作用域）由 AppShell 分发，别在这里被吞成"未处理"
      const fn = resolveAction(e, shortcutConfig, 'canvas');
      if (!fn) return;
      if (only && !only.includes(fn)) return;
      if (e.repeat && noRepeat?.includes(fn)) return;
      e.preventDefault();
      if (session && holdRepeat?.includes(fn)) {
        session.onKeyDown(fn, e.repeat);
        return;
      }
      runFunction(fn);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (!session) return;
      const fn = resolveAction(e, shortcutConfig, 'canvas');
      if (fn && holdRepeat?.includes(fn)) session.onKeyUp(fn);
    };

    const stopHeld = () => session?.stop();
    const onFocusIn = (e: FocusEvent) => {
      if (isEditableTarget(e.target)) session?.stop();
    };

    window.addEventListener('keydown', onKeyDown);
    if (session) {
      window.addEventListener('keyup', onKeyUp);
      window.addEventListener('blur', stopHeld);
      window.addEventListener('focusin', onFocusIn);
    }
    return () => {
      session?.stop();
      window.removeEventListener('keydown', onKeyDown);
      if (session) {
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', stopHeld);
        window.removeEventListener('focusin', onFocusIn);
      }
    };
  }, [active, shortcutConfig, runFunction, onEscape, only, noRepeat, holdRepeat]);
}
