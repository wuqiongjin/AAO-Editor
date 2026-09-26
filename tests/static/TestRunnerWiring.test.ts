// issue 08：vitest 配置的接线事实——tests/dom 已登记进默认全量跑，且默认环境仍是 node。
// 这两条都是"改坏了全量回归会悄悄失真"的接线，用源码断言锁住。
//
// include 用原文判：stripComments 会把 glob 里的 `/**/` 当成空块注释吃掉，断言会自己抹掉自己。
// environment 用去注释后的文本判：免得将来注释里提一句 jsdom 就误报。
import { describe, it, expect } from 'vitest';
import { readSource, stripComments } from '@/tests/support/source';

const config = readSource('vitest.config.ts');
const configCode = stripComments(config);

describe('issue 08 · vitest 配置接线', () => {
  it('include 登记 tests/dom 的 .ts/.tsx，否则 DOM 测试不会进默认全量跑', () => {
    expect(config).toMatch(/include:\s*\[[^\]]*tests\/dom\/\*\*\/\*\.test\.\{ts,tsx\}/);
  });

  it('默认 environment 仍是 node：jsdom 只在需要的文件头 docblock 里开', () => {
    expect(configCode).toMatch(/environment:\s*'node'/);
    expect(configCode).not.toMatch(/environment:\s*'jsdom'/);
  });
});
