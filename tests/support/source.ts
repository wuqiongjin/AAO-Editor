// 静态源码断言工具。
//
// 本仓有一类特殊测试：不 import 被测模块，而是读它的源码文本，
// 用正则锁住"接线事实"（例如 preload 必须暴露某 IPC、某文件不得出现 localStorage）。
// 这些断言锁的是 ADR / issue 的结构约定，用来防止重构时悄悄改坏接线。
//
// 路径一律从**仓库根**算起 —— 测试文件以后再怎么按领域分层、加目录，都不用改相对路径。
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
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
