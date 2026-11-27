// 票 79 / ADR-0024 §3：新建谱面那一刻的「谱师署名」默认值。
//
// 账号名只在**创建时**取一次并落进谱面；导出阶段绝不现取。会话在未登录 / 失效 /
// 离线校验没过 / 启动 `user/me` 还没回来（verifying）时 `account` 都是 null，登出会清 ——
// 把署名绑在会话态上会让「改天重导同一条视频」少一行字，导出物必须可复现。
import { getCommunityAccount } from '../community/bestdori/account';

/** `nickname ?? username`；未登录 / 会话异常 = 空（不画）。永不抛错：创建谱面不该被登录态拖垮。 */
export function defaultCharterCredit(): string | null {
  try {
    const account = getCommunityAccount().getSession().account;
    if (!account) return null;
    return account.nickname?.trim() || account.username.trim() || null;
  } catch {
    return null;
  }
}
