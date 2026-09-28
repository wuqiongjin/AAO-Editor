// 全局轻提示（issue 17）：替掉全站 window.alert 的唯一出口。
//
// 形状沿用工作台那条「已上传只读」浮条（.readonly-toast，chart-projects 06）：顶部居中、可手动关；
// 语气分四档，底色/文字全走 token，与刚定案的弹窗色带同一套语言（浅底 + 语气色文字）。
//
// 为什么是模块级函数 + 宿主，而不是 Context：
// 调用点散在深层回调里（应用成功 / 复制失败 / 另存失败 / 新增谱面被拒…），
// 把「提示」这条横切关注点穿过 props 吊进去，只会让每个中间组件都多一个转手。
// 宿主在应用壳里挂一次（AppShell），portal 到 body —— 层高在弹窗之上（代码弹窗里的提示要压在它头上）。
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { t } from '../i18n';
import './ui.css';

export type ToastTone = 'info' | 'success' | 'warn' | 'danger';

interface ToastItem {
  /** 同一条消息连发也要重排（重放动画 + 重置计时），故带自增号 */
  id: number;
  message: string;
  tone: ToastTone;
}

/** 停留时长：成功类不必久留；要人读的（警告/失败）给够时间 */
const TOAST_MS: Record<ToastTone, number> = {
  info: 2600,
  success: 2600,
  warn: 5000,
  danger: 5000,
};

let seq = 0;
let current: ToastItem | null = null;
const listeners = new Set<(item: ToastItem | null) => void>();

function emit() {
  for (const listener of listeners) listener(current);
}

/** 弹一条提示。同一时刻只留一条：后来的把前一条顶掉（连点两个键不该叠成一摞） */
export function showToast(message: string, tone: ToastTone = 'info') {
  current = { id: ++seq, message, tone };
  emit();
}

export function dismissToast() {
  current = null;
  emit();
}

/** 宿主：在应用壳里挂一次 */
export default function ToastHost() {
  const [toast, setToast] = useState<ToastItem | null>(current);

  useEffect(() => {
    listeners.add(setToast);
    // 挂载前已经发出去的那条补上（首帧就触发的提示不该丢）
    setToast(current);
    return () => { listeners.delete(setToast); };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(dismissToast, TOAST_MS[toast.tone]);
    return () => window.clearTimeout(timer);
  }, [toast]);

  if (!toast) return null;
  // 警告 / 失败要读屏立刻打断（assertive）；成功类排队念就行（polite）
  const urgent = toast.tone === 'warn' || toast.tone === 'danger';

  return createPortal(
    <div
      key={toast.id}
      className={`toast toast--${toast.tone}`}
      role={urgent ? 'alert' : 'status'}
    >
      <span className="toast__text">{toast.message}</span>
      <button type="button" className="toast__close" onClick={dismissToast} aria-label={t('ui.dismiss')}>
        <X size={13} />
      </button>
    </div>,
    document.body,
  );
}
