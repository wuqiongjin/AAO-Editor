// 票 69 性能回归：**长谱的谱面派生表**必须在预算内，且规模线性增长（不是平方）。
//
// 动态预览首帧那条链（`buildSimChart` → 键音事件表 → 首帧光栅）里，纯 JS 的派生部分是
// 能在本仓 node 环境里量的那一半；真实浏览器首帧可见时刻仍走票内手工验收。
// 计时口径照 `ChartCodeScale.test.ts`（test-infra 02）：进程 CPU 时间 + 多次取最小。
import { describe, expect, it } from 'vitest';
import { buildActiveNoteIcons, normalizeNoteSkinSelection } from '@/src/rendering/skin/noteSkin';
import type { ChartNote } from '@/src/chart/types';
import { buildSimChart, type SimScene } from '@/src/preview/video/sim/simField';
import { minCpuMs } from '@/tests/support/perfTiming';

/** 混合谱面：单键 / 左右方向键 / 8 结点滑条（含 hidden）+ 64 段 BPM */
function makeChart(notes: number): ChartNote[] {
  // 多段 BPM：逐音符重建时间线的旧写法在这里是 O(音符 × BPM 段)，单段谱面看不出来
  const out: ChartNote[] = Array.from({ length: 64 }, (_, k) => ({
    beat: k * 40, type: 'BPM', bpm: k % 2 === 0 ? 120 : 140,
  } as ChartNote));
  for (let i = 0; i < notes; i++) {
    const beat = i * 0.25;
    const lane = i % 7;
    const kind = i % 10;
    if (kind === 1) out.push({ beat, lane, type: 'LDirectional', length: (i % 3) + 1 } as ChartNote);
    else if (kind === 2) out.push({ beat, lane, type: 'RDirectional', length: (i % 3) + 1 } as ChartNote);
    else if (kind === 3) {
      out.push({
        type: 'Slide',
        connections: Array.from({ length: 8 }, (_, k) => ({ beat: beat + k * 0.125, lane: (lane + k) % 7, hidden: k % 3 === 0 })),
      } as unknown as ChartNote);
    } else out.push({ beat, lane, type: 'Single', flick: i % 7 === 0 } as ChartNote);
  }
  return out;
}

const icons = buildActiveNoteIcons(normalizeNoteSkinSelection({}));
const sceneOf = (notes: ChartNote[]): SimScene => ({
  notes,
  beatDisplay: 4,
  noteSpeed: 9.5,
  noteSize: 1,
  slideOpacity: 0.8,
  simultaneousClickLines: true,
  colorAssist: false,
  mirror: false,
});

// 预算按 CPU 最小值定：实现前 12k 音符 / 64 段 BPM 实测 min ≈ 52ms（逐音符 new BpmTimeline），
// 复用一条时间线后 ≈12ms；这条是「派生回到一条共享时间线」的护栏，不是抢几毫秒的优化赛。
const DERIVE_BUDGET_MS = 32;
const BIG = 12_000;
const SMALL = 1_200;

const bigNotes = makeChart(BIG);
const smallNotes = makeChart(SMALL);
const bigScene = sceneOf(bigNotes);
const smallScene = sceneOf(smallNotes);

describe('谱面派生表 · 长谱预算（票 69）', () => {
  it('workload 落在万级音符 / 多段 BPM（限时是在真 workload 上跑的）', () => {
    expect(bigNotes.length).toBeGreaterThan(BIG);
    expect(bigNotes.filter((n) => n.type === 'BPM')).toHaveLength(64);
  });

  it('12k 音符 / 64 段 BPM 的派生表一次在 32ms 内（CPU 时间最小值）', () => {
    // 这里走默认参数（内部自己 getBpmEvents），是实时 / 导出两条路径成本的上界：
    // 生产侧都在外层算好 BPM 事件再传进来，派生本身只会更便宜。
    expect(minCpuMs(() => buildSimChart(bigScene, icons))).toBeLessThan(DERIVE_BUDGET_MS);
  });

  it('规模 10 倍 → 耗时同量级增长（抓 O(n²) 与逐音符重建时间线）', () => {
    const smallMs = minCpuMs(() => buildSimChart(smallScene, icons));
    const bigMs = minCpuMs(() => buildSimChart(bigScene, icons));
    expect(bigMs).toBeLessThan(Math.max(20, smallMs * 25));
  });
});
