import { describe, it, expect } from 'vitest';
import { formatTimePrecise, formatInMinuteTime } from '@/src/chart/geometry/TimeFormat';

describe('issue 200 · TimeFormat 时间显示精度扩展', () => {
  describe('formatTimePrecise', () => {
    it('标准档（standard）输出 mm:ss.s', () => {
      expect(formatTimePrecise(0)).toBe('00:00.0');
      expect(formatTimePrecise(0, 'standard')).toBe('00:00.0');
      expect(formatTimePrecise(83.4, 'standard')).toBe('01:23.4');
      expect(formatTimePrecise(83.456, 'standard')).toBe('01:23.4');
      expect(formatTimePrecise(59.96, 'standard')).toBe('00:59.9');
      expect(formatTimePrecise(-3, 'standard')).toBe('00:00.0');
    });

    it('高精度档（centisecond）输出 mm:ss.ss', () => {
      expect(formatTimePrecise(0, 'centisecond')).toBe('00:00.00');
      expect(formatTimePrecise(83.4, 'centisecond')).toBe('01:23.40');
      expect(formatTimePrecise(83.456, 'centisecond')).toBe('01:23.45');
      expect(formatTimePrecise(59.96, 'centisecond')).toBe('00:59.96');
      expect(formatTimePrecise(-3, 'centisecond')).toBe('00:00.00');
    });

    it('毫秒档（millisecond）输出 mm:ss.sss', () => {
      expect(formatTimePrecise(0, 'millisecond')).toBe('00:00.000');
      expect(formatTimePrecise(83.4, 'millisecond')).toBe('01:23.400');
      expect(formatTimePrecise(83.456, 'millisecond')).toBe('01:23.456');
      expect(formatTimePrecise(59.96, 'millisecond')).toBe('00:59.960');
      expect(formatTimePrecise(1.005, 'millisecond')).toBe('00:01.005');
      expect(formatTimePrecise(-3, 'millisecond')).toBe('00:00.000');
    });
  });

  describe('formatInMinuteTime', () => {
    it('高精度档（centisecond）输出 SS.ss 两位小数', () => {
      expect(formatInMinuteTime(0, 'centisecond')).toBe('00.00');
      expect(formatInMinuteTime(23.456, 'centisecond')).toBe('23.46');
      expect(formatInMinuteTime(5.5, 'centisecond')).toBe('05.50');
      expect(formatInMinuteTime(59.996, 'centisecond')).toBe('00.00');
      expect(formatInMinuteTime(121.5, 'centisecond')).toBe('01.50');
      expect(formatInMinuteTime(NaN, 'centisecond')).toBe('00.00');
    });
    it('标准档（standard）输出 SS.s 一位小数', () => {
      expect(formatInMinuteTime(0)).toBe('00.0');
      expect(formatInMinuteTime(0, 'standard')).toBe('00.0');
      expect(formatInMinuteTime(23.456, 'standard')).toBe('23.5');
      expect(formatInMinuteTime(5.5, 'standard')).toBe('05.5');
      expect(formatInMinuteTime(59.96, 'standard')).toBe('00.0'); // 四舍五入到 60 → 回绕
      expect(formatInMinuteTime(121.5, 'standard')).toBe('01.5');
      expect(formatInMinuteTime(NaN, 'standard')).toBe('00.0');
      expect(formatInMinuteTime(-0.5, 'standard')).toBe('00.0');
    });

    it('毫秒档（millisecond）输出 SS.sss 三位小数', () => {
      expect(formatInMinuteTime(0, 'millisecond')).toBe('00.000');
      expect(formatInMinuteTime(23.456, 'millisecond')).toBe('23.456');
      expect(formatInMinuteTime(5.5, 'millisecond')).toBe('05.500');
      expect(formatInMinuteTime(59.9996, 'millisecond')).toBe('00.000'); // 59.9996 四舍五入到 60.000 → 回绕
      expect(formatInMinuteTime(121.456, 'millisecond')).toBe('01.456');
      expect(formatInMinuteTime(NaN, 'millisecond')).toBe('00.000');
      expect(formatInMinuteTime(-0.5, 'millisecond')).toBe('00.000');
    });
  });
});
