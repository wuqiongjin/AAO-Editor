// 发行说明的 markdown 子集解析（ADR-0021 §2「有发行说明则附上」的产品内渲染）。
// 为什么自研子集而不引 react-markdown：发行说明是自己 release 里的短文本，用到的语法就
// 标题 / 列表 / 粗斜体 / 行内代码 / 引用几样——为它引渲染器 + 一套样式不划算，且子集行为可锁。
// 安全口径：只产数据结构、组件侧只拼 React 元素，全程不走 dangerouslySetInnerHTML；
// HTML 标签按纯文本显示（主进程 stripNotes 已剥过一层，这里是兜底）。
// 链接不渲染成 <a>：应用唯一的站外出口是社区域名白名单（electron/externalLink.cjs），
// 发行说明里的链接（issue / commit 引用）不在其列——按纯文本显示，不为它加宽出口。

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'bold'; kids: Inline[] }
  | { t: 'italic'; kids: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; kids: Inline[] }; // 链接只保留文字，不出跳转

export type Block =
  | { t: 'heading'; level: 1 | 2 | 3; kids: Inline[] }
  | { t: 'list'; items: Inline[][] }
  | { t: 'quote'; kids: Inline[] }
  | { t: 'para'; kids: Inline[] };

// 顺序即优先级：** 必须先于 *，`code` 与 [text](href) 互不嵌套（内容按字面）。
// 正则必须写在函数内：模块级共享 g 正则时，递归 parseInline 会重置外层循环的 lastIndex，
// 同一 token 被反复匹配、无限循环 OOM（单测实证）；函数内字面量每次求值都是新对象。
// （也曾试过 String.raw 存 pattern——反引号会截断模板字面量，此路不通。）

/** 行内语法：粗体 / 斜体 / 行内代码 / 链接（取文字）；其余按纯文本 */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  const pushText = (s: string) => {
    if (s) out.push({ t: 'text', v: s });
  };
  const re = /(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)|(`[^`]+`)|(\[[^\]]+\]\([^)\s]+\))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    pushText(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**') || tok.startsWith('__')) {
      out.push({ t: 'bold', kids: parseInline(tok.slice(2, -2)) });
    } else if (tok.startsWith('*') || tok.startsWith('_')) {
      out.push({ t: 'italic', kids: parseInline(tok.slice(1, -1)) });
    } else if (tok.startsWith('`')) {
      out.push({ t: 'code', v: tok.slice(1, -1) });
    } else {
      const lm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok);
      out.push({ t: 'link', kids: parseInline(lm ? lm[1] : tok) });
    }
    last = m.index + tok.length;
  }
  pushText(text.slice(last));
  return out;
}

/** 块级语法：ATX 标题（1-3 级）/ 无序列表（连续行并成一组）/ 引用 / 段落（一行一段，CJK 无需续行拼句） */
export function parseReleaseNotes(md: string): Block[] {
  const blocks: Block[] = [];
  let list: Inline[][] | null = null;
  const flushList = () => {
    if (list) {
      blocks.push({ t: 'list', items: list });
      list = null;
    }
  };
  for (const raw of md.split('\n')) {
    const line = raw.trim();
    if (line === '') {
      flushList();
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushList();
      blocks.push({ t: 'heading', level: heading[1].length as 1 | 2 | 3, kids: parseInline(heading[2]) });
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      flushList();
      blocks.push({ t: 'quote', kids: parseInline(quote[1]) });
      continue;
    }
    const item = /^[-*]\s+(.*)$/.exec(line);
    if (item) {
      (list ??= []).push(parseInline(item[1]));
      continue;
    }
    flushList();
    blocks.push({ t: 'para', kids: parseInline(line) });
  }
  flushList();
  return blocks;
}
