// 谱面时长语义（架构深化评审候选 5 的「时长那一半」）：默认、上下界、夹取各一份。
//
// 之前（Before）：
//   - 默认 30 散在 5 处：`AudioTiming.EMPTY_CHART_DURATION_SECONDS`、`AudioSession` 的 `?? 30` 与
//     fallback `30` ×2、`AudioSessionRoot` 与 `PlaybackProvider` 各硬编码 `30`；
//   - 夹取散在 5 处、三种口径：`AudioSession` 的 `clampFinite(x, 0.1, MAX, 30)` ×4、
//     `setChartDuration` 只夹上界（而它的注释写着 `clamp 到 [0.1, MAX]`）、`projectAudio` 的
//     `Math.min(MAX, Math.max(0.1, s))`、协调器与音频页各只夹上界。
//
// 现在（After）：一处默认 + 一处夹取。上限仍取自 `AppSettings.MAX_DURATION_SECONDS`
// （issue 28 P6：30 分钟），下界沿用 `AudioSession` 一路在用的 0.1。
//
// 注：`AudioSession` 的 `clampFinite` 留着 —— 它服务 [0,1] 的音量 / SE 口径，不是时长口径。
import { MAX_DURATION_SECONDS } from '../chart/config/AppSettings';

/** 无音频时的默认谱面长度（秒，ADR-0005 §4：可手动改并持久化） */
export const DEFAULT_CHART_DURATION_SECONDS = 30;

/** 下界（秒）：短于此值的谱面长度没有意义（AudioSession 一路沿用的口径） */
export const MIN_CHART_DURATION_SECONDS = 0.1;

/**
 * 谱面时长的唯一夹取：非有限值回落默认，其余钳到 `[MIN, MAX]`。
 *
 * 口径统一带来的唯一行为差：`(0, 0.1)` 之间的值此前在只夹上界的三处会被原样接受（如 0.05s），
 * 收口后一律为 0.1s —— 这三处上游都有 `> 0` / `Number.isFinite` 守卫，可达值都是无意义值
 * （手输极小值、旧记录脏值），取主导口径（见 architecture-refactor/10）。
 */
export function clampChartDuration(seconds: number): number {
  if (!Number.isFinite(seconds)) return DEFAULT_CHART_DURATION_SECONDS;
  return Math.min(MAX_DURATION_SECONDS, Math.max(MIN_CHART_DURATION_SECONDS, seconds));
}
