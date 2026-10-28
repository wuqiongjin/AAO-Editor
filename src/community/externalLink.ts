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
 *   2. **校验在主进程**（`electron/externalLink.cjs`）：本函数只产站点首页，别的地址由主进程
 *      按白名单拒 —— 票 18 起那份白名单还含产品自有站点，与这条社区出口无关；
 *   3. 没有桥（静态演示版 = 没有账号能力）= 返回 `false` 不报错（账号区本来就不渲染，Q11）。
 *      注意这里**不退化成 `window.open`**：在线版没有账号能力，这条链接本就不该有。
 *      产品入口（票 18）那条出口另有降级，见 `src/app/openExternal.ts`。
 *
 * 桥的读取与打开动作在 `src/app/openExternal.ts`（票 18 起两处共用同一份桥形状）——
 * 这里保留零参数的社区语义，只借它的「认桥」那一半。
 *
 * 界面侧仍保留 `<a href>`（可复制 / 键盘可达），点击**拦掉默认行为**改走这条出口。
 */
import { siteHomeUrl } from './bestdori/endpoints';
import { getExternalLinkBridge } from '../app/openExternal';

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
