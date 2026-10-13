// 块级加载微光（票 24）：绝对定位填满父级 + 100deg 渐变扫光 + `off-thumb-shimmer` 关键帧
// （关键帧随组件上收 `ui.css`，供封面加载态 / 目录行缩略图占位 / 试听条骨架共用）。
//
// 红线（票 24 原型实测）：spinner 不要做本组件的子元素 —— 微光是整层 translateX 扫光，
// 子元素会被带着横向漂移。要叠 spinner 时与它平级、各自绝对定位居中（`inset:0 + margin:auto`）。
import { useEffect, useState } from 'react';
import './ui.css';

/** 加载动效延迟阈值（票 24 验收回修）：本机缓存秒开（协议往返 < 150ms）不再闪微光 ——
 *  动效只表示「真的慢」，不表示「img 未 ready」 */
export const SLOW_LOADING_MS = 150;

/**
 * 「真的慢」才显示加载动效（票 24 验收回修）：`ready`（已就绪 / 终态）为 true 即撤销；
 * `key` 变化（换目标 / 重试 / 降级链变化）重新计时。
 */
export function useSlowLoading(ready: boolean, key: string | number): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (ready) return;
    const timer = setTimeout(() => setSlow(true), SLOW_LOADING_MS);
    return () => clearTimeout(timer);
  }, [ready, key]);
  return slow;
}

export default function LoadingShimmer({ className = '' }: { className?: string }) {
  return <span className={`loading-shimmer${className ? ` ${className}` : ''}`} aria-hidden />;
}
