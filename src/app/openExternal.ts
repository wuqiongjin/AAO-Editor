/**
 * 站外链接出口（票 39 定形，票 18 起产品入口也走这里）。
 *
 * 为什么不让 `<a target="_blank">` 自己跳：Electron 里那会开一个**应用内、无地址栏**的窗口 ——
 * 用户没法确认自己在哪个站，也用不了自己浏览器里的登录态。所以点击一律**拦掉默认行为**，
 * 交给系统浏览器。
 *
 * 两条语义分清楚：
 *   - **有桥**（桌面版）→ 交给主进程 `shell:openExternal`，放不放行由白名单说了算；
 *   - **没桥**（在线版 `/app/`）→ `window.open` 开新标签页。这里与社区那条出口不同：
 *     社区链接在浏览器里本来就不该有（没有账号能力，`openCommunitySite` 返回 false），
 *     而产品入口在在线版同样要能点 —— 所以这条有降级。
 */
export interface ExternalLinkBridge {
  openExternal(url: string): Promise<boolean>;
}

/** 读桥；浏览器 / SSR（没有 window）返回 null。桥形状由消费方就近声明，没有集中 d.ts。 */
export function getExternalLinkBridge(): ExternalLinkBridge | null {
  if (typeof window === 'undefined') return null;
  const api = (window as unknown as { electronAPI?: { shell?: ExternalLinkBridge } }).electronAPI;
  return api?.shell ?? null;
}

/**
 * 打开一个站外地址。**不抛错**：主进程拒了 / 桥挂了只是 `false` ——「没开成浏览器」
 * 不该把一个设置页行搞崩。
 */
export async function openExternalUrl(url: string): Promise<boolean> {
  const bridge = getExternalLinkBridge();
  if (bridge) {
    try {
      return (await bridge.openExternal(url)) === true;
    } catch {
      return false;
    }
  }
  if (typeof window === 'undefined') return false;
  // noopener：别把 window 交给目标页（反向 tabnabbing 的常识，与新标签页一起给）
  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  return opened != null;
}
