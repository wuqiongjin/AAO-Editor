/**
 * 在线版（在浏览器里跑的那一份）的两个事实：这台机器有没有桌面运行时、这台浏览器要不要弹首访说明。
 *
 * 全仓没有构建期标志 —— 在线版、本地 `npm run dev`、未打包 Electron 共用同一份 dist，
 * 运行期唯一信号就是 preload 注入的 `window.electronAPI`。这里判的是**有没有**（任何一条桥），
 * 不是「某条能力桥在不在」（那是 `community/electronTransport.ts` 那种按能力判的口径）：
 * 说的是「这是桌面运行时的应用」还是「这是浏览器里的应用」。
 */

/** 首访说明的记账键：按 `aao.<域>.v1` 惯例，v1 是结构版本，不跟应用版本走 */
export const WEB_NOTICE_KEY = 'aao.webNotice.v1';

/** 有没有桌面运行时（preload 注入了任意一条桥；浏览器里恒为 false） */
export function hasDesktopRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean((window as unknown as { electronAPI?: unknown }).electronAPI);
}

/** 这台浏览器还没看过首访说明 */
export function shouldShowWebNotice(): boolean {
  if (hasDesktopRuntime()) return false;
  try {
    return localStorage.getItem(WEB_NOTICE_KEY) === null;
  } catch {
    // 读不到（隐私模式 / 存储被禁）就当看过：宁可少弹一次，也不要每次进来都拦一下
    return false;
  }
}

/** 记下「已看过」。写不进去也不抛 —— 本次会话内由宿主自己的状态兜住 */
export function dismissWebNotice(): void {
  try {
    localStorage.setItem(WEB_NOTICE_KEY, '1');
  } catch {
    /* 同上：不阻断关闭 */
  }
}
