/**
 * 社区能力的**界面侧接缝**（票 39 Q16 / Q22 / Q7）：把能力层那份会话与降级矩阵接成一个 hook。
 *
 * 为什么住 UI 侧（Q16）：`src/community/` 是零 React 的中立能力域（票 06 的形状，票 10 的凭据
 * 静态断言也建在这个形状上）—— hook 与组件只能就近放宿主页。本票只有账号区一个消费方，
 * 票 11 的发布按钮直接复用，**第二个宿主页出现再谈上提**。
 *
 * Q7 / Q27 的口径：**本票不建 availability 单例、不做全局网络回报**。
 * 于是运行环境那一档只能从「有没有出口」现推：有出口 = 还没探过（`unknown`，乐观放读 ——
 * 第一次真实请求失败自然会转 offline），没出口 = 静态演示版（`unsupported`）。
 * 「最近一次判定」那种全局状态等真有第二个消费方时再谈（票 11 的灰化说明走 `error.kind` 就地措辞）。
 */
import { useMemo, useSyncExternalStore } from 'react';
import {
  capabilitiesFor,
  type CommunityAvailabilityState,
  type CommunityCapabilities,
} from '../../community/availability';
import { getCommunityAccount, type CommunityAccountSession } from '../../community/bestdori/account';
import { hasCommunityNet } from '../../community/electronTransport';

/** hook 的返回值：降级矩阵 + 会话（票 11 的按钮要按 `write`，账号区要按 `session`） */
export interface CommunityCapabilitiesSnapshot extends CommunityCapabilities {
  session: CommunityAccountSession;
}

/**
 * 运行环境那一档。**引用必须稳**：`useSyncExternalStore` 拿它去算快照，每次现造对象
 * 会让 React 认为快照一直在变（无限重渲）。所以按「有没有出口」这一个布尔缓存一份。
 */
let cachedSupported: boolean | null = null;
let cachedState: CommunityAvailabilityState | null = null;

function runtimeState(): CommunityAvailabilityState {
  const supported = hasCommunityNet();
  if (cachedState && cachedSupported === supported) return cachedState;
  cachedSupported = supported;
  cachedState = supported
    ? { status: 'unknown', checkedAt: null }
    : { status: 'unsupported', checkedAt: null };
  return cachedState;
}

/**
 * 会话 + 矩阵的快照。会话对象本身的引用是稳的（`account.ts` 只在真的变了时换新对象），
 * 所以按会话引用缓存一份就够 —— 这也是「引用要稳」那条要求的落点。
 */
let cachedSnapshot: CommunityCapabilitiesSnapshot | null = null;

function snapshotOf(session: CommunityAccountSession): CommunityCapabilitiesSnapshot {
  if (cachedSnapshot && cachedSnapshot.session === session) return cachedSnapshot;
  cachedSnapshot = { ...capabilitiesFor(runtimeState(), session), session };
  return cachedSnapshot;
}

export function useCommunityCapabilities(): CommunityCapabilitiesSnapshot {
  const account = getCommunityAccount();
  const subscribe = useMemo(
    () => (listener: () => void) => account.subscribe(() => listener()),
    [account],
  );
  const session = useSyncExternalStore(subscribe, () => account.getSession());
  return snapshotOf(session);
}
