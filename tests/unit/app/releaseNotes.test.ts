import { describe, expect, it } from 'vitest';
import { parseInline, parseReleaseNotes } from '@/src/app/releaseNotesParser';

describe('发行说明 markdown 子集解析（ADR-0021 §2 产品内渲染）', () => {
  it('空文本 → 空块列表', () => {
    expect(parseReleaseNotes('')).toEqual([]);
    expect(parseReleaseNotes('\n \n')).toEqual([]);
  });

  it('段落：一行一块（CJK 不续行拼句）', () => {
    expect(parseReleaseNotes('修复了卡顿')).toEqual([
      { t: 'para', kids: [{ t: 'text', v: '修复了卡顿' }] },
    ]);
  });

  it('ATX 标题 1-3 级；四级不当标题按段落', () => {
    expect(parseReleaseNotes('# 大\n## 中\n### 小')).toEqual([
      { t: 'heading', level: 1, kids: [{ t: 'text', v: '大' }] },
      { t: 'heading', level: 2, kids: [{ t: 'text', v: '中' }] },
      { t: 'heading', level: 3, kids: [{ t: 'text', v: '小' }] },
    ]);
    expect(parseReleaseNotes('#### 太深')[0].t).toBe('para');
  });

  it('无序列表：连续行并成一组，空行分组', () => {
    expect(parseReleaseNotes('- 甲\n- 乙\n\n* 丙')).toEqual([
      { t: 'list', items: [[{ t: 'text', v: '甲' }], [{ t: 'text', v: '乙' }]] },
      { t: 'list', items: [[{ t: 'text', v: '丙' }]] },
    ]);
  });

  it('引用行', () => {
    expect(parseReleaseNotes('> ⚠️ 注意')).toEqual([
      { t: 'quote', kids: [{ t: 'text', v: '⚠️ 注意' }] },
    ]);
  });

  it('行内：粗体 / 斜体 / 行内代码，** 优先于 *', () => {
    expect(parseInline('看**这里**呀')).toEqual([
      { t: 'text', v: '看' },
      { t: 'bold', kids: [{ t: 'text', v: '这里' }] },
      { t: 'text', v: '呀' },
    ]);
    expect(parseInline('*斜*')).toEqual([{ t: 'italic', kids: [{ t: 'text', v: '斜' }] }]);
    expect(parseInline('`npm test`')).toEqual([{ t: 'code', v: 'npm test' }]);
  });

  it('行内：链接只取文字（站外出口是社域网白名单，不为发行说明加宽）', () => {
    expect(parseInline('见 [issue 07](https://github.com/x/y/issues/7) 结尾')).toEqual([
      { t: 'text', v: '见 ' },
      { t: 'link', kids: [{ t: 'text', v: 'issue 07' }] },
      { t: 'text', v: ' 结尾' },
    ]);
  });

  it('HTML 标签按纯文本（主进程 stripNotes 剥过，这里兜底不执行）', () => {
    expect(parseInline('<b>粗</b>')).toEqual([{ t: 'text', v: '<b>粗</b>' }]);
  });

  it('混合文档保序：标题 → 列表 → 段落', () => {
    const blocks = parseReleaseNotes('# 0.2.0\n\n- 新增甲\n- 修复乙\n\n就这样');
    expect(blocks.map((b) => b.t)).toEqual(['heading', 'list', 'para']);
  });

  it('发行说明真实形态：章节标题 + 要点列表混排粗体', () => {
    const blocks = parseReleaseNotes('## 新增\n\n- **工程管理**：一首歌一个工程');
    expect(blocks[0]).toEqual({ t: 'heading', level: 2, kids: [{ t: 'text', v: '新增' }] });
    expect(blocks[1]).toEqual({
      t: 'list',
      items: [[
        { t: 'bold', kids: [{ t: 'text', v: '工程管理' }] },
        { t: 'text', v: '：一首歌一个工程' },
      ]],
    });
  });
});
