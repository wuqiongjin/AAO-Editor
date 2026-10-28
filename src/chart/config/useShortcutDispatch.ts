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
//   - only 未列出的绑定放行原生行为（预览页只认 play，issue 22 Q2；工作台不传 = 全接管）
import { useEffect } from 'react';
import { resolveAction, isCapturingShortcut, isEditableTarget, type FunctionId, type ShortcutConfig } from './ShortcutConfig';

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
   * 预览页只认 play（issue 22 Q2）——否则 Ctrl+T / Ctrl+D 这类浏览器键会被顺带吞掉。
   * 不传 = 全部接管（工作台现状）。请传引用稳定的常量数组。
   */
  only?: readonly FunctionId[];
}

export function useShortcutDispatch(opts: UseShortcutDispatchOptions): void {
  const { shortcutConfig, active, runFunction, onEscape, only } = opts;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!active) return;
      if (isEditableTarget(e.target)) return;
      if (isCapturingShortcut()) return;
      if (e.key === 'Escape') {
        onEscape?.();
        return;
      }
      // 只认画布功能：切页（app 作用域）由 AppShell 分发，别在这里被吞成"未处理"
      const fn = resolveAction(e, shortcutConfig, 'canvas');
      if (!fn) return;
      if (only && !only.includes(fn)) return;
      e.preventDefault();
      runFunction(fn);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, shortcutConfig, runFunction, onEscape, only]);
}
