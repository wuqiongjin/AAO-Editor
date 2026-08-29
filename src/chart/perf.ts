// 仅性能测量用（URL 带 ?perf=1 时启用），不进生产构建逻辑影响。
// 记录 renderChart 单次绘制耗时与渲染模式，暴露到 window.__perf 供浏览器脚本读取 before/after 基线。
const enabled = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('perf');

const state = { enabled, frames: 0, totalMs: 0, maxMs: 0, lastMs: 0 };
const lastInfo: Record<string, unknown> = {};

export const perf = {
  get enabled() { return state.enabled; },
  record(ms: number) {
    if (!state.enabled) return;
    state.frames += 1;
    state.totalMs += ms;
    state.lastMs = ms;
    if (ms > state.maxMs) state.maxMs = ms;
  },
  /** 附加渲染模式信息（瓦片命中/直渲、可见数等），随 snapshot 暴露 */
  info(partial: Record<string, unknown>) {
    if (!state.enabled) return;
    Object.assign(lastInfo, partial);
  },
  reset() {
    state.frames = 0;
    state.totalMs = 0;
    state.maxMs = 0;
    for (const k of Object.keys(lastInfo)) delete lastInfo[k];
  },
  avg() { return state.frames ? state.totalMs / state.frames : 0; },
  snapshot() { return { ...state, avg: this.avg(), info: { ...lastInfo } }; },
};

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__perf = perf;
}
