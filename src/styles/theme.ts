// 主题应用（ADR-0003 §5）：把 settings.theme（light/dark/system）解析为
// document 上的 data-theme（light/dark），并监听系统偏好变化。
import { useEffect } from 'react';
import type { AppSettings } from '../chart/config/AppSettings';

export function resolveTheme(theme: AppSettings['theme']): 'light' | 'dark' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return theme;
}

/** 将配置主题落到 <html data-theme>，供 tokens.css 选择亮/暗覆盖。 */
export function useApplyTheme(theme: AppSettings['theme']): void {
  useEffect(() => {
    const apply = () => {
      document.documentElement.dataset.theme = resolveTheme(theme);
    };
    apply();
    // system 模式下跟随系统偏好实时切换
    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }
  }, [theme]);
}
