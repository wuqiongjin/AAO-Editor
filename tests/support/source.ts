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

/**
 * 读源码 / 扫目录的记忆化。
 *
 * 静态锁常在同一测试文件里反复读取同一批源码（多条断言各扫一遍 `src/` 之类）。全量并行跑时
 * 这些重复 I/O 与别的 worker 抢磁盘，能把百毫秒级的扫描拖过 vitest 默认的 5s 超时；源码在一次
 * 测试运行期间不会变化，按绝对路径缓存是安全的。
 */
const sourceTextCache = new Map<string, string>();
const strippedTextCache = new Map<string, string>();
const treeCache = new Map<string, string[]>();
const textTreeCache = new Map<string, string[]>();

/** 读仓库内任意文件（相对仓库根） */
export function readSource(rel: string): string {
  const abs = join(repoRoot, rel);
  const cached = sourceTextCache.get(abs);
  if (cached !== undefined) return cached;
  const text = readFileSync(abs, 'utf-8').replace(/\r\n/g, '\n');
  sourceTextCache.set(abs, text);
  return text;
}

/** 去掉行注释与块注释，避免注释里的示例代码污染断言 */
export function stripComments(src: string): string {
  return src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

/** 读源码并去掉注释——静态断言最常用的组合 */
export function readStripped(rel: string): string {
  const cached = strippedTextCache.get(rel);
  if (cached !== undefined) return cached;
  const text = stripComments(readSource(rel));
  strippedTextCache.set(rel, text);
  return text;
}

/**
 * 按**显式文件列表**拼接源码文本（装配根 + 恰好相关的域模块）。
 *
 * 接线事实可能横跨多个文件，但每条静态锁自己列清单、不扫全树：全文负锁
 * （`not.toMatch`）的射程才不会被无关模块污染。列表顺序即拼接顺序。
 * `strip` 为 true 时逐份去注释，与 `readStripped` 同口径。
 */
export function readSources(rels: string[], strip = false): string {
  return rels.map((rel) => (strip ? readStripped(rel) : readSource(rel))).join('\n');
}

/**
 * 一棵目录下匹配扩展名的全部源码文件（相对**仓库根**的路径，分隔符统一 `/`）。
 *
 * 收在这里而不是各测试文件各写一份：多条静态锁都要"扫一棵源码树"，
 * 各写一份 walker 会让"扫哪些、怎么算路径"出现第二套口径。
 * 默认只收 `.ts/.tsx`；要扫 CSS / JSON 的锁传第二个参数。
 * 同一目录 + 同一扩展名的结果在本次测试运行内复用。
 */
export function sourceFiles(dir: string, re: RegExp = /\.(ts|tsx)$/): string[] {
  const key = `${resolve(dir)}::${re.source}::${re.flags}`;
  const cached = treeCache.get(key);
  if (cached) return cached;
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) out.push(...sourceFiles(abs, re));
    else if (re.test(entry)) out.push(relative(repoRoot, abs).split('\\').join('/'));
  }
  treeCache.set(key, out);
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
 * 与 `sourceFiles` 的分工：`sourceFiles` 服务"单棵树"（默认 `.ts/.tsx`，可传扩展名）；
 * 这条服务"多棵树 + skip 目录 + md / yml / mjs / sh / json 等多种扩展名"的场景。
 * 两套 walker 都只有本文件这一处实现，调用方只给目录表与扩展名。
 */
export function textFilesUnder(dirs: string[], ext: RegExp, skip = ['node_modules', '.git']): string[] {
  const key = `${dirs.join('\u0000')}::${ext.source}::${ext.flags}::${skip.join('\u0000')}`;
  const cached = textTreeCache.get(key);
  if (cached) return cached;
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
  textTreeCache.set(key, out);
  return out;
}

/**
 * 取某条 CSS 规则的声明块（`选择器 { … }` 里的 `…`；第一条命中）。
 *
 * 静态锁里要断言"某条规则里有没有某个声明"，用整表正则（`selector[^{]*\{[^}]*…`）会把
 * 后面的规则一起吞进来 —— 这个工具把选择器与其声明块切成一段，断言才落得准。
 * 选择器里的正则元字符（`.` / `:` / `(` / `)` 等）由本函数自行转义，调用方照原样写即可。
 *
 * 选择器按**前缀**匹配：`.pv-rate .icon-btn:active` 会命中
 * `.pv-rate .icon-btn:active:not(:disabled)`。这对"同一钮的按压态"是有意的宽容；
 * 要整条匹配请用 {@link cssRuleBodyExact}。
 */
export function cssRuleBody(css: string, selector: string): string | undefined {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${esc}[^{]*\\{([^}]*)\\}`))?.[1];
}

/**
 * 同 {@link cssRuleBody}，但选择器必须**整条**匹配：后面紧跟 `{`（只允许空白），
 * 且前面是规则边界（行首 / 上一条规则的 `}`）。
 *
 * 前缀匹配在「一个类名是另一个类名的前缀」时会读错规则：`.coc` 会命中 `.coc__head {`，
 * 于是断言看着通过、其实落在别的规则上。断言里出现这种短类名时用本函数。
 */
export function cssRuleBodyExact(css: string, selector: string): string | undefined {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`(?:^|[}\\n])\\s*${esc}\\s*\\{([^}]*)\\}`))?.[1];
}
