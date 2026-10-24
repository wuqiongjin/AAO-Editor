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
 * 剥 YAML 行注释（`#` 开头的整行）。
 *
 * 静态锁读 workflow 时要先剥一层：否则注释里写的说明文字会跟着进断言，
 * 于是「注释里提了一句某某字符串」也会被当成接线事实。多条 workflow 锁共用。
 */
export function stripYamlComments(src: string): string {
  return src.replace(/^[ \t]*#[^\n]*\n?/gm, '');
}

/**
 * 取 YAML 里某个 block 的正文：匹配一条 block 头（如 `jobs:` / `  build:`），
 * 一直吃到**下一个同级 key 之前**为止（最后一个同级 block 则到文件尾）。
 * 返回的正文**不含**头行自己，含它的全部子 block。
 *
 * 收在这里而不是各测试文件各写一份：多条 workflow 锁都要「先切 jobs、再切某个 job」，
 * 各写一份 slice 会让「算到哪一级算同级」出现第二套口径。
 */
export function yamlBlock(src: string, header: string): string {
  const indent = header.match(/^ */)?.[0].length ?? 0;
  const head = header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const start = src.search(new RegExp(`^${head}\\n`, 'm'));
  if (start < 0) return '';
  const body = src.slice(start + header.length + 1);
  // 同级边界：一条缩进 ≤ indent 且首字符非空白的行。不用 `$` 断言——开 `m` 标志时
  // `$` 在**每一行**末尾都成立，惰性匹配会在第一行的行尾就收手，切出一段假正文。
  const sibling = body.search(new RegExp(`\\n {0,${indent}}\\S`));
  return sibling < 0 ? body : body.slice(0, sibling);
}

/**
 * 多目录文本文件扫描（相对**仓库根**的路径）——跨仓文档 / 配置类静态锁的 walker。
 * 与 `sourceFiles` 的分工：那条只服务 `src` 单树的 `.ts/.tsx`；这条服务
 * "扫 md / yml / mjs / sh / json 等多种扩展名、跨多棵树"的场景。
 * 第二套口径仍然只有一处——都在本文件里，调用方只给目录表与扩展名。
 */
export function textFilesUnder(dirs: string[], ext: RegExp, skip = ['node_modules', '.git']): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(repoRoot, dir))) {
      if (skip.includes(entry)) continue;
      const rel = dir ? `${dir}/${entry}` : entry;
      const abs = join(repoRoot, rel);
      if (statSync(abs).isDirectory()) walk(rel);
      else if (ext.test(entry)) out.push(rel);
    }
  };
  for (const dir of dirs) walk(dir);
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
