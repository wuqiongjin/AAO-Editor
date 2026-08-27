// fix: "flick 覆盖 Slide 尾部时装饰箭头缺失"
// 根因：renderSlideBody 给 connection 画主精灵时 spread 了 flickFor() 替换为 flick 图,
// 但 flickFor 返回的 SpriteIconConfig 不含 flickTopDecorator 字段（Single 类型由
// renderChart 第二层显式补,见 render.ts line 290 注释）。slide/long 走 renderSlideBody
// 单点处理,如果不补,带 flick 的 connection 画不出墨迹箭头。
//
// 本测试锁住 render.ts 源码结构,确保 renderSlideBody 内部对 conn.flick 显式调
// spriteIcon.renderDecorator 并传入 flickTopDecorator,防止以后回退到无装饰状态。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const renderPath = resolve(here, '../../src/renderer/render.ts');

describe('renderSlideBody flick 装饰箭头', () => {
  const src = readFileSync(renderPath, 'utf8');

  it('renderSlideBody 体内应存在对 conn.flick 的 renderDecorator 调用', () => {
    // 抽出 renderSlideBody 函数体（从签名到下一个 export/function 之前）
    const m = src.match(/function\s+renderSlideBody[\s\S]*?\n\}\n/);
    expect(m, 'render.ts 应存在 renderSlideBody 函数').toBeTruthy();
    const body = m![0];

    // 1) 必须出现 renderDecorator 调用
    expect(body).toMatch(/spriteIcon\.renderDecorator\s*\(/);
    // 2) 这个调用必须在 conn.flick 分支内(不能无条件调,否则会把装饰箭头糊在所有端点)
    // 抽取包含 renderDecorator 的一段(到下一个空行/右括号/分号)
    const decCall = body.match(/spriteIcon\.renderDecorator\s*\([^)]*\)/);
    expect(decCall).toBeTruthy();
    // 找这个调用上方的 if (conn.flick) 守卫
    const before = body.slice(0, decCall!.index!);
    // 守卫在调用之前不太远的距离（200 字符内）出现,避免误判跨函数匹配
    const recent = before.slice(-300);
    expect(recent, 'renderDecorator 调用应被 if (conn.flick) 守卫').toMatch(/if\s*\(\s*!?\s*conn\.flick\s*\)/);
  });

  it('renderSlideBody 内应使用 icons.flickTopDecorator 作为装饰器源', () => {
    const m = src.match(/function\s+renderSlideBody[\s\S]*?\n\}\n/);
    expect(m).toBeTruthy();
    const body = m![0];
    // 守卫外应先把 icons.flickTopDecorator 取出来,函数内再传给 renderDecorator
    expect(body).toMatch(/flickTopDecorator/);
  });

  it('全文件 flick 装饰箭头补画总次数（Single 第二层 + Slide body）应 ≥ 2', () => {
    // Single 类型装饰在 renderChart 第二层（独立分支）
    // Slide/Long 类型装饰在 renderSlideBody 内
    // 任何一条被回退都会让 count < 2
    const decCalls = src.match(/spriteIcon\.renderDecorator\s*\(/g) || [];
    expect(decCalls.length).toBeGreaterThanOrEqual(2);
  });
});
