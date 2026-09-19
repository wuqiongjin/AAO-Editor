// chrome 界面字体栈 / 字号落到 documentElement（issue 124）。
// 只改 --font-sans 与 --ui-type-scale（tokens.css 的 --text-* 乘该比例）。
// --font-mono 不随字体档切换。
import { useEffect } from 'react';
import type { AppSettings, UiFontStackId } from '../../chart/config/AppSettings';

/** 三档无衬线回退链（不打包 CJK webfont；缺族名由浏览器静默走下一档） */
export const UI_FONT_SANS_STACKS: Record<UiFontStackId, string> = {
  geist: '"Geist Variable", "PingFang SC", "Microsoft YaHei", system-ui, -apple-system, sans-serif',
  yahei: '"Microsoft YaHei", "Microsoft YaHei UI", "Geist Variable", "PingFang SC", system-ui, sans-serif',
  noto: '"Noto Sans CJK", "Noto Sans CJK SC", "Noto Sans CJK JP", "Noto Sans CJK TC", "Noto Sans CJK KR", "Source Han Sans", "Source Han Sans SC", "思源黑体", "Noto Sans", "Geist Variable", sans-serif',
};

export function applyChromeTypography(
  style: { setProperty: (property: string, value: string) => void },
  input: Pick<AppSettings, 'uiTypeScale' | 'uiFontStack'>,
): void {
  style.setProperty('--ui-type-scale', String(input.uiTypeScale));
  style.setProperty('--font-sans', UI_FONT_SANS_STACKS[input.uiFontStack]);
}

export function useApplyChromeTypography(settings: Pick<AppSettings, 'uiTypeScale' | 'uiFontStack'>): void {
  useEffect(() => {
    applyChromeTypography(document.documentElement.style, settings);
  }, [settings.uiTypeScale, settings.uiFontStack]);
}
