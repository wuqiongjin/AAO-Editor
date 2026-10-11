// 静态源码断言工具。
//
// 本仓有一类特殊测试：不 import 被测模块，而是读它的源码文本，
// 用正则锁住"接线事实"（例如 preload 必须暴露某 IPC、某文件不得出现 localStorage）。
// 这些断言锁的是 ADR / issue 的结构约定，用来防止重构时悄悄改坏接线。
//
// 路径一律从**仓库根**算起 —— 测试文件以后再怎么按领域分层、加目录，都不用改相对路径。
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 仓库根目录（由本文件位置反推，与测试文件所在目录深度无关） */
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** 读仓库内任意文件（相对仓库根） */
export function readSource(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf-8');
}

/** 去掉行注释与块注释，避免注释里的示例代码污染断言 */
export function stripComments(src: string): string {
  return src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

/** 读源码并去掉注释——静态断言最常用的组合 */
export function readStripped(rel: string): string {
  return stripComments(readSource(rel));
}

/**
 * 一棵目录下的全部 `.ts/.tsx`（相对**仓库根**的路径，分隔符统一 `/`）。
 *
 * 收在这里而不是各测试文件各写一份：多条静态锁都要"扫一棵源码树"，
 * 各写一份 walker 会让"扫哪些、怎么算路径"出现第二套口径。
 */
export function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) out.push(...sourceFiles(abs));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(relative(repoRoot, abs).split('\\').join('/'));
  }
  return out;
}

/**
 * 取某条 CSS 规则的声明块（`选择器 { … }` 里的 `…`；第一条命中）。
 *
 * 静态锁里要断言"某条规则里有没有某个声明"，用整表正则（`selector[^{]*\{[^}]*…`）会把
 * 后面的规则一起吞进来 —— 这个工具把选择器与其声明块切成一段，断言才落得准。
 * 选择器里的正则元字符（`.` / `:` / `(` / `)` 等）由本函数自行转义，调用方照原样写即可。
 */
export function cssRuleBody(css: string, selector: string): string | undefined {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${esc}[^{]*\\{([^}]*)\\}`))?.[1];
}
