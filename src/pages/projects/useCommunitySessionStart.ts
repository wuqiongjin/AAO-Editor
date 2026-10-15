// 社区会话唯一真相的**启动校验**（票 10）：还原那份被 safeStorage 加密的会话 Cookie，
// 并查一次 `GET /api/user/me`。没有会话时一条请求都不发；平台不认了就转未登录
// （读能力照旧可用，写能力变灰，不弹窗、不白屏）。`start()` 幂等，StrictMode 的双跑也只发一次。
//
// 它挂在有社区出口的页面（工程管理页）：`enabled` = 有没有社区平台出口
// （静态演示版没有 → 一次都不校验，与官方 / 社区两支入口同口径）。
import { useEffect } from 'react';
import { getCommunityAccount } from '../../community/bestdori/account';

export function useCommunitySessionStart(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    void getCommunityAccount().start();
  }, [enabled]);
}
