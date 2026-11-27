/**
 * 动态预览里「新功能落点提示」的本机记账。
 *
 * 键按 `aao.previewDiscovery.<hintId>.v1` 拼：`v1` 是**结构版本**（三段状态的格式），
 * 不跟应用版本走；`hintId` 是**提示批次**（本次 = `stage-cover`）。加新提示就用新 id →
 * 新键 → 老用户机器上没有该键，天然 unseen；退役旧提示只删组件触点，旧键无人读，无害。
 *
 * 三段进度：
 *   - `unseen`  = 未点过设置钮 → 触发钮红点；
 *   - `opened`  = 点开过设置 → 红点收起，但行内角标留着指路；
 *   - `visited` = 关过一次面板 → 角标也收起（提示只做一轮，不长期骚扰）。
 */
export type DiscoveryPhase = 'unseen' | 'opened' | 'visited';

/** 批次键格式：外部（测试 / 调试）可以据此定位某一批次的存储项 */
export function discoveryKey(hintId: string): string {
  return `aao.previewDiscovery.${hintId}.v1`;
}

/** 写失败过的批次：本次会话内一律当 visited（宁可少提示，不要每次进来都拦一下） */
const unwritable = new Set<string>();

/** 读不到存储 / 该批次写失败过 → visited；不做无休止的提示 */
export function readDiscovery(hintId: string): DiscoveryPhase {
  if (unwritable.has(hintId)) return 'visited';
  try {
    const raw = localStorage.getItem(discoveryKey(hintId));
    return raw === 'opened' || raw === 'visited' ? raw : 'unseen';
  } catch {
    return 'visited';
  }
}

function write(hintId: string, phase: DiscoveryPhase): void {
  try {
    localStorage.setItem(discoveryKey(hintId), phase);
  } catch {
    unwritable.add(hintId);
  }
}

/** 点开设置：红点收起，不覆盖 deeper 的 visited */
export function markOpened(hintId: string): void {
  if (readDiscovery(hintId) === 'unseen') write(hintId, 'opened');
}

/** 关掉面板：该批次收干净 */
export function markVisited(hintId: string): void {
  write(hintId, 'visited');
}
