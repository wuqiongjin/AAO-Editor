// issue 143：BPM 就地编辑的输入解析口径（Bestdori 的 bpm 是任意有限数，含小数）。
import { describe, it, expect } from 'vitest';
import { parseBpmInput } from '@/src/chart/editing/BpmInput';

describe('parseBpmInput', () => {
  it('整数照收', () => {
    expect(parseBpmInput('120')).toBe(120);
    expect(parseBpmInput('225')).toBe(225);
  });

  it('小数不再被截断（issue 143 的主诉）', () => {
    expect(parseBpmInput('128.5')).toBe(128.5);
    expect(parseBpmInput('12.7')).toBe(12.7);
    expect(parseBpmInput('0.5')).toBe(0.5);
  });

  it('负值照收（ADR-0010 结论 8：编辑器内可创建倒流区）', () => {
    expect(parseBpmInput('-120')).toBe(-120);
    expect(parseBpmInput('-128.5')).toBe(-128.5);
  });

  it('0 / -0 无效（= 取消编辑，口径不回退）', () => {
    expect(parseBpmInput('0')).toBeNull();
    expect(parseBpmInput('-0')).toBeNull();
    expect(parseBpmInput('0.0')).toBeNull();
  });

  it('非数字 / 非有限数无效', () => {
    expect(parseBpmInput('')).toBeNull();
    expect(parseBpmInput('abc')).toBeNull();
    expect(parseBpmInput('Infinity')).toBeNull();
    expect(parseBpmInput('-Infinity')).toBeNull();
  });

  it('带前后空格与带尾缀的文本按 parseFloat 口径（与旧 parseInt 同款宽容）', () => {
    expect(parseBpmInput('  96  ')).toBe(96);
    expect(parseBpmInput('12.7abc')).toBe(12.7);
  });
});
