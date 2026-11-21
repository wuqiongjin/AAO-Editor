// 票 247 · 曲线面板配置行「行高不跟内容走」的锁。
//
// 现象：同一模板在「档位 / 自由」之间切换时，配置行文字逐行错位（标签 top 419/447/475/503
// → 419/446.5/473.5/500.5，累计 2.5px；x 恒为 144，所以不是列宽问题）。根因是**行高由内容撑开**：
// 档位行里是 23px 的胶囊按钮，自由行里是 22px 的数值框 ⇒ 每个自由行矮 1px，逐行累积。
//
// **为什么只能静态断言**：jsdom 没有布局引擎，行高 / 标签 top 全测不出来；真实几何由 headless Edge
// 实测把关（1100/1280/1440 三档窗宽 × 模式来回切 3 轮，另加 18 款模板横扫；数值记在票 247 的
// Comments）。本文件锁住的是让那种错位不可能复发的结构事实：行有固定下限，两套控件的盒高与它相等。
import { describe, expect, it } from 'vitest';
import { cssRuleBody, readStripped } from '@/tests/support/source';

const CSS = 'src/pages/workspace/CurveConfigPanel.css';

/** 某条规则里某个长度声明的 px 读数（找不到 / 不是单个 px 一律抛 —— 静态锁宁可炸也不静默放过） */
function pxOf(selector: string, prop: string): number {
  const body = cssRuleBody(readStripped(CSS), selector);
  const raw = body?.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`))?.[1];
  if (raw == null) throw new Error(`${selector} 里找不到 ${prop}`);
  const m = /^(\d+(?:\.\d+)?)px$/.exec(raw.trim());
  if (!m) throw new Error(`${selector} 的 ${prop} 不是单个 px 值：${raw.trim()}`);
  return Number(m[1]);
}

describe('basic-editor 247 · 曲线配置行高由固定值决定，不随档位/自由控件形态变化', () => {
  it('行有固定下限，两套控件的盒高与它相等', () => {
    const rowMin = pxOf('.ccp__ctrl-row', 'min-height');
    expect(pxOf('.ccp__pill-btn', 'height')).toBe(rowMin);
    expect(pxOf('.ccp__num-input', 'height')).toBe(rowMin);
    // 下限而非 height：将来内容真变高时让它长大，而不是裁掉
    expect(rowMin).toBeGreaterThan(0);
  });

  it('滑块不高过行高（高过就把自由行重新撑高，档位/自由又不同高）', () => {
    expect(pxOf('.ccp__slider', 'height')).toBeLessThanOrEqual(pxOf('.ccp__ctrl-row', 'min-height'));
  });

  it('标签列仍是 52px（本票只统一行高，不动列宽）', () => {
    const body = cssRuleBody(readStripped(CSS), '.ccp__ctrl-row') ?? '';
    expect(body).toMatch(/grid-template-columns:\s*52px\s+1fr/);
  });
});
