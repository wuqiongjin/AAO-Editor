import { useEffect } from 'react';
import { setActiveUiLanguage, type UiLanguage } from './index';

function syncElectronLanguage(locale: UiLanguage): void {
  const setLanguage = (
    window as unknown as {
      electronAPI?: { i18n?: { setLanguage: (locale: UiLanguage) => void } };
    }
  ).electronAPI?.i18n?.setLanguage;
  setLanguage?.(locale);
}

/** 运行时切语言：html lang、主进程对话框、非 React 的 t() 共用当前 locale。
 *  `setActiveUiLanguage` 必须在 **render 期**同步写入——若只放进 effect，
 *  本次重渲仍用旧 locale 调 `t()`，界面要等到下一次导航才换文案。 */
export function useApplyUiLanguage(locale: UiLanguage): void {
  setActiveUiLanguage(locale);
  useEffect(() => {
    document.documentElement.lang = locale;
    syncElectronLanguage(locale);
  }, [locale]);
}
