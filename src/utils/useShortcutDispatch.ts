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
import { useEffect } from 'react';
import { resolveAction, isCapturingShortcut, type FunctionId, type ShortcutConfig } from './ShortcutConfig';

export interface UseShortcutDispatchOptions {
  /** 当前快捷键配置（来自 ConfigContext.settings.shortcuts） */
  shortcutConfig: ShortcutConfig;
  /** 工作台激活态（issue 28 Q16）：false 时抑制 */
  active: boolean;
  /** FunctionId 派发器（Editor 内的 switch 拆为纯函数或保留在调用方） */
  runFunction: (fn: FunctionId) => void;
  /** Esc 折叠左右面板（仅未折叠时） */
  onEscape?: () => void;
}

export function useShortcutDispatch(opts: UseShortcutDispatchOptions): void {
  const { shortcutConfig, active, runFunction, onEscape } = opts;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!active) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;
      if (isCapturingShortcut()) return;
      if (e.key === 'Escape') {
        onEscape?.();
        return;
      }
      const fn = resolveAction(e, shortcutConfig);
      if (!fn) return;
      e.preventDefault();
      runFunction(fn);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, shortcutConfig, runFunction, onEscape]);
}
