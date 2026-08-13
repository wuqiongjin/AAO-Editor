// 谱面代码文本编辑的纯文本变换（无副作用，可单测）。
// 输入 { value, start, end }，输出变换后的 { value, start, end }。
// 剪贴板读写、撤销/重做等副作用由调用方（ChartCodeEditor）负责，这里只做纯文本运算。

export interface TextEditRange {
  value: string;
  start: number;
  end: number;
}

const INDENT = '    ';

/** Tab 缩进：在选区处插入 4 个空格，光标移到插入后位置 */
export function insertTab({ value, start, end }: TextEditRange): TextEditRange {
  return {
    value: value.slice(0, start) + INDENT + value.slice(end),
    start: start + INDENT.length,
    end: start + INDENT.length,
  };
}

/** Enter 换行并自动继承/增减缩进（依据当前行尾是否 `{`/`[` 或行首是否 `}`/`]`） */
export function insertNewlineIndent({ value, start, end }: TextEditRange): TextEditRange {
  const beforeCursor = value.slice(0, start);
  const lastLineStart = beforeCursor.lastIndexOf('\n') + 1;
  const currentLine = beforeCursor.slice(lastLineStart, start);
  const indent = currentLine.match(/^(\s*)/)?.[1] ?? '';

  let newIndent = indent;
  if (currentLine.trim().endsWith('{') || currentLine.trim().endsWith('[')) {
    newIndent = indent + INDENT;
  } else if (currentLine.trim().startsWith('}') || currentLine.trim().startsWith(']')) {
    newIndent = indent.slice(0, Math.max(0, indent.length - INDENT.length));
  }

  const newValue = value.slice(0, start) + '\n' + newIndent + value.slice(end);
  return {
    value: newValue,
    start: start + 1 + newIndent.length,
    end: start + 1 + newIndent.length,
  };
}

/** 剪切选区文本：删除选区并返回新文本（不含剪贴板副作用） */
export function cutRange({ value, start, end }: TextEditRange): TextEditRange {
  return { value: value.slice(0, start) + value.slice(end), start, end: start };
}

/** 粘贴文本到选区，光标移到插入后位置 */
export function pasteAt({ value, start, end }: TextEditRange, text: string): TextEditRange {
  const newValue = value.slice(0, start) + text + value.slice(end);
  return { value: newValue, start: start + text.length, end: start + text.length };
}
