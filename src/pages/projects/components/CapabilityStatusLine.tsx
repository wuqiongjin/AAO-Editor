// 「写能力为什么被挡住」的一行说明（票 39 Q22 的积木；**本票不渲染它**，票 11 把它挂在发布按钮旁边）。
//
// 为什么现在就落地：票 11 的发布按钮需要「禁用 + 就地说明」这一对，而说明的文案只有一处
// （Q22「文案必须只有一处」）—— 三档都在这里取 i18n，票 11 直接用它，不许在按钮那边再写一句。
//
// 三档口径：
//   - `signed-out`：「登录后可发布谱面」—— 未登录行自己已经不说这句了（Q36 改成动作式「登录」），
//     那句"为什么"由这枚说明承担；
//   - `offline`：复用登录弹窗里那句「网络不可用，请稍后重试」（同一件事不写两种说法）；
//   - `unsupported-runtime`：Q21 定案「社区功能当前不可用」—— 不写「仅桌面版可用」。
// 两条「不可用」都不是常驻状态行（Q14 / Q26）：只在用户**动作当场**（票 11 点发布 / 本票点登录）出现。
import type { CommunityCapabilityBlock } from '../../../community/availability';
import { t, type MessageKey } from '../../../i18n';

const BLOCK_KEYS: Record<CommunityCapabilityBlock, MessageKey> = {
  'signed-out': 'community.account.signInHint',
  offline: 'community.account.err.offline',
  'unsupported-runtime': 'community.account.err.unavailable',
};

export function CapabilityStatusLine({ block }: { block: CommunityCapabilityBlock }) {
  return <p className="pc-capability">{t(BLOCK_KEYS[block])}</p>;
}
