/**
 * 会话 Cookie 的**持久化接缝**（bestdori-integration 10；ADR-0011 §3 凭据红线）。
 *
 * 谁在哪：Cookie 值只住在主进程（`electron/communityCookies.cjs` 的内存 jar + `communitySession.cjs`
 * 的 safeStorage 加密文件），renderer 从头到尾看不到它。这里只有**三条**通道，一条也不多
 * （凭据面的接口越小越好；「本机能不能加密」不必单开一条 —— `persist()` 的成败就是答案）：
 *
 *   - `restore()` —— 主进程解密并灌进自己的 jar，回「有没有恢复到一个会话」；
 *   - `persist()` —— 主进程把**自己** jar 的快照加密落盘。**刻意零入参**：没有参数就没有
 *     「把凭据递给持久化路径」这只手，renderer 连试都试不了（静态断言盯这条，见
 *     `tests/static/CommunityCredentialBoundary.test.ts`）；
 *   - `clear()` —— 登出 / 会话失效：清内存 jar + 删那份加密文件。
 *
 * 没有桥（静态演示版 / 浏览器，ADR-0011 §1）时三档都退化成「没有持久化」：
 * 会话只在内存里活这一次运行，不报错、不白屏。
 */

/** preload 暴露的会话桥（本仓惯例：桥形状由消费方就近声明，没有集中 d.ts） */
export interface CommunitySessionBridge {
  restore(): Promise<{ restored: boolean }>;
  persist(): Promise<{ persisted: boolean }>;
  /** 只是「办完了」的回执（与 backgroundSkin:clear / windowChrome:sync 同形），没有可读的值 */
  clear(): Promise<boolean>;
}

/** 读桥；浏览器里（没有 window / 没有 electronAPI）返回 null */
export function getCommunitySessionBridge(): CommunitySessionBridge | null {
  if (typeof window === 'undefined') return null;
  const api = (window as unknown as { electronAPI?: { communitySession?: CommunitySessionBridge } }).electronAPI;
  return api?.communitySession ?? null;
}

/**
 * 能力层注入的持久化出口（单测注入假实现，不碰 IPC、不碰磁盘）。
 * 三个方法都**不收也不回凭据**：只回答「成没成」。
 */
export interface CommunitySessionPersistence {
  /** 从加密文件恢复会话 Cookie；`false` = 没有可恢复的（不支持 / 没文件 / 解不开） */
  restore(): Promise<boolean>;
  /** 把当前内存 jar 加密落盘；`false` = 没落成（本机不支持 / 写失败）—— 内存会话照用 */
  persist(): Promise<boolean>;
  /** 清内存 jar + 删加密文件（登出与会话失效共用） */
  clear(): Promise<void>;
}

/** 账号模块与单测的默认持久化出口：有桥走 IPC，没桥就是「不持久化」 */
export function createSessionPersistence(
  bridge: CommunitySessionBridge | null = getCommunitySessionBridge(),
): CommunitySessionPersistence {
  if (!bridge) {
    // 静态演示版：没有持久化这回事，但接口照给 —— 调用方不用为运行环境分叉自己的流程
    return {
      restore: async () => false,
      persist: async () => false,
      clear: async () => undefined,
    };
  }
  return {
    restore: async () => (await bridge.restore()).restored === true,
    // 落盘失败（本机加密不可用 / 磁盘写不进去）不是错误：内存会话照用，下次启动重新登录
    persist: async () => (await bridge.persist()).persisted === true,
    clear: async () => {
      await bridge.clear();
    },
  };
}
