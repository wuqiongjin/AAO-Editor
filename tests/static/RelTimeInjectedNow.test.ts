// issue 36 锁测 2：relTime 的 now 一律显式注入，防回溜 Date.now() 默认参。
//
// relTime(at, now = Date.now()) 的默认参是给单测注入用的（issue 31 锁测即注入式），
// 生产调用点必须显式传共享 ticker 的 now：少传一个参数，「N 分钟前」就退回
// "渲染时求值一次"的老问题（切走再切回来才变）；本地 `const now = Date.now()` 再传
// 也不行 —— 同一次渲染里各消费方会读到不同瞬时，单一时钟的意义被架空。
// 本锁扫 src/ 全部调用点，另外盯死三件接线事实：
//   - 每个有调用点的文件，其 now 来自 useNow()（不是本地现取）；
//   - 工程两页不自建定时器（根因侧：症状本来就是"两页无定时器驱动重渲染"）；
//   - ProviderTree 里挂着 NowProvider（useNow 有树可挂）。
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readStripped, repoRoot, sourceFiles } from '@/tests/support/source';

/** relTime 定义所在文件：签名里的形参不是调用点，扫调用点时要排除它。 */
const DEFINITION = 'src/pages/projects/projectFormat.ts';

/** 按括号配对取出 src 里全部 relTime(...) 调用的实参文本（跳过定义文件与注释）。 */
function relTimeCallArgs(src: string): string[] {
  const out: string[] = [];
  const re = /\brelTime\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const open = m.index + m[0].length - 1; // '(' 的位置
    let depth = 0;
    let end = -1;
    for (let i = open; i < src.length; i++) {
      const ch = src[i];
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end !== -1) out.push(src.slice(open + 1, end));
  }
  return out;
}

/** 按顶层逗号切实参（嵌套括号里的逗号不算）。 */
function splitTopLevel(args: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < args.length; i++) {
    const ch = args[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(args.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(args.slice(start));
  return parts;
}

const files = sourceFiles(join(repoRoot, 'src')).filter((rel) => rel !== DEFINITION);
const bad: string[] = [];
const callFiles: string[] = [];
let callSites = 0;
for (const rel of files) {
  const src = readStripped(rel);
  const argsList = relTimeCallArgs(src);
  if (argsList.length > 0) callFiles.push(rel);
  for (const args of argsList) {
    callSites++;
    const parts = splitTopLevel(args);
    if (parts.length !== 2 || parts[1]!.trim() !== 'now') {
      bad.push(`${rel}: relTime(${args.trim()})`);
    }
  }
}

describe('issue 36 · relTime 调用点全部传入注入 now', () => {
  it('总闸自己没扫空（免得路径一改就静默放行）', () => {
    expect(callSites).toBeGreaterThanOrEqual(5);
  });

  it('每个调用点都是 relTime(at, now) 两参形态，且第二参就是共享 ticker 的 now', () => {
    expect(bad).toEqual([]);
  });

  it('有调用点的文件，now 一律来自 useNow()（不是本地 Date.now() 现取）', () => {
    const noTicker = callFiles.filter((rel) => !/const\s+now\s*=\s*useNow\(\)/.test(readStripped(rel)));
    expect(noTicker).toEqual([]);
  });

  it('工程两页不自建定时器：src/pages/projects 无 setInterval/rAF（根因侧）', () => {
    const offenders = sourceFiles(join(repoRoot, 'src/pages/projects'))
      .filter((rel) => /setInterval|requestAnimationFrame/.test(readStripped(rel)));
    expect(offenders).toEqual([]);
  });

  it('NowProvider 挂在 ProviderTree 里（useNow 有树可挂）', () => {
    const tree = readStripped('src/app/ProviderTree.tsx');
    expect(tree).toMatch(/import\s*\{\s*NowProvider\s*\}\s*from\s*'\.\/providers\/NowProvider'/);
    expect(tree).toMatch(/<NowProvider>/);
  });
});
