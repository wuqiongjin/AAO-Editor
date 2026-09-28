// 设计令牌（ADR-0003 §4）：`var(--x)` 用到的每一个 token，仓库里都必须**有定义**。
//
// 起因是一个真事：`.readonly-toast__copy-btn` 写的是 `color: var(--accent-contrast)`，
// 而 tokens.css 里压根没有这个 token —— 该声明整条失效、文字色落到继承，
// 亮色下看着还行（5.0:1），暗色下变成浅字压浅青（1.8:1）读不出来，藏了大半年没人发现。
// 死引用不会报错、不会进 lint，只能靠这条闸。
//
// 「有定义」四处都算：
//   1. CSS 里的声明 `--x: …`（tokens.css 与各局部样式文件）
//   2. 内联 style 里的键 `'--x': …`（如 --c / --ws-left-w 由组件注入）
//   3. `setProperty('--x', …)`
//   4. 布局调参旋钮：只活在 CSS 兜底里、没有 JS 侧定义的 `var(--x, fallback)` ——
//      在 `tests/static/tokenAllowlist.ts` 登记。这类名字不落字面量，闸看不见它的"定义"，
//      只能靠白名单放行；代价是**兜底值必须写**（没有兜底时名字写错就等于静默失效）。
// 除第 4 类外，带兜底的 `var(--x, fallback)` **不豁免**：兜底只是掩盖，token 该定义还得定义。
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readStripped, repoRoot } from '@/tests/support/source';
import { PARAMETERIZED_TOKENS } from './tokenAllowlist';

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      out.push(...sourceFiles(abs));
    } else if (/\.(css|tsx?)$/.test(entry)) {
      out.push(relative(repoRoot, abs).split('\\').join('/'));
    }
  }
  return out;
}

const files = sourceFiles(join(repoRoot, 'src'));

/** CSS 声明（裸 `--x:`）｜内联 style 的键（`'--x':` / `"--x":`） */
const DEFINITION = /(?:^|[\s;{,(])(--[\w-]+)\s*:|['"](--[\w-]+)['"]\s*:/;
const SET_PROPERTY = /setProperty\(\s*['"](--[\w-]+)['"]/g;
const USAGE = /var\(\s*(--[\w-]+)/g;

const defined = new Set<string>();
const used = new Map<string, Set<string>>();

for (const rel of files) {
  const src = readStripped(rel);
  for (const m of src.matchAll(new RegExp(DEFINITION, 'g'))) {
    if (m[1]) defined.add(m[1]);
    if (m[2]) defined.add(m[2]);
  }
  for (const m of src.matchAll(SET_PROPERTY)) defined.add(m[1]);
  for (const m of src.matchAll(USAGE)) {
    if (!used.has(m[1])) used.set(m[1], new Set());
    used.get(m[1])!.add(rel);
  }
}

/** 用到了但全仓没有定义的 token —— 这些声明整条失效 */
const deadTokens = [...used.entries()]
  .filter(([name]) => !defined.has(name) && !PARAMETERIZED_TOKENS.includes(name))
  .map(([name, where]) => `${name} (${[...where].join(', ')})`);

/** 参数化 token 在使用处必须带兜底值：名字不在 src 落字面量，兜底是它唯一的自解释 */
const parameterizedWithoutFallback = [...used.entries()]
  .filter(([name]) => PARAMETERIZED_TOKENS.includes(name))
  .filter(([name]) => {
    const sources = [...used.get(name)!].map((rel) => readStripped(rel));
    return !sources.some((src) => new RegExp(`var\\(\\s*${name}\\s*,`).test(src));
  })
  .map(([name]) => name);

describe('设计令牌 · 用到的都必须有定义', () => {
  it('src 里没有引用了未定义 token 的地方（参数化 token 白名单除外）', () => {
    expect(deadTokens).toEqual([]);
  });

  it('参数化 token 在使用处都带了兜底值', () => {
    expect(parameterizedWithoutFallback).toEqual([]);
  });

  it('白名单里没有已死的条目（定义进了 src 就该从白名单删掉）', () => {
    const stale = PARAMETERIZED_TOKENS.filter((name) => defined.has(name));
    expect(stale).toEqual([]);
  });

  it('扫描自己没扫空（免得路径一改就静默放行）', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(used.size).toBeGreaterThan(50);
  });
});
