// issue 102 性能回归：**5000 音符**谱面代码的序列化 / stringify / 全量校验必须在预算内，
// 且规模线性增长（不是平方）。
//
// 这条线守的是「打开弹窗 / 在代码框里打字」主线程时间的**纯 JS 部分**（浏览器侧的 textarea 布局另有
// 数量级更大的常量成本，见票内实测）。这里钉住的是：不得让这段纯函数退化成 O(n²)
// （比如在校验里对每条音符再扫一遍全谱），以及不得引入数量级变慢的写法。
import { describe, it, expect } from 'vitest';
import {
  convertNotesToChartCode,
  chartCodeToCompactJSON,
  parseCodeText,
} from '@/src/chart/editing/ChartConverter';
import type { ChartNote } from '@/src/chart/types';

/** 混合谱面：单键 / 左右方向键 / 8 结点滑条（含 hidden），第 0 拍一条 BPM */
function makeChart(notes: number): ChartNote[] {
  const out: ChartNote[] = [{ beat: 0, type: 'BPM', bpm: 120 } as ChartNote];
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

/** 单次计时；先跑一轮预热，避免把首次 JIT 计进去 */
function timeIt(fn: () => unknown): number {
  fn();
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

const BIG = 5000;
const SMALL = 500;

const big = makeChart(BIG);
const bigCode = convertNotesToChartCode(big);
const bigJson = chartCodeToCompactJSON(bigCode);
/** 弹窗里真正显示的那份文本（每条音符一行） */
const bigEditorText = bigJson;

describe('谱面代码 · 大谱面预算（5000 音符）', () => {
  it('文本规模落在「大文本」量级（保证下面的限时是在真 workload 上跑的）', () => {
    // 每条一行后 5000 音符 ≈ 364KB（历史 4 空格形态是 982KB）
    expect(bigJson.length).toBeGreaterThan(300_000);
  });

  // 这条是本票的**头号约束**：textarea 的排版成本由**行数**决定（不是字节数）。
  // 4 空格缩进 = 49,507 行 → 同机裸 textarea 首次布局 289ms / 输入一个字 42~66ms；
  // 每条一行 = 5,003 行 → 30ms / 7.5~22.7ms。谁把显示改回缩进形态，这条会红。
  it('显示文本行数 ≈ 音符数（不得回退成多行缩进）', () => {
    const lines = bigEditorText.split('\n').length;
    expect(lines).toBeLessThanOrEqual(BIG * 1.2 + 4);
    // 顺便钉住"确实比缩进形态少一个数量级"（缩进形态作对照）
    expect(JSON.stringify(bigCode, null, 4).split('\n').length).toBeGreaterThan(lines * 5);
  });

  it('notes → 谱面代码（含 beat 稳定排序）在 60ms 内', () => {
    expect(timeIt(() => convertNotesToChartCode(big))).toBeLessThan(60);
  });

  it('序列化成文本（每条音符一行）在 60ms 内', () => {
    expect(timeIt(() => chartCodeToCompactJSON(bigCode))).toBeLessThan(60);
  });

  it('全量 parse + 逐条校验在 120ms 内', () => {
    expect(timeIt(() => parseCodeText(bigJson))).toBeLessThan(120);
  });

  it('规模 10 倍 → 耗时同量级增长（抓 O(n²) 退化）', () => {
    const small = makeChart(SMALL);
    const smallJson = chartCodeToCompactJSON(convertNotesToChartCode(small));
    const smallMs = timeIt(() => parseCodeText(smallJson));
    const bigMs = timeIt(() => parseCodeText(bigJson));
    // 线性 = 10x；平方 = 100x。留到 25x 足够宽松又足以抓住平方退化。
    expect(bigMs).toBeLessThan(Math.max(20, smallMs * 25));
  });
});
