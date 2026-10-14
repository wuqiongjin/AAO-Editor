/**
 * 站外链接出口（票 39 Q47）：把「去站点」的动作交给**系统浏览器**。
 *
 * 为什么单开这一条：仓里既有的站外写法是 `<a target="_blank">`（工程详情「上传记录」的帖子链接），
 * 它在 Electron 里会开一个**应用内、无地址栏**的窗口 —— 那是错的形态（用户没法确认自己在哪个站、
 * 也没法用自己浏览器里的登录态）。票 39 的注册 / 找回入口是本仓**第一个真会被点到**的站外链接，
 * 所以形态在这里定对，票 11 的帖子链接起走同一个出口。
 *
 * 三条口径（与票 07 的「出口唯一 + 域名白名单」同族）：
 *   1. **零参数**：URL 由 `bestdori/endpoints.ts` 自己取，调用方递不进任意地址；
 *   2. **校验在主进程**（`electron/externalLink.cjs`）：只放行社区平台自己与其子域，其余拒绝；
 *   3. 没有桥（静态演示版）= 没有这个能力，返回 `false` 不报错（账号区本来就不渲染，Q11）。
 *
 * 界面侧仍保留 `<a href>`（可复制 / 键盘可达 / 无障碍），点击**拦掉默认行为**改走这条出口。
 */
import { siteHomeUrl } from './bestdori/endpoints';

/** preload 暴露的站外链接桥（本仓惯例：桥形状由消费方就近声明，没有集中 d.ts） */
export interface ExternalLinkBridge {
  openExternal(url: string): Promise<boolean>;
}

/** 读桥；浏览器里（没有 window / 没有 electronAPI）返回 null */
export function getExternalLinkBridge(): ExternalLinkBridge | null {
  if (typeof window === 'undefined') return null;
  const api = (window as unknown as { electronAPI?: { shell?: ExternalLinkBridge } }).electronAPI;
  return api?.shell ?? null;
}

/**
 * 打开社区平台的站点首页。**零参数**：URL 从这里（`endpoints.ts`）产生，调用方塞不进别的地址。
 * 主进程拒了 / 桥挂了都只是 `false` —— 「没开成浏览器」不该把登录弹窗整块打翻。
 */
export async function openCommunitySite(): Promise<boolean> {
  const bridge = getExternalLinkBridge();
  if (!bridge) return false;
  try {
    return (await bridge.openExternal(siteHomeUrl())) === true;
  } catch {
    return false;
  }
}
