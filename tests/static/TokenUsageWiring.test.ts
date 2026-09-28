// 设计令牌（ADR-0003 §4）：`var(--x)` 用到的每一个 token，仓库里都必须**有定义**。
//
// 起因是一个真事：`.readonly-toast__copy-btn` 写的是 `color: var(--accent-contrast)`，
// 而 tokens.css 里压根没有这个 token —— 该声明整条失效、文字色落到继承，
// 亮色下看着还行（5.0:1），暗色下变成浅字压浅青（1.8:1）读不出来，藏了大半年没人发现。
// 死引用不会报错、不会进 lint，只能靠这条闸。
//
// 「有定义」三处都算：
//   1. CSS 里的声明 `--x: …`（tokens.css 与各局部样式文件）
//   2. 内联 style 里的键 `'--x': …`（如 --c / --ws-left-w 由组件注入）
//   3. `setProperty('--x', …)`
// 带兜底的 `var(--x, fallback)` 不豁免：兜底只是掩盖，token 该定义还得定义。
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readStripped, repoRoot } from '@/tests/support/source';

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
  .filter(([name]) => !defined.has(name))
  .map(([name, where]) => `${name} (${[...where].join(', ')})`);

describe('设计令牌 · 用到的都必须有定义', () => {
  it('src 里没有引用了未定义 token 的地方', () => {
    expect(deadTokens).toEqual([]);
  });

  it('扫描自己没扫空（免得路径一改就静默放行）', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(used.size).toBeGreaterThan(50);
  });
});
