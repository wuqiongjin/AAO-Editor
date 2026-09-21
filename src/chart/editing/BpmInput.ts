// BPM 就地编辑的输入解析（issue 143）—— 抽成纯函数，让「小数 / 负数 / 0 / 垃圾输入」
// 这类口径能被单测锁住（原先 `parseInt` 内联在 FinalVirtualCanvas 里，测试碰不到）。

/**
 * 解析就地编辑框里的 BPM 文本。
 *
 * **ADR-0010 结论 8（issue 143 扩订）**：接受**负值与小数** —— Bestdori 的 `bpm` 是任意有限数，
 * 我方导入（`validateChartCode` 只拒非有限数与 0）与导出（`convertBpmNote` 直写）两侧本来就原样放行，
 * 手工输入因此也不得截断（`parseInt` 会把 12.7 变 12、把 128.5 改一改就变 128 = 静默改数据）。
 *
 * @returns 合法 BPM；`null` = 无效（取消编辑、保留放置时已应用的值）
 *   —— 非数字（空串 / "abc"）、非有限数（`Infinity`）、`0` 与 `-0`。
 */
export function parseBpmInput(text: string): number | null {
  const v = parseFloat(text);
  if (!Number.isFinite(v) || v === 0) return null;
  return v;
}
