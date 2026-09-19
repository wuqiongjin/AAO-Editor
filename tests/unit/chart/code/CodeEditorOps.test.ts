import { describe, it, expect } from 'vitest';
import { insertTab, insertNewlineIndent, cutRange, pasteAt } from '@/src/chart/editing/CodeEditorOps';

describe('CodeEditorOps（谱面代码文本编辑纯变换）', () => {
  describe('insertTab', () => {
    it('在光标处插入 4 个空格并移动光标', () => {
      const r = insertTab({ value: 'ab', start: 1, end: 1 });
      expect(r.value).toBe('a    b');
      expect(r.start).toBe(5);
      expect(r.end).toBe(5);
    });
    it('替换选区并移动光标', () => {
      const r = insertTab({ value: 'aXYb', start: 1, end: 3 });
      expect(r.value).toBe('a    b');
      expect(r.start).toBe(5);
    });
  });

  describe('insertNewlineIndent', () => {
    it('普通行换行不增缩进', () => {
      const r = insertNewlineIndent({ value: '  abc', start: 5, end: 5 });
      expect(r.value).toBe('  abc\n  ');
      expect(r.start).toBe(8);
    });
    it('行尾为 { 时增加缩进', () => {
      const r = insertNewlineIndent({ value: 'if x {', start: 6, end: 6 });
      expect(r.value).toBe('if x {\n    ');
      expect(r.start).toBe(11);
    });
    it('行首为 } 时减少缩进', () => {
      const r = insertNewlineIndent({ value: '    }', start: 5, end: 5 });
      expect(r.value).toBe('    }\n');
      expect(r.start).toBe(6);
    });
  });

  describe('cutRange', () => {
    it('删除选区文本，光标回到选区起点', () => {
      const r = cutRange({ value: 'aXYZb', start: 1, end: 4 });
      expect(r.value).toBe('ab');
      expect(r.start).toBe(1);
      expect(r.end).toBe(1);
    });
  });

  describe('pasteAt', () => {
    it('在光标处插入文本并移动光标', () => {
      const r = pasteAt({ value: 'ab', start: 1, end: 1 }, 'XY');
      expect(r.value).toBe('aXYb');
      expect(r.start).toBe(3);
      expect(r.end).toBe(3);
    });
    it('替换选区文本', () => {
      const r = pasteAt({ value: 'aXYb', start: 1, end: 3 }, 'Z');
      expect(r.value).toBe('aZb');
      expect(r.start).toBe(2);
    });
  });
});
